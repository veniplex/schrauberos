import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSignaturePad, dataUrlBytes, MAX_POINTS, parseSignatureValue, PNG_DATA_URL, serializeSignature, type Point, type SignatureSurface } from "./signature";
import { makePng, pngChunk, PNG_SIGNATURE } from "@/test/png";

/** Attrappe einer Zeichenfläche: merkt sich die Zeichenbefehle; die „PNG-Größe“ wächst mit Fläche und Zahl der Befehle (wie ein echtes PNG). */
function fakeSurface(width: number, height: number, bytesPerPixel = 0.05): SignatureSurface & { ops: string[] } {
  const ops: string[] = [];
  return {
    width,
    height,
    ops,
    clear: () => void (ops.length = 0),
    line: (a, b, w) => void ops.push(`line ${a.x},${a.y}-${b.x},${b.y} w${w}`),
    dot: (p, w) => void ops.push(`dot ${p.x},${p.y} w${w}`),
    toPng: () => {
      const size = Math.round(width * height * bytesPerPixel) + ops.length * 4;
      return PNG_DATA_URL + Buffer.alloc(size, 65).toString("base64");
    },
  };
}

function pad(options: { maxBytes?: number; bytesPerPixel?: number } = {}) {
  const surface = fakeSurface(600, 200);
  const exports: Array<ReturnType<typeof fakeSurface>> = [];
  const controller = createSignaturePad({
    surface,
    factory: (w, h) => {
      const s = fakeSurface(w, h, options.bytesPerPixel);
      exports.push(s);
      return s;
    },
    maxBytes: options.maxBytes,
  });
  return { controller, surface, exports };
}

const stroke = (controller: ReturnType<typeof pad>["controller"], points: Point[]) => {
  controller.down(points[0]);
  for (const p of points.slice(1)) controller.move(p);
  controller.up();
};
const wave = (n = 40): Point[] => Array.from({ length: n }, (_, i) => ({ x: 20 + i * 8, y: 100 + Math.sin(i / 3) * 40 }));

describe("Unterschrift: Striche", () => {
  it("zeichnet beim Aufsetzen einen Punkt und beim Bewegen Linien zwischen den Punkten", () => {
    const { controller, surface } = pad();
    stroke(controller, [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 40, y: 20 }]);
    assert.equal(surface.ops.length, 3);
    assert.match(surface.ops[0], /^dot 10,10/);
    assert.match(surface.ops[1], /^line 10,10-20,20/);
    assert.equal(controller.strokeCount(), 1);
  });

  it("Bewegung ohne Aufsetzen zeichnet nichts; nach dem Abheben auch nicht", () => {
    const { controller, surface } = pad();
    controller.move({ x: 5, y: 5 });
    assert.equal(surface.ops.length, 0);
    stroke(controller, [{ x: 1, y: 1 }, { x: 30, y: 30 }]);
    const before = surface.ops.length;
    controller.move({ x: 90, y: 90 });
    assert.equal(surface.ops.length, before);
  });

  it("winzige Bewegungen (Zittern) werden übergangen", () => {
    const { controller, surface } = pad();
    controller.down({ x: 10, y: 10 });
    controller.move({ x: 10.2, y: 10.1 });
    controller.move({ x: 10.3, y: 10 });
    controller.up();
    assert.equal(surface.ops.length, 1);
  });

  it("ein versehentliches Antippen ist keine Unterschrift; ein ausreichend langer Strich schon", () => {
    const { controller } = pad();
    stroke(controller, [{ x: 50, y: 50 }]);
    assert.equal(controller.isEmpty(), true);
    assert.deepEqual(controller.exportPng(), { ok: false, reason: "empty" });
    stroke(controller, wave());
    assert.equal(controller.isEmpty(), false);
  });

  it("Löschen leert Fläche und Striche; Rückgängig entfernt nur den letzten Strich und zeichnet neu", () => {
    const { controller, surface } = pad();
    stroke(controller, wave(10));
    stroke(controller, wave(20));
    assert.equal(controller.strokeCount(), 2);
    controller.undo();
    assert.equal(controller.strokeCount(), 1);
    assert.equal(surface.ops.length, 10, "die Fläche wurde neu gezeichnet: Punkt + 9 Linien des ersten Strichs");
    controller.clear();
    assert.equal(controller.strokeCount(), 0);
    assert.equal(surface.ops.length, 0);
    assert.equal(controller.isEmpty(), true);
    controller.undo(); // auf leerer Fläche ohne Wirkung und ohne Fehler
  });

  it("die Zahl der Punkte ist begrenzt (Schutz vor endlosen Eingaben)", () => {
    const { controller } = pad();
    controller.down({ x: 0, y: 0 });
    for (let i = 1; i < MAX_POINTS + 500; i++) controller.move({ x: i % 590, y: (i * 7) % 190 });
    controller.up();
    const exported = controller.exportPng();
    assert.ok(exported.ok || exported.reason === "tooLarge");
  });
});

describe("Unterschrift: PNG mit Größengrenze", () => {
  it("liefert ein PNG als Data-URL unter der Grenze, in voller Größe, wenn es passt", () => {
    const { controller } = pad({ maxBytes: 48 * 1024 });
    stroke(controller, wave());
    const result = controller.exportPng();
    assert.ok(result.ok);
    assert.ok(result.dataUrl.startsWith(PNG_DATA_URL));
    assert.equal(result.scale, 1);
    assert.ok(result.bytes <= 48 * 1024);
    assert.equal(result.bytes, dataUrlBytes(result.dataUrl));
  });

  it("ist das PNG zu groß, wird in kleinerem Maßstab neu gezeichnet, bis es passt", () => {
    // 600 × 200 × 0,05 = 6000 Bytes bei Maßstab 1; Grenze 4000 → passt erst bei 0,75 (3375 + Befehle)
    const { controller, exports } = pad({ maxBytes: 4000 });
    stroke(controller, wave(10));
    const result = controller.exportPng();
    assert.ok(result.ok);
    assert.equal(result.scale, 0.75);
    assert.equal(exports.length, 2, "zwei Versuche");
    assert.deepEqual([exports[1].width, exports[1].height], [450, 150]);
    assert.ok(exports[1].ops.every((op) => !/w2\.6$/.test(op)), "die Strichstärke skaliert mit");
  });

  it("passt es auch im kleinsten Maßstab nicht, ist das Ergebnis „zu groß“ – nie ein zu großes PNG", () => {
    const { controller } = pad({ maxBytes: 100 });
    stroke(controller, wave());
    assert.deepEqual(controller.exportPng(), { ok: false, reason: "tooLarge" });
  });

  it("eine Fläche, die kein PNG liefert, ist ein Fehler, kein Absturz", () => {
    const surface = fakeSurface(600, 200);
    const controller = createSignaturePad({ surface, factory: () => ({ ...fakeSurface(10, 10), toPng: () => "data:text/html;base64,AAAA" }) });
    stroke(controller, wave());
    assert.deepEqual(controller.exportPng(), { ok: false, reason: "tooLarge" });
  });
});

describe("Unterschrift: Wert im Formular (Server liest Fremdeingabe)", () => {
  const png = (extra = 0) => makePng(8, 4, { extra });

  it("serializeSignature ↔ parseSignatureValue", () => {
    const dataUrl = PNG_DATA_URL + png().toString("base64");
    assert.equal(serializeSignature({ kind: "drawn", dataUrl }), dataUrl);
    assert.equal(serializeSignature({ kind: "typed", name: "Erika Mustermann" }), "typed:Erika Mustermann");
    assert.equal(serializeSignature(null), "");
    const drawn = parseSignatureValue(dataUrl);
    assert.ok(drawn?.kind === "drawn" && drawn.png.equals(png()));
    assert.deepEqual(parseSignatureValue("typed:  Erika   Mustermann "), { kind: "typed", name: "Erika Mustermann" });
  });

  it("lehnt ab, was kein PNG ist (falsche Magic Bytes, anderer Typ, kaputtes Base64, zu groß)", () => {
    assert.equal(parseSignatureValue(PNG_DATA_URL + Buffer.from("<html>").toString("base64")), null);
    assert.equal(parseSignatureValue("data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64")), null);
    assert.equal(parseSignatureValue(PNG_DATA_URL + "***"), null);
    assert.equal(parseSignatureValue(PNG_DATA_URL), null);
    assert.equal(parseSignatureValue(PNG_DATA_URL + png(60_000).toString("base64")), null);
    assert.ok(parseSignatureValue(PNG_DATA_URL + png(60_000).toString("base64"), { maxBytes: 100_000 }));
    assert.equal(parseSignatureValue(""), null);
    assert.equal(parseSignatureValue("irgendwas"), null);
  });

  it("Magic Bytes allein oder mit Müll dahinter sind kein PNG (Struktur, CRC, Maße, keine Anhängsel)", () => {
    const url = (bytes: Buffer) => PNG_DATA_URL + bytes.toString("base64");
    assert.equal(parseSignatureValue(url(PNG_SIGNATURE)), null);
    assert.equal(parseSignatureValue(url(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(40, 1)]))), null);
    assert.equal(parseSignatureValue(url(Buffer.concat([PNG_SIGNATURE, Buffer.from("<script>alert(1)</script>GIF89a")]))), null);
    assert.equal(parseSignatureValue(url(Buffer.concat([png(), Buffer.from("GIF89a<script>")]))), null, "Anhängsel hinter IEND");
    assert.equal(parseSignatureValue(url(makePng(8, 4, { ihdr: { width: 30_000, height: 30_000 } }))), null, "riesige deklarierte Fläche");
    assert.equal(parseSignatureValue(url(makePng(2401, 10))), null, "breiter als das Vierfache der Zeichenfläche");
    assert.ok(parseSignatureValue(url(makePng(2400, 800))), "Vierfache Zeichenfläche geht");
    const broken = Buffer.from(png());
    broken[broken.length - 20] ^= 0xff; // CRC des IDAT-Teils
    assert.equal(parseSignatureValue(url(broken)), null);
    assert.ok(pngChunk("IEND").length === 12);
  });

  it("getippter Name: Steuerzeichen und Umkehrzeichen raus, leer oder zu lang abgelehnt", () => {
    assert.deepEqual(parseSignatureValue("typed:Max\u0000 ‮Muster\n"), { kind: "typed", name: "Max Muster" });
    assert.equal(parseSignatureValue("typed:   "), null);
    assert.equal(parseSignatureValue("typed:" + "a".repeat(81)), null);
    assert.ok(parseSignatureValue("typed:" + "a".repeat(80)));
  });
});
