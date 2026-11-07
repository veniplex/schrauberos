import { type CardModel, type CardSize } from "@/lib/print-card";
import { createPdf, mm, type PdfBuilder } from "./builder";

/**
 * Karten und Zettel als PDF (F8): **Auftragskarte** (Werkstattlaufzettel) und **Terminzettel** haben denselben Aufbau – Überschrift, Kopfdaten, Textabschnitte, eine Tabelle, Hinweise anderer
 * Funktionen, Schreiblinien für Notizen und ein QR-Code –, nur der Inhalt gehört der jeweiligen Funktion. Diese Datei kennt keine Fachlogik: Die Funktion baut ein `CardModel` aus fertigen,
 * schon übersetzten Texten; dasselbe Modell zeichnet die Druckansicht (`components/ui/print-card.tsx`), PDF und Bildschirm zeigen also nie Verschiedenes.
 *
 * Papier: A4, A5 oder A6 hochkant (Ränder und Schriftgrößen wachsen mit dem Papier). Der QR-Code sitzt oben rechts, die Kopfdaten laufen links daneben; darunter geht es in voller Breite weiter.
 */

type Layout = { page: { width: number; height: number }; margins: { top: number; right: number; bottom: number; left: number }; qr: number; title: number; text: number; line: number };

const LAYOUT: Record<CardSize, Layout> = {
  a4: { page: { width: mm(210), height: mm(297) }, margins: { top: mm(18), right: mm(20), bottom: mm(22), left: mm(20) }, qr: mm(30), title: 17, text: 9.5, line: mm(9) },
  a5: { page: { width: mm(148), height: mm(210) }, margins: { top: mm(12), right: mm(12), bottom: mm(16), left: mm(12) }, qr: mm(25), title: 14, text: 9, line: mm(8) },
  a6: { page: { width: mm(105), height: mm(148) }, margins: { top: mm(8), right: mm(8), bottom: mm(12), left: mm(8) }, qr: mm(20), title: 12, text: 8, line: mm(7) },
};


function drawNotes(pdf: PdfBuilder, notes: { heading: string; lines: number }, layout: Layout): void {
  const room = pdf.limit - pdf.y - mm(14);
  const fit = Math.floor(room / layout.line);
  // zu wenig Platz für mindestens drei Zeilen: lieber auf eine neue Seite als eine abgeschnittene Notizfläche
  if (fit < Math.min(3, notes.lines)) pdf.pageBreak();
  pdf.heading(notes.heading, 3);
  const available = Math.floor((pdf.limit - pdf.y) / layout.line);
  const count = Math.max(0, Math.min(notes.lines, available));
  for (let i = 0; i < count; i++) {
    pdf.y += layout.line;
    pdf.lineAt(pdf.left, pdf.y, pdf.right, pdf.y);
  }
  pdf.y += mm(2);
}

/** Das PDF zur Karte. */
export async function buildCardPdf(model: CardModel, size: CardSize): Promise<Buffer> {
  const layout = LAYOUT[size];
  const pdf = createPdf({
    title: model.documentTitle,
    creationDate: model.creationDate,
    pageSize: layout.page,
    margins: layout.margins,
    footer: { text: model.footer, pageLabel: model.pageLabel },
  });
  const top = pdf.y;
  const qr = model.qr ?? null;
  const gap = mm(4);
  const headWidth = qr ? pdf.contentWidth - layout.qr - gap : pdf.contentWidth;

  if (qr) {
    pdf.qr(qr.data, { size: layout.qr, x: pdf.right - layout.qr, y: top });
    pdf.textAt(qr.caption, { x: pdf.right - layout.qr - mm(3), y: top + layout.qr - 1, width: layout.qr + mm(3), height: 22 }, { size: 6.5, align: "center", muted: true });
  }
  if (model.subtitle) pdf.text(model.subtitle, { size: layout.text - 1, muted: true, width: headWidth, after: 2 });
  pdf.text(model.title, { size: layout.title, bold: true, width: headWidth, after: 6 });
  if (model.facts.length > 0) pdf.keyValues(model.facts, { size: layout.text, labelWidth: mm(size === "a6" ? 24 : size === "a5" ? 30 : 34), width: headWidth });
  // unter dem QR-Code geht es in voller Breite weiter
  if (qr) pdf.y = Math.max(pdf.y, top + layout.qr + mm(7));
  pdf.space(4);

  for (const block of model.blocks ?? []) {
    pdf.heading(block.heading, 3);
    pdf.text(block.text, { size: layout.text, after: 6 });
  }
  if (model.table) {
    pdf.heading(model.table.heading, 3);
    if (model.table.rows.length === 0) pdf.text(model.table.empty, { size: layout.text, muted: true, after: 6 });
    else pdf.table({ columns: model.table.columns, rows: model.table.rows, fontSize: layout.text });
  }
  if (model.extras && model.extras.length > 0) {
    pdf.space(4);
    pdf.keyValues(model.extras, { size: layout.text, labelWidth: mm(size === "a6" ? 30 : 38) });
  }
  if (model.notes) {
    pdf.space(6);
    drawNotes(pdf, model.notes, layout);
  }
  return pdf.finish();
}
