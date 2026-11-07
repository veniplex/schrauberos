import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelGeometry, labelsPerPage, parseBoundedInt, parseLabelFormat, type LabelContent } from "@/lib/labels";
import { inspectPdf } from "@/test/pdf-text";
import { buildLabelsPdf, mm, PdfError } from ".";

/**
 * Etiketten als PDF (F8): Seitengröße = Etikett, ein Etikett je Seite, Bogen mit Raster und übersprungenen Feldern, Text bleibt im Etikett, QR-Code als Vektorgrafik. Gelesen wird das fertige PDF
 * (`src/test/pdf-text.ts`), nicht der Quelltext.
 */
const FIXED = new Date("2026-11-07T10:00:00Z");
const label = (n: number, extra: Partial<LabelContent> = {}): LabelContent => ({ title: `B-AB ${1000 + n}`, lines: ["Lagerplatz: Halle A / Regal 3", "205/55 R16 91V · Winter", "Müller Kfz"], qr: "https://werkstatt.example/tires/abc123", ...extra });
const mediaBox = (structure: string): number[] => {
  const m = /\/MediaBox\s*\[\s*([\d.\s-]+)\]/.exec(structure);
  assert.ok(m, "MediaBox fehlt");
  return m[1].trim().split(/\s+/).map(Number);
};

describe("Etikettenformate (lib/labels)", () => {
  it("Maße, Etiketten je Bogen und Eingabeprüfung", () => {
    assert.equal(labelGeometry("62x29").kind, "single");
    assert.equal(labelsPerPage("62x29"), 1);
    assert.equal(labelsPerPage("sheet-3x8"), 24);
    assert.equal(labelGeometry("sheet-3x8").cellWidthMm * 3, 210);
    assert.ok(Math.abs(labelGeometry("sheet-3x8").cellHeightMm * 8 - 297) < 1e-9);
    assert.equal(parseLabelFormat("100x50"), "100x50");
    assert.equal(parseLabelFormat("a4"), "62x29", "unbekannt: Standard, kein Fehler");
    assert.equal(parseLabelFormat(undefined), "62x29");
    assert.equal(parseBoundedInt("3", 1, 24, 1), 3);
    for (const bad of ["0", "25", "-1", "3.5", "abc", "", "99999", undefined]) assert.equal(parseBoundedInt(bad, 1, 24, 7), 7, String(bad));
  });
});

describe("Etiketten-PDF", () => {
  it("Einzelformat: je Etikett eine Seite genau im Maß des Etiketts, mit Text und QR-Code", async () => {
    const bytes = await buildLabelsPdf({ title: "Etikett", format: "62x29", labels: [label(1), label(2), label(3)], creationDate: FIXED });
    const read = inspectPdf(bytes);
    assert.equal(read.pageCount, 3);
    const box = mediaBox(read.structure);
    assert.ok(Math.abs(box[2] - mm(62)) < 0.05 && Math.abs(box[3] - mm(29)) < 0.05, `Seitengröße ${box}`);
    read.pages.forEach((page, i) => {
      assert.ok(page.includes(`B-AB ${1001 + i}`), `Seite ${i + 1}: Kennzeichen`);
      // kleine Etiketten brechen lange Zeilen um: Zeilenumbrüche zählen nicht
      assert.ok(page.replace(/\s+/g, " ").includes("Lagerplatz: Halle A / Regal 3"));
      assert.ok(page.includes("Müller Kfz"));
      assert.ok(!/Seite \d+ von/.test(page), "keine Fußzeile auf dem Etikett");
    });
    // der QR-Code ist als Vektorgrafik gezeichnet: viele kleine gefüllte Rechtecke
    assert.ok((read.contents[0].match(/ re\b/g) ?? []).length > 100);
  });

  it("ohne QR-Code kommen nur Text-Rechtecke vor – das Etikett ist sonst vollständig", async () => {
    const read = inspectPdf(await buildLabelsPdf({ title: "Etikett", format: "100x50", labels: [label(1, { qr: null })], creationDate: FIXED }));
    assert.equal(read.pageCount, 1);
    assert.ok((read.contents[0].match(/ re\b/g) ?? []).length < 5);
    assert.ok(read.pages[0].includes("B-AB 1001"));
    const box = mediaBox(read.structure);
    assert.ok(Math.abs(box[2] - mm(100)) < 0.05 && Math.abs(box[3] - mm(50)) < 0.05);
  });

  it("A4-Bogen: 24 Etiketten je Seite, übersprungene Felder bleiben leer, danach geht es auf der nächsten Seite weiter", async () => {
    const labels = Array.from({ length: 30 }, (_, i) => label(i));
    const read = inspectPdf(await buildLabelsPdf({ title: "Bogen", format: "sheet-3x8", labels, skip: 4, creationDate: FIXED }));
    assert.equal(read.pageCount, 2, "4 + 30 = 34 Felder → 2 Bögen");
    const plates = (page: string) => page.split("\n").filter((l) => /^B-AB \d{4}$/.test(l)).length;
    assert.equal(plates(read.pages[0]), 20, "24 Felder minus 4 übersprungene");
    assert.equal(plates(read.pages[1]), 10);
    const box = mediaBox(read.structure);
    assert.ok(Math.abs(box[2] - mm(210)) < 0.05 && Math.abs(box[3] - mm(297)) < 0.05);
  });

  it("ohne Überspringen beginnt der Bogen in der ersten Zelle; skip über der Seite wird begrenzt, bei Einzelformaten ignoriert", async () => {
    const one = inspectPdf(await buildLabelsPdf({ title: "B", format: "sheet-3x8", labels: [label(1)], skip: 999, creationDate: FIXED }));
    assert.equal(one.pageCount, 1, "skip wird auf die letzte Zelle begrenzt");
    const single = inspectPdf(await buildLabelsPdf({ title: "B", format: "62x29", labels: [label(1), label(2)], skip: 5, creationDate: FIXED }));
    assert.equal(single.pageCount, 2, "Einzelformat ignoriert skip");
  });

  it("zu langer Text schrumpft und wird abgeschnitten – nie eine zweite Seite, nie über den Rand", async () => {
    const long = label(1, { title: "ABCDEFGHIJKLMNOPQRSTUVWXYZ ".repeat(8), lines: Array.from({ length: 30 }, (_, i) => `Zeile ${i} mit sehr langem Text zum Prüfen der Abschneidung`) });
    const read = inspectPdf(await buildLabelsPdf({ title: "Lang", format: "62x29", labels: [long], creationDate: FIXED }));
    assert.equal(read.pageCount, 1);
  });

  it("Umlaute und Euro-Zeichen kommen an; Steuerzeichen und Umkehrzeichen werden entfernt", async () => {
    const read = inspectPdf(await buildLabelsPdf({ title: "Ö", format: "100x50", labels: [label(1, { lines: ["Größe: 205/55 R16 – Ölwechsel", "bad\u202Etext\u0000"] , qr: null })], creationDate: FIXED }));
    assert.ok(read.pages[0].includes("Größe: 205/55 R16 – Ölwechsel"));
    assert.ok(!read.pages[0].includes("\u202E"));
  });

  it("Grenzen: keine Etiketten oder zu viele ergeben einen PdfError; ein zu langer QR-Inhalt ebenfalls", async () => {
    await assert.rejects(() => buildLabelsPdf({ title: "x", format: "62x29", labels: [] }), PdfError);
    await assert.rejects(() => buildLabelsPdf({ title: "x", format: "62x29", labels: [label(1, { qr: "x".repeat(3000) })] }), PdfError);
  });

  it("Seitengröße außerhalb der Grenzen wird abgelehnt (createPdf)", async () => {
    const { createPdf } = await import(".");
    assert.throws(() => createPdf({ title: "x", pageSize: { width: 5, height: 100 } }), PdfError);
    assert.throws(() => createPdf({ title: "x", pageSize: { width: Number.NaN, height: 100 } }), PdfError);
    assert.throws(() => createPdf({ title: "x", pageSize: { width: 100, height: 99999 } }), PdfError);
  });
});
