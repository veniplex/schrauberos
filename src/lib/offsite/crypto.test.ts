import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, it } from "node:test";
import { wrapSecretKey, unwrapSecretKey, deriveOffsiteMasterKey, secretKeyCheck } from "../secret-wrap";
import { createDecryptStream, createEncryptStream, HEADER_LENGTH, MIN_CHUNK_SIZE, OffsiteCryptoError, TAG_LENGTH } from "./crypto";

const master = randomBytes(32);

async function run(transform: NodeJS.ReadWriteStream, input: Buffer, piece = 1000): Promise<Buffer> {
  const out: Buffer[] = [];
  const pieces: Buffer[] = [];
  for (let i = 0; i < input.length; i += piece) pieces.push(input.subarray(i, i + piece));
  await pipeline(Readable.from(pieces), transform, async function (source: AsyncIterable<string | Buffer>) {
    for await (const chunk of source) out.push(Buffer.from(chunk));
  });
  return Buffer.concat(out);
}

const encrypt = (plain: Buffer, key = master, piece = 1000) => run(createEncryptStream(key, { chunkSize: MIN_CHUNK_SIZE }), plain, piece);
const decrypt = (blob: Buffer, key = master, piece = 777) => run(createDecryptStream(key), blob, piece);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OffsiteCryptoError) return error.code;
    throw error;
  }
  return "ok";
}

/** Zerlegt eine verschlüsselte Datei in Kopf und Blöcke (Länge · Daten). */
function records(blob: Buffer): { header: Buffer; list: Buffer[] } {
  const list: Buffer[] = [];
  let pos = HEADER_LENGTH;
  while (pos < blob.length) {
    const length = blob.readUInt32BE(pos);
    list.push(blob.subarray(pos, pos + 4 + length));
    pos += 4 + length;
  }
  return { header: blob.subarray(0, HEADER_LENGTH), list };
}

describe("Off-Site-Format (.sobk)", () => {
  it("verschlüsselt und entschlüsselt Größen an den Blockgrenzen verlustfrei", async () => {
    for (const size of [0, 1, MIN_CHUNK_SIZE - 1, MIN_CHUNK_SIZE, MIN_CHUNK_SIZE + 1, MIN_CHUNK_SIZE * 3, MIN_CHUNK_SIZE * 3 + 17]) {
      const plain = randomBytes(size);
      const blob = await encrypt(plain);
      assert.ok(size < 16 || !blob.includes(plain.subarray(0, 16)), "Klartext steht nicht im Chiffretext");
      assert.ok((await decrypt(blob)).equals(plain), `Größe ${size}`);
    }
  });

  it("liefert für dieselbe Eingabe jedes Mal einen anderen Chiffretext (Salz je Datei)", async () => {
    const plain = randomBytes(5000);
    assert.ok(!(await encrypt(plain)).equals(await encrypt(plain)));
  });

  it("erkennt einen falschen Schlüssel", async () => {
    const blob = await encrypt(randomBytes(9000));
    assert.equal(await codeOf(decrypt(blob, randomBytes(32))), "auth");
  });

  it("erkennt ein verändertes Bit im Kopf, im Block und im Tag", async () => {
    const blob = await encrypt(randomBytes(9000));
    for (const position of [13, 40, HEADER_LENGTH + 10, blob.length - 3]) {
      const bad = Buffer.from(blob);
      bad[position] ^= 0x01;
      assert.notEqual(await codeOf(decrypt(bad)), "ok", `Position ${position}`);
    }
  });

  it("erkennt eine fremde Datei und einen falschen Kopf", async () => {
    assert.equal(await codeOf(decrypt(Buffer.from("PK\x03\x04 kein Backup".padEnd(80, "x")))), "format");
    const blob = await encrypt(randomBytes(100));
    const wrongVersion = Buffer.from(blob);
    wrongVersion[4] = 3;
    assert.equal(await codeOf(decrypt(wrongVersion)), "format");
    const hugeChunk = Buffer.from(blob);
    hugeChunk.writeUInt32BE(0x7fffffff, 8);
    assert.equal(await codeOf(decrypt(hugeChunk)), "format");
  });

  it("erkennt abgeschnittene Ströme – auch an einer Blockgrenze", async () => {
    const blob = await encrypt(randomBytes(MIN_CHUNK_SIZE * 3 + 5));
    const { list } = records(blob);
    assert.equal(list.length, 4);
    // mitten in einem Block, mitten im Kopf, ganz leer
    assert.equal(await codeOf(decrypt(blob.subarray(0, blob.length - 10))), "truncated");
    assert.equal(await codeOf(decrypt(blob.subarray(0, 20))), "truncated");
    assert.equal(await codeOf(decrypt(Buffer.alloc(0))), "truncated");
    assert.equal(await codeOf(decrypt(blob.subarray(0, HEADER_LENGTH))), "truncated");
    // der Endblock fehlt, der Rest ist an der Blockgrenze sauber abgeschnitten
    const cut = blob.subarray(0, blob.length - list[3].length);
    assert.notEqual(await codeOf(decrypt(cut)), "ok");
  });

  it("erkennt vertauschte, doppelte und entfernte Blöcke", async () => {
    const blob = await encrypt(randomBytes(MIN_CHUNK_SIZE * 3 + 5));
    const { header, list } = records(blob);
    assert.notEqual(await codeOf(decrypt(Buffer.concat([header, list[1], list[0], list[2], list[3]]))), "ok", "vertauscht");
    assert.notEqual(await codeOf(decrypt(Buffer.concat([header, list[0], list[0], list[1], list[2], list[3]]))), "ok", "doppelt");
    assert.notEqual(await codeOf(decrypt(Buffer.concat([header, list[0], list[2], list[3]]))), "ok", "entfernt");
    assert.notEqual(await codeOf(decrypt(Buffer.concat([header, list[0], list[1], list[3]]))), "ok", "entfernt (vorletzter)");
  });

  it("erkennt Anhängsel hinter dem Endblock und einen Block aus einer anderen Datei", async () => {
    const blob = await encrypt(randomBytes(MIN_CHUNK_SIZE + 5));
    assert.notEqual(await codeOf(decrypt(Buffer.concat([blob, randomBytes(30)]))), "ok");
    const other = records(await encrypt(randomBytes(MIN_CHUNK_SIZE + 5)));
    const mine = records(blob);
    assert.notEqual(await codeOf(decrypt(Buffer.concat([mine.header, mine.list[0], other.list[1]]))), "ok");
    // der Endblock einer fremden Datei, aber unter eigenem Kopf
    assert.notEqual(await codeOf(decrypt(Buffer.concat([mine.header, other.list[0], other.list[1]]))), "ok");
  });

  it("gibt Klartext erst aus, wenn der Block geprüft ist (nie ein unbeglaubigtes Byte)", async () => {
    const plain = randomBytes(MIN_CHUNK_SIZE * 2 + 5);
    const bad = Buffer.from(await encrypt(plain));
    bad[bad.length - 1] ^= 0xff; // Tag des Endblocks
    const seen: Buffer[] = [];
    await assert.rejects(
      pipeline(Readable.from([bad]), createDecryptStream(master), async function (source: AsyncIterable<string | Buffer>) {
        for await (const chunk of source) seen.push(Buffer.from(chunk));
      }),
    );
    assert.ok(Buffer.concat(seen).length <= MIN_CHUNK_SIZE * 2, "höchstens die geprüften Blöcke");
    assert.ok(plain.subarray(0, Buffer.concat(seen).length).equals(Buffer.concat(seen)));
  });

  it("hält die Datei klein: Blocklänge plus Tag und Längenfeld je Block", async () => {
    const plain = randomBytes(MIN_CHUNK_SIZE * 2);
    const blob = await encrypt(plain);
    assert.equal(blob.length, HEADER_LENGTH + 2 * (4 + MIN_CHUNK_SIZE + TAG_LENGTH), "der letzte volle Block ist der Endblock (kein leerer Anhang)");
  });
});

describe("Kontext im Kopf (Name der Sicherung, ZP5-9)", () => {
  const NAME = "schrauberos-20260101T020000Z-auto";
  const withContext = (plain: Buffer, context = NAME) => run(createEncryptStream(master, { chunkSize: MIN_CHUNK_SIZE, context }), plain, 1000);
  const expecting = (blob: Buffer, expectContext: string | undefined, key = master) => run(createDecryptStream(key, { expectContext }), blob, 777);

  it("der Name steht im Kopf; mit dem erwarteten Namen (oder ohne Erwartung) wird entschlüsselt", async () => {
    const plain = randomBytes(MIN_CHUNK_SIZE * 2 + 3);
    const blob = await withContext(plain);
    assert.equal(blob.readUInt16BE(44), NAME.length);
    assert.equal(blob.subarray(HEADER_LENGTH, HEADER_LENGTH + NAME.length).toString("utf8"), NAME);
    assert.ok((await expecting(blob, NAME)).equals(plain));
    assert.ok((await expecting(blob, undefined)).equals(plain), "ohne Erwartung (hochgeladene Datei) bleibt es möglich");
  });

  it("eine Datei unter fremdem Namen (ältere Datei als neuere ausgegeben) fällt auf – bei jedem Namensunterschied", async () => {
    const blob = await withContext(randomBytes(500));
    for (const other of ["schrauberos-20260102T020000Z-auto", "schrauberos-20260101T020000Z-manual", "", NAME + "x"]) {
      assert.equal(await codeOf(expecting(blob, other)), "context", other);
    }
  });

  it("der Name im Kopf ist beglaubigt: wer ihn ändert (auch auf den erwarteten Namen), scheitert an der Prüfung", async () => {
    const old = await withContext(randomBytes(500), "schrauberos-20250101T020000Z-auto");
    const forged = Buffer.from(old);
    forged.write(NAME, HEADER_LENGTH, "utf8"); // gleiche Länge, anderer Name
    assert.equal(forged.readUInt16BE(44), NAME.length);
    assert.equal(await codeOf(expecting(forged, NAME)), "auth");
    assert.equal(await codeOf(expecting(forged, undefined)), "auth");
  });

  it("ein zu langer Kontext oder ein beschädigtes Längenfeld wird abgewiesen", async () => {
    assert.throws(() => createEncryptStream(master, { context: "x".repeat(256) }));
    const blob = await withContext(randomBytes(100));
    const huge = Buffer.from(blob);
    huge.writeUInt16BE(0xffff, 44);
    assert.equal(await codeOf(expecting(huge, undefined)), "format");
  });
});

describe("Umhüllung des Geheimnisschlüssels", () => {
  const secret = randomBytes(32).toString("hex");

  it("öffnet die Hülle nur mit dem richtigen Schlüssel", () => {
    const key = randomBytes(32);
    const blob = wrapSecretKey(secret, key);
    assert.ok(!blob.includes(secret));
    assert.equal(unwrapSecretKey(blob, key), secret);
    assert.equal(unwrapSecretKey(blob, randomBytes(32)), null);
    assert.equal(unwrapSecretKey(blob.slice(0, -3) + "AAA", key), null);
    assert.equal(unwrapSecretKey("müll", key), null);
    assert.notEqual(wrapSecretKey(secret, key), blob, "Salz und Nonce sind zufällig");
  });

  it("leitet Off-Site-Hauptschlüssel und Hüllenschlüssel unabhängig ab", () => {
    const key = randomBytes(32);
    assert.ok(deriveOffsiteMasterKey(key).equals(deriveOffsiteMasterKey(key)));
    assert.ok(!deriveOffsiteMasterKey(key).equals(key));
    assert.ok(!deriveOffsiteMasterKey(key).equals(deriveOffsiteMasterKey(randomBytes(32))));
  });

  it("der Kennwert verrät den Schlüssel nicht und unterscheidet Schlüssel", () => {
    assert.ok(!secretKeyCheck(secret).includes(secret.slice(0, 16)));
    assert.equal(secretKeyCheck(secret), secretKeyCheck(secret));
    assert.notEqual(secretKeyCheck(secret), secretKeyCheck(randomBytes(32).toString("hex")));
  });
});
