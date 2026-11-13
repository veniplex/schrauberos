import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectPdf } from "@/test/pdf-text";
import { makePng } from "@/test/png";
import { createPdf, mm } from ".";

/**
 * Getaggtes PDF (Z6-5 N14): Strukturbaum, MarkInfo, Sprache; Überschriften und Absätze als Strukturelemente, Bild und QR-Code als `Figure` mit Alternativtext, Linien, Flächen sowie Kopf- und Fußzeile als
 * Artefakte. Geprüft **aus den Bytes** (Strukturobjekte und markierte Inhalte der Seiten). Kein Nachweis von PDF/UA – es ist eine grobe, aber vollständige Auszeichnung des Lesewegs.
 */
const FIXED = new Date("2026-11-07T10:00:00Z");
const opts = { title: "Rechnung Nr. 2026-0001", creationDate: FIXED };

const bracketed = (content: string) => ({ open: (content.match(/ BDC\b/g) ?? []).length + (content.match(/ BMC\b/g) ?? []).length, close: (content.match(/\bEMC\b/g) ?? []).length });

describe("Getaggtes PDF", () => {
  it("hat Strukturbaum, MarkInfo (Marked), Sprache und Titel; Strukturelemente für Text und Bilder, Artefakte für Dekoration, Kopf- und Fußzeile", async () => {
    const pdf = createPdf({ ...opts, runningHeader: "Kopf", footer: { text: "Fuß" } });
    pdf.heading("Rechnung", 1).heading("Positionen", 2).text("Ein Absatz.").keyValues([["Nummer", "2026-0001"]]).rule();
    pdf.table({ columns: [{ header: "Text" }, { header: "Preis", align: "right" }], rows: [["Arbeit", "10,00 €"]] }).totals([{ label: "Gesamt", value: "10,00 €", strong: true }]);
    pdf.image(makePng(40, 20), { width: mm(20), height: mm(10), alt: "Logo der Werkstatt" });
    pdf.qr("https://example.org/x", { alt: "QR-Code zum Beleg" });
    pdf.pageBreak().text("Zweite Seite");
    const read = inspectPdf(await pdf.finish());

    assert.match(read.structure, /\/StructTreeRoot/);
    assert.match(read.structure, /\/MarkInfo/);
    assert.match(read.structure, /\/Marked true/);
    assert.match(read.structure, /\/Lang \(de-DE\)/);
    for (const type of ["Document", "H1", "H2", "P", "Figure"]) assert.match(read.structure, new RegExp(`/S /${type}\\b`), type);
    assert.match(read.structure, /\/Alt \(.*Logo der Werkstatt\)/);
    assert.match(read.structure, /\/Alt \(.*QR-Code zum Beleg\)/);

    assert.equal(read.pageCount, 2);
    for (const [index, content] of read.contents.entries()) {
      const { open, close } = bracketed(content);
      assert.ok(open > 0, `Seite ${index + 1} hat markierten Inhalt`);
      assert.equal(open, close, `Seite ${index + 1}: jedes BDC hat sein EMC`);
      assert.match(content, /\/Artifact <<[^>]*\/Type \/Pagination/, `Seite ${index + 1}: Fußzeile als Artefakt`);
    }
    assert.match(read.contents[0], /\/Artifact <<[^>]*\/Type \/Layout/, "Linien und Flächen als Artefakt");
    assert.ok(read.pages[0].includes("Rechnung") && read.pages[0].includes("Seite 1 von 2"), "Text bleibt durchsuchbar");
  });

  it("auch Etiketten und Karten (feste Stellen, ohne Rand) bleiben balanciert und lesbar", async () => {
    const pdf = createPdf({ ...opts, pageSize: { width: mm(62), height: mm(29) }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, footer: false });
    pdf.rectAt({ x: 2, y: 2, width: 100, height: 50 }, { stroke: true });
    pdf.textAt("B-AB 1234", { x: 6, y: 6, width: 100, height: 20 }, { size: 14, bold: true });
    pdf.lineAt(2, 60, 100, 60);
    const read = inspectPdf(await pdf.finish());
    const { open, close } = bracketed(read.contents[0]);
    assert.equal(open, close);
    assert.ok(read.pages[0].includes("B-AB 1234"));
  });
});
