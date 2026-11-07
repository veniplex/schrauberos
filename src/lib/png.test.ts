import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePng, pngChunk, PNG_SIGNATURE } from "@/test/png";
import { crc32, inspectPng } from "./png";

const limits = { maxWidth: 2400, maxHeight: 800 };
const reason = (bytes: Uint8Array) => {
  const result = inspectPng(bytes, limits);
  return result.ok ? "ok" : result.reason;
};

describe("PNG: Strukturprüfung", () => {
  it("CRC-32 stimmt mit dem bekannten Prüfwert überein", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });

  it("ein echtes PNG wird angenommen, Maße werden geliefert", () => {
    assert.deepEqual(inspectPng(makePng(60, 20), limits), { ok: true, width: 60, height: 20 });
    assert.equal(reason(makePng(8, 4, { extra: 5000 })), "ok");
  });

  it("nur die Magic Bytes, Müll dahinter oder Abgeschnittenes sind kein PNG", () => {
    assert.equal(reason(PNG_SIGNATURE), "signature");
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, Buffer.from("<script>alert(1)</script>GIF89a".repeat(4))])), "chunks");
    const good = makePng(10, 10);
    assert.equal(reason(good.subarray(0, good.length - 5)), "chunks");
    assert.equal(reason(good.subarray(0, 40)), "signature");
    assert.equal(reason(Buffer.alloc(0)), "signature");
  });

  it("Anhängsel hinter IEND werden abgelehnt (Polyglot)", () => {
    assert.equal(reason(Buffer.concat([makePng(10, 10), Buffer.from("GIF89a<script>")])), "trailing");
    assert.equal(reason(Buffer.concat([makePng(10, 10), Buffer.alloc(1)])), "trailing");
  });

  it("ein falscher CRC in irgendeinem Teil lehnt ab", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(8, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    const idat = makePng(8, 4).subarray(8 + 25, makePng(8, 4).length - 12); // IDAT-Teil
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr, { badCrc: true }), idat, pngChunk("IEND")])), "crc");
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.from([1, 2, 3]), { badCrc: true }), pngChunk("IEND")])), "crc");
  });

  it("IHDR muss zuerst stehen und gültig sein; IDAT und IEND sind Pflicht", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(8, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    const data = pngChunk("IDAT", Buffer.from([1, 2, 3]));
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, data, pngChunk("IHDR", ihdr), pngChunk("IEND")])), "header");
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IEND")])), "end"); // kein IDAT
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), data])), "chunks"); // kein IEND
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), data, pngChunk("IHDR", ihdr), pngChunk("IEND")])), "header"); // zweites IHDR
    const badDepth = Buffer.from(ihdr);
    badDepth[8] = 7;
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", badDepth), data, pngChunk("IEND")])), "header");
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr.subarray(0, 12)), data, pngChunk("IEND")])), "header");
  });

  it("IDAT-Teile müssen aufeinanderfolgen", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(8, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    const a = pngChunk("IDAT", Buffer.from([1]));
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), a, a, pngChunk("IEND")])), "ok");
    assert.equal(reason(Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), a, pngChunk("tEXt", Buffer.from("a\0b")), a, pngChunk("IEND")])), "data");
  });

  it("Maße sind begrenzt: eine kleine Datei darf keine riesige Fläche deklarieren (Dekompressionsbombe)", () => {
    assert.equal(reason(makePng(8, 4, { ihdr: { width: 50_000, height: 50_000 } })), "size");
    assert.equal(reason(makePng(8, 4, { ihdr: { width: 2401, height: 10 } })), "size");
    assert.equal(reason(makePng(8, 4, { ihdr: { width: 10, height: 801 } })), "size");
    assert.equal(reason(makePng(8, 4, { ihdr: { width: 0, height: 4 } })), "size");
    assert.equal(reason(makePng(8, 4, { ihdr: { width: 4_294_967_295, height: 4_294_967_295 } })), "size");
    assert.equal(inspectPng(makePng(2400, 800), { ...limits, maxPixels: 1_000_000 }).ok, false);
  });

  it("Teile mit erfundener Länge laufen nicht über die Datei hinaus", () => {
    const bad = Buffer.from(makePng(8, 4));
    bad.writeUInt32BE(0xffffffff, 8 + 25); // Länge des IDAT
    assert.equal(reason(bad), "chunks");
  });

  it("zu viele Teile werden abgebrochen (linearer Aufwand)", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(8, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    const filler = Array.from({ length: 1000 }, () => pngChunk("tEXt", Buffer.from("a\0b")));
    const bytes = Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.from([1])), ...filler, pngChunk("IEND")]);
    assert.equal(reason(bytes), "chunks");
  });
});
