import { labelGeometry, labelsPerPage, type LabelContent, type LabelFormat } from "@/lib/labels";
import { createPdf, mm, type PdfBuilder } from "./builder";
import { PdfError } from "./errors";

/**
 * Etiketten als PDF (F8): **Einzelformate** (Rolle des Etikettendruckers) bekommen je Etikett genau eine Seite im Maß des Etiketts, der **A4-Bogen** füllt Seite für Seite das Raster
 * (3 × 8) – mit `skip` hinter den schon benutzten Feldern eines angebrochenen Bogens. Diese Datei kennt keine Fachlogik: Die Funktion liefert nur `LabelContent` (Hauptzeile, Zeilen, QR-Inhalt).
 *
 * Aufteilung im Etikett: links der Text (Hauptzeile groß, in den Kasten eingepasst; darunter die Zeilen, ebenfalls eingepasst), rechts der QR-Code (Quadrat mit weißem Rand, damit Handykameras
 * ihn auch auf buntem Etikettenpapier lesen). Nichts läuft über den Etikettenrand: zu langer Text schrumpft bis zur Mindestgröße und wird dann mit „…“ abgeschnitten.
 */

/** Höchstzahl Etiketten in einem Druck (Schutz vor Missbrauch der Route: 24 Bögen). */
export const MAX_LABELS_PER_PDF = 600;

const PAD = mm(2);

function drawLabel(pdf: PdfBuilder, label: LabelContent, cell: { x: number; y: number; width: number; height: number }): void {
  const inner = { x: cell.x + PAD, y: cell.y + PAD, width: cell.width - 2 * PAD, height: cell.height - 2 * PAD };
  const qrSize = label.qr ? Math.min(inner.height, cell.width * 0.4) : 0;
  const textWidth = label.qr ? inner.width - qrSize - PAD : inner.width;
  if (label.qr) pdf.qr(label.qr, { size: qrSize, x: cell.x + cell.width - PAD - qrSize, y: cell.y + (cell.height - qrSize) / 2 });

  const titleMax = Math.min(20, cell.height * 0.26);
  const titleHeight = titleMax * 1.25;
  const titleSize = pdf.fitSize(label.title, { width: textWidth, height: titleHeight }, { max: titleMax, min: 7, bold: true });
  pdf.textAt(label.title, { x: inner.x, y: inner.y, width: textWidth, height: titleHeight }, { size: titleSize, bold: true });

  const bodyTop = inner.y + titleHeight + mm(0.8);
  const body = label.lines.filter((line) => line.trim() !== "").join("\n");
  if (body === "") return;
  const bodyBox = { x: inner.x, y: bodyTop, width: textWidth, height: Math.max(0, inner.y + inner.height - bodyTop) };
  const size = pdf.fitSize(body, bodyBox, { max: Math.min(10, cell.height * 0.14), min: 5, lineGap: 1 });
  pdf.textAt(body, bodyBox, { size, lineGap: 1 });
}

/** Das PDF zu den Etiketten (`labels` in der Reihenfolge, in der sie gedruckt werden). */
export async function buildLabelsPdf(options: { title: string; format: LabelFormat; labels: readonly LabelContent[]; /** nur Bogen: so viele Felder am Anfang auslassen */ skip?: number; creationDate?: Date }): Promise<Buffer> {
  const g = labelGeometry(options.format);
  const perPage = labelsPerPage(options.format);
  const skip = g.kind === "sheet" ? Math.min(Math.max(0, Math.floor(options.skip ?? 0)), perPage - 1) : 0;
  if (options.labels.length === 0 || options.labels.length > MAX_LABELS_PER_PDF) throw new PdfError("invalid", "labels");

  const pdf = createPdf({
    title: options.title,
    creationDate: options.creationDate,
    pageSize: { width: mm(g.pageWidthMm), height: mm(g.pageHeightMm) },
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    footer: false,
  });
  const cellWidth = mm(g.cellWidthMm);
  const cellHeight = mm(g.cellHeightMm);
  options.labels.forEach((label, index) => {
    const slot = skip + index;
    const position = slot % perPage;
    if (position === 0 && slot > 0) pdf.pageBreak();
    const column = position % g.columns;
    const row = Math.floor(position / g.columns);
    drawLabel(pdf, label, { x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight });
  });
  return pdf.finish();
}
