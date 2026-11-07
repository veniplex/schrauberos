import "server-only";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DISK_RESERVE_BYTES, freeBytes } from "@/lib/disk";
import { backupsDir } from "./core";
import { RestoreError } from "./restore";

/** Größtes angenommenes Backup-Archiv (Byte). Darüber wird mitten im Strom abgebrochen – auch wenn der Absender keine Länge angibt. */
export const BACKUP_UPLOAD_MAX_BYTES = 100 * 1024 ** 3;
/** Alle so viel empfangenen Bytes wird der freie Platz erneut geprüft. */
const SPACE_CHECK_EVERY = 64 * 1024 * 1024;

/** Vorabprüfung der angekündigten Länge: Sie muss (einmal als Datei, einmal entpackt) samt Reserve in den freien Platz passen. Gibt den Fehlercode zurück oder null. */
export async function checkAnnouncedLength(contentLength: string | null): Promise<"tooLarge" | "diskFull" | null> {
  const announced = Number(contentLength);
  if (Number.isFinite(announced) && announced > BACKUP_UPLOAD_MAX_BYTES) return "tooLarge";
  const free = await freeBytes(backupsDir());
  if (free !== null && Number.isFinite(announced) && announced > 0 && announced * 2 + DISK_RESERVE_BYTES > free) return "diskFull";
  return null;
}

/**
 * Schreibt den Request-Body nach `tmp`. Schutz der Platte: Die Bytes werden gezählt (Obergrenze, auch ohne Längenangabe) und der freie Platz laufend geprüft – beim
 * Überschreiten bricht der Strom mit `RestoreError("tooLarge" | "diskFull")` ab (der Aufrufer löscht die halbe Datei). Gemeinsam genutzt vom Upload in der Verwaltung und von
 * der Wiederherstellung in der Einrichtung.
 */
export async function receiveBody(body: ReadableStream, tmp: string): Promise<void> {
  let received = 0;
  let checkedAt = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > BACKUP_UPLOAD_MAX_BYTES) return callback(new RestoreError("tooLarge"));
      if (received - checkedAt < SPACE_CHECK_EVERY) return callback(null, chunk);
      checkedAt = received;
      freeBytes(backupsDir()).then(
        (left) => (left !== null && left < DISK_RESERVE_BYTES + chunk.length ? callback(new RestoreError("diskFull")) : callback(null, chunk)),
        () => callback(null, chunk),
      );
    },
  });
  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), counter, createWriteStream(tmp));
}
