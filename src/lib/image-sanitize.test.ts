import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jpeg, SECRET, tiffWith } from "@/test/images";
import { makePng, PNG_SIGNATURE, pngChunk } from "@/test/png";
import { IMAGE_LIMITS, minimalTiff, orientationOfTiff, sanitizeImage } from "./image-sanitize";

/**
 * Bereinigung von Fotos an echten (strukturell vollständigen) Testbildern: Metadaten und Anhängsel fallen weg, Bilddaten und Ausrichtung bleiben, Dekompressionsbomben werden am Dateikopf abgewiesen.
 */
const ok = (result: ReturnType<typeof sanitizeImage>) => {
  assert.ok(result.ok, JSON.stringify(result));
  return result;
};
const has = (buffer: Buffer, text: string) => buffer.includes(Buffer.from(text, "latin1"));

describe("JPEG", () => {
  it("entfernt Exif (GPS, Kamera), XMP, IPTC, MPF, Kommentare, Vorschaubild und alles hinter dem Ende – Bilddaten und Maße bleiben", () => {
    const input = jpeg({ exif: tiffWith(1), comment: true, iptc: true, mpf: true, thumbnail: true, trailing: true });
    assert.ok(has(input, SECRET));
    const result = ok(sanitizeImage(input));
    assert.equal(result.kind, "jpeg");
    assert.deepEqual([result.width, result.height], [8, 4]);
    assert.ok(!has(result.bytes, SECRET), "kein Geheimnis mehr in der Datei");
    assert.ok(!has(result.bytes, "Exif"), "keine Exif-Daten");
    assert.ok(!has(result.bytes, "xmpmeta") && !has(result.bytes, "Photoshop") && !has(result.bytes, "MPF") && !has(result.bytes, "<?php"));
    assert.ok(has(result.bytes, "JFIF"), "JFIF-Kopf bleibt");
    assert.deepEqual([...result.bytes.subarray(-2)], [0xff, 0xd9], "endet mit EOI");
    assert.ok(result.removedBytes > 0);
    // Bilddaten (entropiecodierte Bytes samt Stopfbyte und Restart) unverändert
    assert.ok(result.bytes.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78])));
  });

  it("die Ausrichtung bleibt erhalten: nur ein minimaler Exif-Block mit der Ausrichtung, ohne Make/GPS; Ausrichtung 1 schreibt keinen Exif-Block", () => {
    for (const little of [true, false]) {
      const result = ok(sanitizeImage(jpeg({ exif: tiffWith(6, little) })));
      assert.equal(result.orientation, 6);
      assert.ok(has(result.bytes, "Exif"));
      assert.ok(!has(result.bytes, SECRET));
      // erneutes Bereinigen ändert nichts mehr und liest dieselbe Ausrichtung
      const again = ok(sanitizeImage(result.bytes));
      assert.equal(again.orientation, 6);
      assert.ok(again.bytes.equals(result.bytes));
    }
    const upright = ok(sanitizeImage(jpeg({ exif: tiffWith(1) })));
    assert.equal(upright.orientation, 1);
    assert.ok(!has(upright.bytes, "Exif"));
    assert.equal(ok(sanitizeImage(jpeg())).orientation, 1, "ohne Exif");
  });

  it("behält Farbprofil (ICC) und Adobe-Segment, damit die Farben stimmen", () => {
    const result = ok(sanitizeImage(jpeg({ icc: true, adobe: true })));
    assert.ok(has(result.bytes, "ICC_PROFILE") && has(result.bytes, "Adobe"));
  });

  it("weist Dekompressionsbomben am Dateikopf ab (vor jedem Dekodieren): zu viele Bildpunkte oder zu lange Kante", () => {
    assert.deepEqual(sanitizeImage(jpeg({ width: 8000, height: 7000 })), { ok: false, reason: "size" }, "56 Megapixel");
    assert.deepEqual(sanitizeImage(jpeg({ width: 65_535, height: 65_535 })), { ok: false, reason: "size" });
    assert.deepEqual(sanitizeImage(jpeg({ width: 25_000, height: 100 })), { ok: false, reason: "size" }, "Kante über 20 000");
    ok(sanitizeImage(jpeg({ width: 7000, height: 7000 }))); // 49 Megapixel sind erlaubt
    assert.equal(IMAGE_LIMITS.maxPixels, 50_000_000);
  });

  it("weist Unvollständiges und Fremdes ab", () => {
    assert.deepEqual(sanitizeImage(jpeg({ truncate: true })), { ok: false, reason: "corrupt" }, "kein EOI");
    assert.deepEqual(sanitizeImage(jpeg({ noScan: true })), { ok: false, reason: "corrupt" }, "keine Bilddaten");
    assert.deepEqual(sanitizeImage(jpeg().subarray(0, 40)), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(Buffer.from("GIF89a-nicht-erlaubt")), { ok: false, reason: "format" });
    assert.deepEqual(sanitizeImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), { ok: false, reason: "format" });
    assert.deepEqual(sanitizeImage(Buffer.alloc(0)), { ok: false, reason: "format" });
  });

  it("liest die Ausrichtung nur innerhalb der Daten (kaputte Blöcke ergeben 1, nie einen Fehler)", () => {
    assert.equal(orientationOfTiff(Buffer.from("MM")), 1);
    const broken = tiffWith(8);
    broken.writeUInt32LE(0xffffff, 4);
    assert.equal(orientationOfTiff(broken), 1);
    assert.equal(orientationOfTiff(minimalTiff(3)), 3);
    assert.equal(orientationOfTiff(tiffWith(9)), 1, "ungültiger Wert");
  });
});

describe("PNG", () => {
  const pngWith = (extra: Buffer[], options: { width?: number; height?: number } = {}) => {
    const base = makePng(options.width ?? 8, options.height ?? 4);
    // vor IEND einfügen (Länge 12 Bytes)
    return Buffer.concat([base.subarray(0, base.length - 12), ...extra, base.subarray(base.length - 12)]);
  };

  it("entfernt Texte (tEXt/zTXt/iTXt/XMP), eXIf und tIME; Bilddaten und Maße bleiben; ein Farbprofil bleibt", () => {
    const input = pngWith([
      pngChunk("tEXt", Buffer.from(`Author\0${SECRET}`, "latin1")),
      pngChunk("iTXt", Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${SECRET}`, "latin1")),
      pngChunk("zTXt", Buffer.from(`Comment\0\0${SECRET}`, "latin1")),
      pngChunk("tIME", Buffer.from([7, 234, 11, 7, 12, 0, 0])),
      pngChunk("eXIf", tiffWith(1)),
      pngChunk("iCCP", Buffer.from("sRGB\0\0abc", "latin1")),
      pngChunk("gAMA", Buffer.from([0, 1, 0x86, 0xa0])),
    ]);
    const result = ok(sanitizeImage(input));
    assert.equal(result.kind, "png");
    assert.deepEqual([result.width, result.height], [8, 4]);
    for (const name of ["tEXt", "iTXt", "zTXt", "tIME", "eXIf"]) assert.ok(!has(result.bytes, name), name);
    assert.ok(!has(result.bytes, SECRET));
    assert.ok(has(result.bytes, "iCCP") && has(result.bytes, "gAMA") && has(result.bytes, "IDAT"));
    // die bereinigte Datei besteht die Strukturprüfung weiterhin
    assert.ok(ok(sanitizeImage(result.bytes)).bytes.equals(result.bytes));
  });

  it("die Ausrichtung bleibt: ein minimaler eXIf-Block direkt hinter IHDR, ohne Make/GPS", () => {
    const result = ok(sanitizeImage(pngWith([pngChunk("eXIf", tiffWith(3, false))])));
    assert.equal(result.orientation, 3);
    const at = result.bytes.indexOf(Buffer.from("eXIf", "latin1"));
    assert.ok(at > 0 && at < result.bytes.indexOf(Buffer.from("IDAT", "latin1")), "vor den Bilddaten");
    assert.ok(!has(result.bytes, SECRET));
    assert.equal(ok(sanitizeImage(result.bytes)).orientation, 3);
  });

  it("weist Bomben (deklarierte Maße), angehängte Daten und kaputte Prüfsummen ab", () => {
    assert.deepEqual(sanitizeImage(makePng(8, 4, { ihdr: { width: 100_000, height: 100_000 } })), { ok: false, reason: "size" });
    assert.deepEqual(sanitizeImage(makePng(8, 4, { ihdr: { width: 9000, height: 6000 } })), { ok: false, reason: "size" }, "54 Megapixel");
    assert.deepEqual(sanitizeImage(Buffer.concat([makePng(), Buffer.from(SECRET)])), { ok: false, reason: "corrupt" });
    const bad = Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", Buffer.alloc(13), { badCrc: true })]);
    assert.deepEqual(sanitizeImage(bad), { ok: false, reason: "corrupt" });
  });
});
