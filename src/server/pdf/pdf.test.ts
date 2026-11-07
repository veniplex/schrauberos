import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectPdf } from "@/test/pdf-text";
import { cleanPdfText, createPdf, mm, pdfResponse, PdfError } from ".";

/**
 * PDF-Erzeugung: Es wird wirklich ein PDF gebaut und dann **aus den Bytes** gelesen (Seitenzahl, Text über die ToUnicode-Tabellen der eingebetteten Schrift, Schriftnamen) – nicht der
 * Quelltext verglichen. Der Leser steht in `src/test/pdf-text.ts`.
 */
const FIXED = new Date("2026-11-07T10:00:00Z");
const opts = { title: "Rechnung Nr. 2026-0001", creationDate: FIXED };

describe("PDF-Erzeugung", () => {
  it("erzeugt ein gültiges PDF mit einer Seite, durchsuchbarem Text und eingebetteter Schrift", async () => {
    const pdf = createPdf(opts);
    pdf.heading("Rechnung").text("Müller & Söhne – Kfz-Meisterbetrieb");
    const bytes = await pdf.finish();
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(bytes.subarray(-8).toString("latin1"), /%%EOF\s*$/);
    const read = inspectPdf(bytes);
    assert.equal(read.pageCount, 1);
    assert.ok(read.pages[0].includes("Rechnung"));
    assert.ok(read.pages[0].includes("Müller & Söhne – Kfz-Meisterbetrieb"));
    assert.ok(read.fonts.some((f) => /\+NotoSans-Regular$/.test(f)) && read.fonts.some((f) => /\+NotoSans-Bold$/.test(f)), `eingebettet: ${read.fonts}`);
    assert.equal(read.info.Title, "Rechnung Nr. 2026-0001");
    assert.equal(read.info.Producer, "SchrauberOS");
    assert.ok(!/Helvetica/.test(read.structure), "keine nicht eingebettete Standardschrift");
  });

  it("Umlaute, Eszett, Euro, Gedankenstrich und typografische Anführungszeichen kommen richtig an (auch fett)", async () => {
    const text = "Größe: 1.234,56 € – „Ölwechsel“ für Straße, Über-Maß ÄÖÜ äöü ß";
    const pdf = createPdf(opts);
    pdf.text(text).text(text, { bold: true });
    const read = inspectPdf(await pdf.finish());
    assert.equal(read.pages[0].split("\n").filter((l) => l.includes(text)).length, 2);
  });

  it("Fußzeile mit Seitenzahl auf jeder Seite, Kopfzeile ab der zweiten, Text der Fußzeile", async () => {
    const pdf = createPdf({ ...opts, runningHeader: "RE-2026-0001 · Müller Kfz", footer: { text: "Müller Kfz · Hauptstraße 1" } });
    pdf.text("Seite eins");
    pdf.pageBreak().text("Seite zwei");
    pdf.pageBreak().text("Seite drei");
    const read = inspectPdf(await pdf.finish());
    assert.equal(read.pageCount, 3);
    read.pages.forEach((page, i) => {
      assert.ok(page.includes(`Seite ${i + 1} von 3`), `Seite ${i + 1}: Seitenzahl fehlt`);
      assert.ok(page.includes("Müller Kfz · Hauptstraße 1"));
      assert.equal(page.includes("RE-2026-0001 · Müller Kfz"), i > 0, `Seite ${i + 1}: Kopfzeile`);
    });
  });

  it("Seitenzahl-Beschriftung ist austauschbar (Englisch) und die Fußzeile abschaltbar", async () => {
    const english = createPdf({ ...opts, footer: { pageLabel: (p, n) => `Page ${p} of ${n}` } });
    english.text("x");
    assert.ok(inspectPdf(await english.finish()).pages[0].includes("Page 1 of 1"));
    const none = createPdf({ ...opts, footer: false });
    none.text("x");
    assert.ok(!/Seite 1/.test(inspectPdf(await none.finish()).pages[0]));
  });

  it("Tabelle bricht seitenweise um: jede Zeile genau einmal und heil, Kopfzeile wiederholt, Zeilen mit Umbruch", async () => {
    const rows = Array.from({ length: 140 }, (_, i) => [`Pos ${i + 1}`, `Ölwechsel mit Filter und Dichtring für Fahrzeug Nummer ${i + 1} – bitte genau beachten, dass dieser Text länger ist als die Spalte breit`, "2", `${(i + 1) * 3},00 €`]);
    const pdf = createPdf(opts);
    pdf.heading("Positionen");
    pdf.table({ columns: [{ header: "Pos.", weight: 1 }, { header: "Beschreibung", weight: 6 }, { header: "Menge", weight: 1, align: "right" }, { header: "Betrag", weight: 2, align: "right" }], rows });
    pdf.totals([{ label: "Netto", value: "1.000,00 €" }, { label: "USt. 19 %", value: "190,00 €" }, { label: "Gesamt", value: "1.190,00 €", strong: true }]);
    const read = inspectPdf(await pdf.finish());
    assert.ok(read.pageCount >= 3, `Seiten: ${read.pageCount}`);
    const all = read.pages.join("\n");
    for (let i = 1; i <= 140; i++) assert.equal(all.split(new RegExp(`Pos ${i}(?!\\d)`)).length - 1, 1, `Zeile ${i} kommt nicht genau einmal vor`);
    // Kopfzeile der Tabelle auf jeder Seite, auf der Zeilen stehen
    const withRows = read.pages.filter((p) => /Pos \d+/.test(p));
    assert.ok(withRows.every((p) => p.includes("Beschreibung") && p.includes("Betrag")), "Tabellenkopf wiederholt sich");
    // jede Zeile steht vollständig auf einer Seite (Positionsnummer und Betrag zusammen)
    for (const [i, page] of read.pages.entries()) {
      const pos = [...page.matchAll(/Pos (\d+)(?!\d)/g)].map((m) => Number(m[1]));
      for (const n of pos) assert.ok(page.includes(`${n * 3},00 €`), `Seite ${i + 1}: Zeile ${n} ohne Betrag (mitten umgebrochen?)`);
    }
    // Summenblock beisammen auf der letzten Seite
    const last = read.pages.at(-1)!;
    assert.ok(["Netto", "USt. 19 %", "Gesamt", "1.190,00 €"].every((t) => last.includes(t)));
  });

  it("Summenblock bleibt zusammen: passt er nicht mehr unter die Tabelle, steht er ganz auf der nächsten Seite", async () => {
    const pdf = createPdf(opts);
    pdf.text("Anfang");
    pdf.y = pdf.limit - 30; // nur noch eine Zeile Platz
    pdf.totals([{ label: "Netto", value: "10,00 €" }, { label: "USt. 19 %", value: "1,90 €" }, { label: "Gesamt", value: "11,90 €", strong: true }]);
    const read = inspectPdf(await pdf.finish());
    assert.equal(read.pageCount, 2);
    assert.ok(!read.pages[0].includes("Netto"));
    assert.ok(["Netto", "USt. 19 %", "Gesamt", "11,90 €"].every((t) => read.pages[1].includes(t)));
  });

  it("lange Absätze laufen über Seitengrenzen weiter (nichts geht verloren)", async () => {
    const words = Array.from({ length: 1800 }, (_, i) => `wort${i}`).join(" ");
    const pdf = createPdf(opts);
    pdf.text(words, { size: 11 });
    const read = inspectPdf(await pdf.finish());
    assert.ok(read.pageCount >= 2);
    const all = read.pages.join(" ").replace(/\s+/g, " ");
    assert.ok(all.includes("wort0 ") && all.includes("wort1799"));
    for (let i = 0; i < 1800; i += 97) assert.ok(all.includes(`wort${i} `), `wort${i} fehlt`);
  });

  it("Schlüssel-Wert-Zeilen, Linie und Überschriften-Ebenen erscheinen", async () => {
    const pdf = createPdf(opts);
    pdf.heading("Kopf", 1).heading("Abschnitt", 2).heading("Unterabschnitt", 3).keyValues([["Rechnungsdatum", "07.11.2026"], ["Kunde", "Erika Mustermann\nMusterweg 1\n12345 Musterstadt"]]).rule();
    const page = inspectPdf(await pdf.finish()).pages[0];
    for (const t of ["Kopf", "Abschnitt", "Unterabschnitt", "Rechnungsdatum", "07.11.2026", "Musterweg 1", "12345 Musterstadt"]) assert.ok(page.includes(t), t);
  });

  it("QR-Code wird als Vektorgrafik gezeichnet (kein Bild) und belegt den angegebenen Platz im Textfluss", async () => {
    const pdf = createPdf(opts);
    const before = pdf.y;
    pdf.qr("https://werkstatt.example/tires/abc123", { size: mm(30) });
    assert.ok(Math.abs(pdf.y - (before + mm(30) + 4)) < 0.01);
    const read = inspectPdf(await pdf.finish());
    assert.ok((read.contents[0].match(/ re\b/g) ?? []).length > 100, "die Module des QR-Codes sind Rechtecke");
    assert.ok(!/\/Subtype\s*\/Image/.test(read.structure));
  });

  it("feste Seitenanzahl-Grenze: ein außer Kontrolle geratenes Dokument bricht mit einem Fehler ab", () => {
    const pdf = createPdf({ ...opts, maxPages: 3 });
    assert.throws(
      () => {
        for (let i = 0; i < 10; i++) pdf.pageBreak();
      },
      (error: unknown) => error instanceof PdfError && error.code === "tooManyPages",
    );
  });

  it("Größenbegrenzung des Ergebnisses", async () => {
    const pdf = createPdf({ ...opts, maxBytes: 1000 });
    pdf.text("x");
    await assert.rejects(pdf.finish(), (error: unknown) => error instanceof PdfError && error.code === "tooLarge");
  });

  it("Größe: ein kurzes Dokument ist klein (Schrift als Teilmenge eingebettet), 140 Tabellenzeilen bleiben unter 250 KB", async () => {
    const small = createPdf(opts);
    small.text("Hallo");
    assert.ok((await small.finish()).length < 100_000);
    const big = createPdf(opts);
    big.table({ columns: [{ header: "A" }, { header: "B" }], rows: Array.from({ length: 140 }, (_, i) => [`Zeile ${i}`, "Ölwechsel und Filter"]) });
    assert.ok((await big.finish()).length < 250_000);
  });

  it("gleiche Eingabe und feste Erstellzeit ergeben dieselben Bytes", async () => {
    const make = async () => {
      const pdf = createPdf(opts);
      pdf.heading("Test").text("Inhalt äöü €");
      return pdf.finish();
    };
    assert.ok((await make()).equals(await make()));
  });

  it("unbekannte Zeichen (Emoji) und Steuerzeichen bringen die Erzeugung nicht zum Absturz; Steuerzeichen verschwinden", async () => {
    const pdf = createPdf(opts);
    pdf.text("Hallo 😀 Welt\u0000\u0007 ok‮");
    const read = inspectPdf(await pdf.finish());
    assert.equal(read.pageCount, 1);
    assert.ok(read.pages[0].includes("Hallo") && read.pages[0].includes("Welt ok"));
    assert.equal(cleanPdfText("a\u0000b\r\nc‮d"), "ab\ncd");
  });

  it("zweimal abschließen ist ein Fehler", async () => {
    const pdf = createPdf(opts);
    await pdf.finish();
    await assert.rejects(pdf.finish(), (error: unknown) => error instanceof PdfError);
  });

  it("enthält weder JavaScript noch Formulare oder Startaktionen", async () => {
    const pdf = createPdf(opts);
    pdf.text("x");
    const read = inspectPdf(await pdf.finish());
    assert.ok(!/\/JavaScript|\/JS\b|\/OpenAction|\/AcroForm|\/Launch|\/URI/.test(read.structure));
  });
});

describe("Auslieferung", () => {
  it("PDF-Antwort mit den Kopfzeilen jeder Dateiauslieferung: nosniff, nur Einbetten in dieselbe Herkunft, nie im Zwischenspeicher, Länge", async () => {
    const pdf = createPdf(opts);
    pdf.text("x");
    const bytes = await pdf.finish();
    const response = pdfResponse(bytes, { name: "Rechnung RE-2026-0001" });
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.match(response.headers.get("Content-Disposition") ?? "", /^inline; filename="Rechnung RE-2026-0001\.pdf"/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Content-Security-Policy"), "frame-ancestors 'self'");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Length"), String(bytes.length));
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes));
  });

  it("Download erzwingt attachment; Dateinamen mit Umlauten und Steuerzeichen bleiben sicher (kein Einschleusen von Kopfzeilen)", () => {
    const response = pdfResponse(Buffer.from("%PDF-"), { name: 'Angebot "Müller"\r\nSet-Cookie: x=1', download: true });
    const disposition = response.headers.get("Content-Disposition") ?? "";
    assert.match(disposition, /^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''[^\r\n]*$/);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.match(disposition, /\.pdf"/);
  });
});
