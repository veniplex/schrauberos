import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImageError, imageSize, prepareImage, sniffImage, type ImageEngine, type OutputType, type Raster } from "./image-resize";

/**
 * Die Entscheidungen des Foto-Bausteins (was wird verkleinert, was bleibt, welches Format) mit einer Fake-Engine: Das Dekodieren liefert vorgegebene Maße, das Kodieren eine
 * Datei, deren Größe mit der Pixelzahl wächst (wie bei einem echten JPEG). Das echte Canvas kommt erst in der Browser-CI.
 */
const MB = 1024 * 1024;

type Call = { width: number; height: number; type: OutputType; quality: number };

function fakeEngine(size: { width: number; height: number } | "fail", options: { bytesPerPixel?: number; returnType?: string } = {}) {
  const calls: Call[] = [];
  let closed = 0;
  let decoded = 0;
  const engine: ImageEngine = {
    async decode() {
      decoded++;
      if (size === "fail") throw new Error("kann ich nicht");
      return { ...size, close: () => void closed++ } satisfies Raster;
    },
    async encode(_raster, width, height, type, quality) {
      calls.push({ width, height, type, quality });
      return new Blob([new Uint8Array(Math.max(1, Math.round(width * height * (options.bytesPerPixel ?? 0.5))))], { type: options.returnType ?? type });
    },
  };
  return { engine, calls, closed: () => closed, decoded: () => decoded };
}

function bytes(...parts: Array<number[] | string | Uint8Array>) {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

/** Datei mit gültigem Anfang (Magic Bytes) und beliebigem Rest bis `total` Bytes */
function fileOf(name: string, type: string, head: Uint8Array, total: number) {
  const body = new Uint8Array(Math.max(total, head.length));
  body.set(head);
  return new File([body], name, { type, lastModified: 1_700_000_000_000 });
}

const jpegHead = () => bytes([0xff, 0xd8, 0xff, 0xe0], new Array(20).fill(0));
const pngHead = (colorType: number, extra: Uint8Array = new Uint8Array()) =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], "IHDR", [0, 0, 0x0f, 0xa0, 0, 0, 0x0b, 0xb8, 8, colorType, 0, 0, 0], [0, 0, 0, 0], extra);
const webpHead = (chunk: "VP8X" | "VP8L" | "VP8 ", payload: number[]) => bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [10, 0, 0, 0], payload, new Array(10).fill(0));

describe("Pixelobergrenze (ZP5-14)", () => {
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  /** PNG-Kopf mit beliebigen Maßen */
  const pngSized = (width: number, height: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], "IHDR", be32(width), be32(height), [8, 2, 0, 0, 0], [0, 0, 0, 0]);
  /** JPEG: großer APP1-Abschnitt (EXIF) vor dem Rahmenkopf, dann SOF0 mit den Maßen */
  const jpegSized = (width: number, height: number, app1 = 6000) => bytes([0xff, 0xd8], [0xff, 0xe1, (app1 + 2) >> 8, (app1 + 2) & 255], new Array(app1).fill(0), [0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3], new Array(20).fill(0));
  const webpX = (width: number, height: number) => webpHead("VP8X", [0, 0, 0, 0, (width - 1) & 255, ((width - 1) >> 8) & 255, ((width - 1) >> 16) & 255, (height - 1) & 255, ((height - 1) >> 8) & 255, ((height - 1) >> 16) & 255]);

  it("liest die Maße aus PNG, JPEG (auch hinter großen EXIF-Abschnitten) und WebP (VP8X)", () => {
    assert.deepEqual(imageSize(pngSized(20000, 30000), "png"), { width: 20000, height: 30000 });
    assert.deepEqual(imageSize(jpegSized(9000, 7000), "jpeg"), { width: 9000, height: 7000 });
    assert.deepEqual(imageSize(webpX(30000, 20000), "webp"), { width: 30000, height: 20000 });
    assert.equal(imageSize(jpegHead(), "jpeg"), null, "ohne Rahmenkopf: unbekannt");
    assert.equal(imageSize(bytes("kaputt"), "png"), null);
  });

  it("ein Bild über 100 Megapixel wird nicht dekodiert (unverändert); kleine und unbekannte Maße laufen wie bisher", async () => {
    for (const [name, type, head] of [
      ["riesig.png", "image/png", pngSized(20000, 20000)],
      ["riesig.jpg", "image/jpeg", jpegSized(15000, 10000)],
      ["riesig.webp", "image/webp", webpX(12000, 12000)],
    ] as const) {
      const file = fileOf(name, type, head, 3 * MB);
      const { engine, decoded, calls } = fakeEngine({ width: 4000, height: 3000 });
      const result = await prepareImage(file, engine);
      assert.equal(result.file, file, name);
      assert.equal(result.status, "unchanged");
      assert.equal(decoded(), 0, `${name}: nicht dekodiert`);
      assert.equal(calls.length, 0);
    }
    // gerade noch erlaubt (10000 × 10000 = 100 MP) und deutlich kleiner: wird dekodiert und verkleinert
    for (const head of [pngSized(10000, 10000), jpegSized(4000, 3000)]) {
      const { engine, decoded } = fakeEngine({ width: 4000, height: 3000 });
      const result = await prepareImage(fileOf("a.img", head[0] === 0x89 ? "image/png" : "image/jpeg", head, 6 * MB), engine);
      assert.equal(decoded(), 1);
      assert.equal(result.status, "resized");
    }
    // die Grenze lässt sich einstellen
    const strict = fakeEngine({ width: 4000, height: 3000 });
    const ok = fileOf("b.jpg", "image/jpeg", jpegSized(4000, 3000), 6 * MB);
    assert.equal((await prepareImage(ok, strict.engine, { maxPixels: 10_000_000 })).file, ok);
    assert.equal(strict.decoded(), 0);
  });
});

describe("prepareImage", () => {
  it("ein 6-MB-Handyfoto (4000 × 3000) wird auf 1600 px und unter 2 MB verkleinert, als JPEG mit Qualität 0,8", async () => {
    const photo = fileOf("IMG_0001.JPG", "image/jpeg", jpegHead(), 6 * MB);
    const { engine, calls, closed } = fakeEngine({ width: 4000, height: 3000 });
    const result = await prepareImage(photo, engine, { maxBytes: 2 * MB });
    assert.equal(result.status, "resized");
    assert.deepEqual(calls, [{ width: 1600, height: 1200, type: "image/jpeg", quality: 0.8 }]);
    assert.ok(result.file.size < 2 * MB, `Größe ${result.file.size}`);
    assert.equal(result.file.type, "image/jpeg");
    assert.equal(result.file.name, "IMG_0001.jpg", "Endung passt zum Format");
    assert.equal(result.file.lastModified, photo.lastModified);
    assert.equal(closed(), 1, "das dekodierte Bild wird freigegeben");
  });

  it("Hochformat: die längste Kante zählt", async () => {
    const photo = fileOf("a.jpg", "image/jpeg", jpegHead(), 5 * MB);
    const { engine, calls } = fakeEngine({ width: 3000, height: 4000 });
    await prepareImage(photo, engine);
    assert.deepEqual([calls[0].width, calls[0].height], [1200, 1600]);
  });

  it("PDF und XML bleiben unverändert und werden nicht einmal dekodiert", async () => {
    for (const [name, type, head] of [
      ["rechnung.pdf", "application/pdf", bytes("%PDF-1.7\n")],
      ["rechnung.xml", "application/xml", bytes("<?xml version='1.0'?><Invoice/>")],
      ["logo.svg", "image/svg+xml", bytes("<svg xmlns='http://www.w3.org/2000/svg'/>")],
    ] as const) {
      const file = fileOf(name, type, head, 6 * MB);
      const { engine, decoded } = fakeEngine({ width: 4000, height: 3000 });
      const result = await prepareImage(file, engine);
      assert.equal(result.file, file, name);
      assert.equal(result.status, "unchanged");
      assert.equal(decoded(), 0, `${name}: nicht dekodiert`);
    }
  });

  it("bis 1600 px und innerhalb der Grenze bleibt das Original (kein Neukodieren ohne Nutzen)", async () => {
    const small = fileOf("klein.jpg", "image/jpeg", jpegHead(), 300 * 1024);
    const { engine, calls } = fakeEngine({ width: 1200, height: 800 });
    const result = await prepareImage(small, engine, { maxBytes: 2 * MB });
    assert.equal(result.file, small);
    assert.equal(calls.length, 0);
  });

  it("bis 1600 px, aber über der Grenze: wird neu kodiert, damit es passt", async () => {
    const heavy = fileOf("schwer.jpg", "image/jpeg", jpegHead(), 3 * MB);
    const { engine, calls } = fakeEngine({ width: 1500, height: 1000 });
    const result = await prepareImage(heavy, engine, { maxBytes: 2 * MB });
    assert.equal(result.status, "resized");
    assert.deepEqual([calls[0].width, calls[0].height], [1500, 1000], "nicht vergrößert, nicht verkleinert");
  });

  it("wird die neue Fassung nicht kleiner, bleibt das Original", async () => {
    const photo = fileOf("a.jpg", "image/jpeg", jpegHead(), 200 * 1024);
    const { engine } = fakeEngine({ width: 4000, height: 3000 }, { bytesPerPixel: 1 });
    const result = await prepareImage(photo, engine);
    assert.equal(result.file, photo);
  });

  it("PNG mit Alpha (Farbtyp 6) wird nie zu JPEG; bis 1600 px bleibt es, größer wird als PNG verkleinert", async () => {
    const rgba = fileOf("logo.png", "image/png", pngHead(6), 3 * MB);
    const small = fakeEngine({ width: 800, height: 600 });
    assert.equal((await prepareImage(rgba, small.engine)).file, rgba);

    const big = fakeEngine({ width: 4000, height: 3000 }, { bytesPerPixel: 0.3 });
    const result = await prepareImage(rgba, big.engine);
    assert.equal(big.calls[0].type, "image/png");
    assert.equal(result.file.type, "image/png");
    assert.equal(result.file.name, "logo.png");
  });

  it("PNG ohne Alpha (Farbtyp 2) wird zu JPEG; mit tRNS-Block (Palette mit Transparenz) nicht", async () => {
    const opaque = fileOf("scan.png", "image/png", pngHead(2), 5 * MB);
    const a = fakeEngine({ width: 3200, height: 2400 });
    const result = await prepareImage(opaque, a.engine);
    assert.equal(a.calls[0].type, "image/jpeg");
    assert.equal(result.file.name, "scan.jpg");

    const palette = fileOf("icon.png", "image/png", pngHead(3, bytes([0, 0, 0, 2], "tRNS", [0, 0])), 5 * MB);
    const b = fakeEngine({ width: 3200, height: 2400 });
    await prepareImage(palette, b.engine);
    assert.equal(b.calls[0].type, "image/png");

    assert.equal((await prepareImage(fileOf("g.png", "image/png", pngHead(4), 5 * MB), fakeEngine({ width: 3200, height: 2400 }).engine)).file.type, "image/png", "Graustufen mit Alpha");
  });

  it("WebP: ohne Alpha → JPEG, mit Alpha → PNG, animiert unverändert", async () => {
    const plain = fileOf("a.webp", "image/webp", webpHead("VP8 ", [0, 0, 0, 0]), 5 * MB);
    const a = fakeEngine({ width: 3200, height: 2400 });
    await prepareImage(plain, a.engine);
    assert.equal(a.calls[0].type, "image/jpeg");

    const alpha = fileOf("b.webp", "image/webp", webpHead("VP8X", [0x10, 0, 0, 0]), 5 * MB);
    const b = fakeEngine({ width: 3200, height: 2400 });
    await prepareImage(alpha, b.engine);
    assert.equal(b.calls[0].type, "image/png");

    const losslessAlpha = fileOf("c.webp", "image/webp", webpHead("VP8L", [0x2f, 0, 0, 0, 0x10]), 5 * MB);
    const c = fakeEngine({ width: 3200, height: 2400 });
    await prepareImage(losslessAlpha, c.engine);
    assert.equal(c.calls[0].type, "image/png");

    const animated = fileOf("d.webp", "image/webp", webpHead("VP8X", [0x02 | 0x10, 0, 0, 0]), 5 * MB);
    const d = fakeEngine({ width: 3200, height: 2400 });
    assert.equal((await prepareImage(animated, d.engine)).file, animated);
    assert.equal(d.decoded(), 0);
  });

  it("GIF bleibt unverändert (Animation und Transparenz gingen sonst verloren)", async () => {
    const gif = fileOf("a.gif", "image/gif", bytes("GIF89a", [1, 0, 1, 0]), 3 * MB);
    const { engine, decoded } = fakeEngine({ width: 4000, height: 3000 });
    assert.equal((await prepareImage(gif, engine)).file, gif);
    assert.equal(decoded(), 0);
  });

  it("der Inhalt zählt, nicht der angegebene Typ (Android liefert oft keinen oder einen falschen)", async () => {
    const photo = fileOf("IMG", "", jpegHead(), 5 * MB);
    const { engine, calls } = fakeEngine({ width: 4000, height: 3000 });
    assert.equal((await prepareImage(photo, engine)).status, "resized");
    assert.equal(calls.length, 1);
    const pretend = fileOf("falsch.jpg", "image/jpeg", bytes("%PDF-1.4"), 5 * MB);
    assert.equal((await prepareImage(pretend, fakeEngine({ width: 4000, height: 3000 }).engine)).status, "resized", "nur der Typ sagt Bild: der Browser entscheidet beim Dekodieren");
  });

  it("HEIC, das der Browser nicht dekodieren kann: ImageError „heic“ – egal ob Typ, Endung oder Inhalt es verraten", async () => {
    const heicBytes = bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic");
    for (const file of [fileOf("a.heic", "image/heic", heicBytes, 4 * MB), fileOf("b.jpg", "", heicBytes, 4 * MB), fileOf("IMG_1.HEIC", "", bytes([1, 2, 3, 4]), 4 * MB)]) {
      await assert.rejects(prepareImage(file, fakeEngine("fail").engine), (error) => error instanceof ImageError && error.code === "heic", file.name);
    }
  });

  it("HEIC, das der Browser dekodieren kann (Safari), wird immer zu JPEG, auch wenn es klein ist", async () => {
    const heic = fileOf("a.heic", "image/heic", bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0]), 900 * 1024);
    const { engine, calls } = fakeEngine({ width: 1000, height: 800 }, { bytesPerPixel: 2 });
    const result = await prepareImage(heic, engine, { maxBytes: 2 * MB });
    assert.equal(result.status, "resized");
    assert.equal(calls[0].type, "image/jpeg");
    assert.equal(result.file.name, "a.jpg");
  });

  it("ein anderes Bild, das sich nicht dekodieren lässt, bleibt unverändert (der Server prüft die Datei)", async () => {
    const photo = fileOf("kaputt.jpg", "image/jpeg", jpegHead(), 5 * MB);
    assert.equal((await prepareImage(photo, fakeEngine("fail").engine)).file, photo);
  });

  it("liefert der Browser nicht das gewünschte Format (z. B. PNG statt JPEG), bleibt das Original", async () => {
    const photo = fileOf("a.jpg", "image/jpeg", jpegHead(), 5 * MB);
    const { engine } = fakeEngine({ width: 4000, height: 3000 }, { returnType: "image/png" });
    assert.equal((await prepareImage(photo, engine)).file, photo);
  });

  it("zweimal verarbeiten ändert nichts mehr", async () => {
    const photo = fileOf("a.jpg", "image/jpeg", jpegHead(), 6 * MB);
    const first = await prepareImage(photo, fakeEngine({ width: 4000, height: 3000 }).engine, { maxBytes: 2 * MB });
    // das Ergebnis des Fake-Kodierers hat keinen JPEG-Kopf; für den zweiten Durchlauf ein gleich großes mit Kopf
    const again = fileOf(first.file.name, "image/jpeg", jpegHead(), first.file.size);
    const second = await prepareImage(again, fakeEngine({ width: 1600, height: 1200 }).engine, { maxBytes: 2 * MB });
    assert.equal(second.file, again);
  });
});

describe("sniffImage", () => {
  it("erkennt die Formate an den ersten Bytes", () => {
    assert.equal(sniffImage(jpegHead()), "jpeg");
    assert.equal(sniffImage(pngHead(2)), "png");
    assert.equal(sniffImage(bytes("GIF87a", [0, 0])), "gif");
    assert.equal(sniffImage(webpHead("VP8 ", [0])), "webp");
    assert.equal(sniffImage(bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0])), "heic");
    assert.equal(sniffImage(bytes([0, 0, 0, 24], "ftypmp42", [0, 0, 0, 0])), "other", "MP4 ist kein Foto");
    assert.equal(sniffImage(bytes("%PDF-1.7")), "other");
    assert.equal(sniffImage(new Uint8Array()), "other");
  });
});
