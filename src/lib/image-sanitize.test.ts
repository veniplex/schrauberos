import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iccProfile, jpeg, seg, SECRET, tiffWith } from "@/test/images";
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
  /** `extra` kommt vor IEND (hinter die Bilddaten), `early` direkt hinter IHDR (vor die Bilddaten) */
  const pngWith = (extra: Buffer[], options: { width?: number; height?: number; early?: Buffer[] } = {}) => {
    const base = makePng(options.width ?? 8, options.height ?? 4);
    const ihdrEnd = 8 + 25;
    return Buffer.concat([base.subarray(0, ihdrEnd), ...(options.early ?? []), base.subarray(ihdrEnd, base.length - 12), ...extra, base.subarray(base.length - 12)]);
  };

  it("entfernt Texte (tEXt/zTXt/iTXt/XMP), eXIf und tIME; Bilddaten und Maße bleiben; ein Farbprofil bleibt", () => {
    const input = pngWith([
      pngChunk("tEXt", Buffer.from(`Author\0${SECRET}`, "latin1")),
      pngChunk("iTXt", Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${SECRET}`, "latin1")),
      pngChunk("zTXt", Buffer.from(`Comment\0\0${SECRET}`, "latin1")),
      pngChunk("tIME", Buffer.from([7, 234, 11, 7, 12, 0, 0])),
      pngChunk("eXIf", tiffWith(1)),
    ], { early: [pngChunk("iCCP", Buffer.from("sRGB\0\0abc", "latin1")), pngChunk("gAMA", Buffer.from([0, 1, 0x86, 0xa0]))] });
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

describe("Positivliste (JPEG): nur Bekanntes und Geprüftes bleibt", () => {
  /** Ein JPEG mit zusätzlichen Segmenten direkt hinter dem JFIF-Kopf (`after`: hinter den Bilddaten, vor EOI). */
  const jpegWith = (extra: Buffer[], after: Buffer[] = []) => {
    const base = jpeg();
    const dqt = base.indexOf(Buffer.from([0xff, 0xdb]));
    const eoi = base.length - 2;
    return Buffer.concat([base.subarray(0, dqt), ...extra, base.subarray(dqt, eoi), ...after, base.subarray(eoi)]);
  };
  const secret = Buffer.from(SECRET, "latin1");

  it("unbekannte, reservierte und Erweiterungsmarker samt Nutzlast fallen weg (auch hinter den Bilddaten)", () => {
    for (const marker of [0x02, 0x40, 0xbf, 0xc8, 0xdc, 0xde, 0xdf, 0xf0, 0xf7, 0xfc, 0xfd, 0xcc]) {
      const result = ok(sanitizeImage(jpegWith([seg(marker, secret)], [seg(marker, secret)])));
      assert.ok(!has(result.bytes, SECRET), `0x${marker.toString(16)}`);
    }
  });

  it("Adobe: nur die zwölf Bytes bleiben; ein Anhängsel entfernt das ganze Segment", () => {
    const fixed = Buffer.from("Adobe\0\x64\0\0\0\0\x01", "latin1");
    const kept = ok(sanitizeImage(jpegWith([seg(0xee, fixed)])));
    assert.ok(has(kept.bytes, "Adobe"));
    const padded = ok(sanitizeImage(jpegWith([seg(0xee, Buffer.concat([fixed, secret]))])));
    assert.ok(!has(padded.bytes, SECRET) && !has(padded.bytes, "Adobe"));
  });

  it("ICC: ein gültiges Profil (auch in Teilen) bleibt; Nutzlast statt Profil, Lücke, falsche Größe oder zu groß entfällt", () => {
    const icc = (seq: number, count: number, data: Buffer) => seg(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([seq, count]), data]));
    assert.ok(has(ok(sanitizeImage(jpegWith([icc(1, 1, iccProfile())]))).bytes, "ICC_PROFILE"));
    const profile = iccProfile(2000);
    assert.ok(has(ok(sanitizeImage(jpegWith([icc(1, 2, profile.subarray(0, 1000)), icc(2, 2, profile.subarray(1000))]))).bytes, "ICC_PROFILE"), "zwei Teile");
    const bad: Buffer[][] = [
      [icc(1, 1, Buffer.concat([iccProfile(), secret]))], // Größe im Kopf stimmt nicht mehr
      [icc(1, 1, secret)], // kein Profil
      [icc(2, 2, iccProfile())], // Teil 1 fehlt
      [icc(1, 2, iccProfile())], // Teil 2 fehlt
      [icc(1, 1, iccProfile(60_000)), icc(2, 1, iccProfile(60_000))], // verwirrte Folge
    ];
    for (const extra of bad) {
      const result = ok(sanitizeImage(jpegWith(extra)));
      assert.ok(!has(result.bytes, "ICC_PROFILE") && !has(result.bytes, SECRET));
    }
    // über 128 KB in mehreren Teilen
    const huge = iccProfile(140_000);
    const parts = [huge.subarray(0, 60_000), huge.subarray(60_000, 120_000), huge.subarray(120_000)];
    const result = ok(sanitizeImage(jpegWith(parts.map((part, i) => icc(i + 1, 3, part)))));
    assert.ok(!has(result.bytes, "ICC_PROFILE"));
  });

  it("DQT, DHT, DRI und SOF/SOS mit Anhängsel oder falschem Aufbau machen die Datei beschädigt", () => {
    const dqt = seg(0xdb, Buffer.concat([Buffer.from([1]), Buffer.alloc(128, 16), secret]));
    assert.deepEqual(sanitizeImage(jpegWith([dqt])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(jpegWith([seg(0xdd, Buffer.concat([Buffer.from([0, 4]), secret]))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(jpegWith([seg(0xc4, Buffer.concat([Buffer.from([0x00, 1, ...new Array(15).fill(0)]), Buffer.from([0]), secret]))])), { ok: false, reason: "corrupt" }, "DHT: mehr Bytes als Zähler");
    assert.deepEqual(sanitizeImage(jpegWith([seg(0xdb, Buffer.alloc(0))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(jpegWith([seg(0xc9, Buffer.from([8, 0, 4, 0, 8, 1, 1, 0x11, 0]))])), { ok: false, reason: "corrupt" }, "arithmetisch codiert");
  });

  it("zu viele Segmente: beschädigt statt Ausnahme oder Speicherspitze (200 000 DRI, linear schnell)", () => {
    const dri = seg(0xdd, Buffer.from([0, 4]));
    const many = Buffer.concat(new Array(200_000).fill(dri));
    const started = Date.now();
    assert.deepEqual(sanitizeImage(jpegWith([many])), { ok: false, reason: "corrupt" });
    assert.ok(Date.now() - started < 5000);
    // eine übliche Zahl bleibt brauchbar
    ok(sanitizeImage(jpegWith(new Array(500).fill(dri))));
  });

  it("wirft nie: zufällig zerstörte Dateien ergeben ein Ergebnis", () => {
    const base = jpeg({ exif: tiffWith(6), icc: true, adobe: true });
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 300; i++) {
      const copy = Buffer.from(base);
      for (let k = 0; k < 4; k++) copy[next() % copy.length] = next() & 0xff;
      const cut = copy.subarray(0, 4 + (next() % (copy.length - 4)));
      for (const sample of [copy, cut]) assert.doesNotThrow(() => sanitizeImage(sample));
    }
  });
});

describe("Positivliste (PNG): Teile fester Form bleiben, alles andere fällt weg", () => {
  const base = (early: Buffer[], late: Buffer[] = []) => {
    const png = makePng(8, 4);
    return Buffer.concat([png.subarray(0, 33), ...early, png.subarray(33, png.length - 12), ...late, png.subarray(png.length - 12)]);
  };
  const secret = Buffer.from(SECRET, "latin1");

  it("gAMA, cHRM, sRGB, pHYs und iCCP mit richtiger Länge bleiben; sBIT, bKGD, hIST, sPLT, tIME und Texte fallen samt Nutzlast weg", () => {
    const early = [
      pngChunk("gAMA", Buffer.from([0, 1, 0x86, 0xa0])),
      pngChunk("cHRM", Buffer.alloc(32, 1)),
      pngChunk("sRGB", Buffer.from([0])),
      pngChunk("pHYs", Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
      pngChunk("sBIT", Buffer.concat([Buffer.from([8]), secret])),
      pngChunk("bKGD", Buffer.concat([Buffer.from([0, 1]), secret])),
      pngChunk("hIST", secret),
      pngChunk("sPLT", Buffer.concat([Buffer.from("p\0\x08"), secret])),
    ];
    const result = ok(sanitizeImage(base(early, [pngChunk("tIME", secret)])));
    for (const name of ["gAMA", "cHRM", "sRGB", "pHYs"]) assert.ok(has(result.bytes, name), name);
    for (const name of ["sBIT", "bKGD", "hIST", "sPLT", "tIME"]) assert.ok(!has(result.bytes, name), name);
    assert.ok(!has(result.bytes, SECRET));
  });

  it("falsche Länge eines Teils fester Form (gAMA mit 5 MB Nutzlast, cHRM zu kurz, sRGB mit Anhängsel, pHYs) macht die Datei beschädigt; doppelte Teile ebenso", () => {
    assert.deepEqual(sanitizeImage(base([pngChunk("gAMA", Buffer.alloc(5 * 1024 * 1024, 0x41))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("gAMA", Buffer.alloc(5))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("cHRM", Buffer.alloc(31))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("sRGB", Buffer.from([0, 1]))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("pHYs", Buffer.alloc(10))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("gAMA", Buffer.alloc(4)), pngChunk("gAMA", Buffer.alloc(4))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("iCCP", Buffer.from("\0\0abc", "latin1"))])), { ok: false, reason: "corrupt" }, "iCCP ohne Namen");
    assert.deepEqual(sanitizeImage(base([pngChunk("iCCP", Buffer.concat([Buffer.from("p\0\0", "latin1"), Buffer.alloc(200_000)]))])), { ok: false, reason: "corrupt" }, "iCCP zu groß");
  });

  it("tRNS passt zum Farbtyp (Graustufen: 2 Bytes); ein unbekannter kritischer Teil ist ein Fehler; unbekannte Hilfsteile entfallen", () => {
    assert.ok(has(ok(sanitizeImage(base([pngChunk("tRNS", Buffer.from([0, 7]))]))).bytes, "tRNS"));
    assert.deepEqual(sanitizeImage(base([pngChunk("tRNS", Buffer.concat([Buffer.from([0, 7]), secret]))])), { ok: false, reason: "corrupt" });
    assert.deepEqual(sanitizeImage(base([pngChunk("ZZZZ", secret)])), { ok: false, reason: "corrupt" });
    assert.ok(!has(ok(sanitizeImage(base([pngChunk("zzZz", secret)]))).bytes, SECRET));
  });

  it("Teile hinter den Bilddaten haben keine Bedeutung und entfallen", () => {
    const result = ok(sanitizeImage(base([], [pngChunk("gAMA", Buffer.alloc(4))])));
    assert.ok(!has(result.bytes, "gAMA"));
  });

  it("mehr als 1024 IDAT-Teile (große Dateien aus Encodern mit kleinen Teilen) sind erlaubt; unbegrenzt viele nicht", () => {
    const png = makePng(8, 4);
    const idat = pngChunk("IDAT", Buffer.alloc(64, 1));
    const many = (count: number) => Buffer.concat([png.subarray(0, 33), ...new Array(count).fill(idat), png.subarray(png.length - 12)]);
    ok(sanitizeImage(many(1300)));
    assert.deepEqual(sanitizeImage(many(100_500)), { ok: false, reason: "corrupt" });
  });

  it("criticalOnly (Unterschriften): nur IHDR, PLTE, IDAT und IEND bleiben", () => {
    const early = [pngChunk("gAMA", Buffer.alloc(4)), pngChunk("pHYs", Buffer.alloc(9)), pngChunk("tRNS", Buffer.from([0, 1])), pngChunk("eXIf", tiffWith(6))];
    const result = ok(sanitizeImage(base(early), undefined, { criticalOnly: true }));
    for (const name of ["gAMA", "pHYs", "tRNS", "eXIf"]) assert.ok(!has(result.bytes, name), name);
    assert.equal(result.orientation, 1);
    assert.ok(has(result.bytes, "IHDR") && has(result.bytes, "IDAT") && has(result.bytes, "IEND"));
  });
});
