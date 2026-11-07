import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * Verschlüsseltes Streaming-Format für Off-Site-Backups (`.sobk`): AES-256-GCM in Blöcken, damit ein Archiv beliebiger Größe streamend verschlüsselt (und wieder
 * entschlüsselt) werden kann – nie komplett im Speicher.
 *
 * Aufbau:
 *   Kopf (44 Byte):  "SOBK" · Version (1) · 3 Nullbytes · Blockgröße (u32, Klartext je Block) · Salz (32 Byte, zufällig je Datei)
 *   danach Blöcke:   Länge (u32) · Chiffretext · Tag (16 Byte)           – Länge = Chiffretext + Tag
 * Schlüssel je Datei: HKDF-SHA256(Hauptschlüssel, Salz, "schrauberos-offsite-file-v1") – kein Schlüssel wird für zwei Dateien benutzt, deshalb sind Zähler-Nonces sicher.
 * Nonce des Blocks: 4 Nullbytes · Blocknummer (u64, ab 0). Zusätzlich authentifiziert (AAD): der ganze Kopf und ein Endmarken-Byte (1 beim **letzten** Block).
 * Damit gilt: Ein vertauschter, doppelter oder fehlender Block fällt über die Nonce auf, ein abgeschnittener Strom über die fehlende Endmarke, Anhängsel über die
 * Endmarke des bisher letzten Blocks, ein veränderter Kopf über das AAD. Auch die leere Datei hat einen (leeren) Endblock.
 * Falscher Schlüssel und Veränderung sind nicht zu unterscheiden (`auth`).
 */
export const OFFSITE_MAGIC = Buffer.from("SOBK", "latin1");
export const OFFSITE_VERSION = 1;
export const HEADER_LENGTH = 44;
export const TAG_LENGTH = 16;
export const DEFAULT_CHUNK_SIZE = 1024 * 1024;
export const MIN_CHUNK_SIZE = 4096;
export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const FILE_INFO = "schrauberos-offsite-file-v1";

export type OffsiteCryptoCode = "format" | "auth" | "truncated";

export class OffsiteCryptoError extends Error {
  constructor(readonly code: OffsiteCryptoCode) {
    super(code);
  }
}

const fileKey = (master: Buffer, salt: Buffer): Buffer => Buffer.from(hkdfSync("sha256", master, salt, FILE_INFO, 32));

function nonce(counter: number): Buffer {
  const out = Buffer.alloc(12);
  out.writeBigUInt64BE(BigInt(counter), 4);
  return out;
}

const aad = (header: Buffer, final: boolean): Buffer => Buffer.concat([header, Buffer.from([final ? 1 : 0])]);

/** Beginnt die Datei mit der Kennung eines verschlüsselten Off-Site-Backups? */
export function isOffsiteHeader(head: Buffer): boolean {
  return head.length >= OFFSITE_MAGIC.length && head.subarray(0, OFFSITE_MAGIC.length).equals(OFFSITE_MAGIC);
}

/** Verschlüsselt einen Strom (Klartext rein, `.sobk` raus). `chunkSize` nur für Tests kleiner wählen. */
export function createEncryptStream(masterKey: Buffer, options: { chunkSize?: number } = {}): Transform {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) throw new Error("Ungültige Blockgröße.");
  const header = Buffer.alloc(HEADER_LENGTH);
  OFFSITE_MAGIC.copy(header, 0);
  header[4] = OFFSITE_VERSION;
  header.writeUInt32BE(chunkSize, 8);
  randomBytes(32).copy(header, 12);
  const key = fileKey(masterKey, header.subarray(12, 44));

  let pending: Buffer = Buffer.alloc(0);
  let counter = 0;
  let started = false;

  const seal = (plain: Buffer, final: boolean): Buffer => {
    const cipher = createCipheriv("aes-256-gcm", key, nonce(counter++));
    cipher.setAAD(aad(header, final));
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, body]);
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        if (!started) {
          started = true;
          this.push(header);
        }
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        // Ein voller Block bleibt zurück, bis mehr Daten kommen oder der Strom endet: Nur so weiß der Verschlüssler, welcher Block der letzte ist
        while (pending.length > chunkSize) {
          this.push(seal(pending.subarray(0, chunkSize), false));
          pending = pending.subarray(chunkSize);
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!started) this.push(header);
        this.push(seal(pending, true));
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/** Entschlüsselt einen `.sobk`-Strom. Fehler: `OffsiteCryptoError` (`format` = keine Datei dieses Formats, `auth` = falscher Schlüssel oder verändert, `truncated` = abgeschnitten). */
export function createDecryptStream(masterKey: Buffer): Transform {
  let buffer: Buffer = Buffer.alloc(0);
  let header: Buffer | null = null;
  let key: Buffer | null = null;
  let chunkSize = 0;
  let counter = 0;
  let held: Buffer | null = null;

  const open = (record: Buffer, final: boolean): Buffer => {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key!, nonce(counter++));
      decipher.setAAD(aad(header!, final));
      decipher.setAuthTag(record.subarray(record.length - TAG_LENGTH));
      return Buffer.concat([decipher.update(record.subarray(0, record.length - TAG_LENGTH)), decipher.final()]);
    } catch {
      throw new OffsiteCryptoError("auth");
    }
  };

  /** Liest den Kopf, sobald er vollständig da ist; eine fremde Datei fällt schon an den ersten Bytes auf. */
  const parseHeader = (): boolean => {
    const known = Math.min(OFFSITE_MAGIC.length, buffer.length);
    if (!buffer.subarray(0, known).equals(OFFSITE_MAGIC.subarray(0, known))) throw new OffsiteCryptoError("format");
    if (buffer.length < HEADER_LENGTH) return false;
    const candidate = buffer.subarray(0, HEADER_LENGTH);
    const size = candidate.readUInt32BE(8);
    if (candidate[4] !== OFFSITE_VERSION || candidate.readUIntBE(5, 3) !== 0 || size < MIN_CHUNK_SIZE || size > MAX_CHUNK_SIZE) throw new OffsiteCryptoError("format");
    header = Buffer.from(candidate);
    chunkSize = size;
    key = fileKey(masterKey, header.subarray(12, 44));
    buffer = buffer.subarray(HEADER_LENGTH);
    return true;
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
        if (!header && !parseHeader()) return callback();
        for (;;) {
          if (buffer.length < 4) break;
          const length = buffer.readUInt32BE(0);
          if (length < TAG_LENGTH || length > chunkSize + TAG_LENGTH) throw new OffsiteCryptoError("format");
          if (buffer.length < 4 + length) break;
          const record = Buffer.from(buffer.subarray(4, 4 + length));
          buffer = buffer.subarray(4 + length);
          // Der vorige Block ist nun sicher nicht der letzte
          if (held) this.push(open(held, false));
          held = record;
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        // Kein Kopf, Rest eines angefangenen Blocks oder kein Endblock: abgeschnitten
        if (!header || buffer.length > 0 || !held) throw new OffsiteCryptoError("truncated");
        this.push(open(held, true));
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}
