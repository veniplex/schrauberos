import "server-only";
import { isInvoiceType } from "./constants";
import { buildDocumentPdf, logoForPdf } from "./documents";
import { documentFileName } from "./domain";
import { viewInclude } from "./queries";
import { viewOf, type ViewRow } from "./view";
import { buildDocumentXml, xrechnungProblems } from "./xrechnung";
import { loadWorkshop } from "./core";
import { removeFile, storeFile } from "@/server/files";
import { ORIGINALS_DIR, sha256 } from "./original-files";
import { fail, OperationError } from "@/server/operations/errors";
import type { Tx } from "@/server/operations/operation";
import { EinvoiceError } from "@/lib/einvoice/ubl";
import { PdfError } from "@/server/pdf/errors";

/**
 * **Originale festgeschriebener Rechnungen** (H2, `InvoiceOriginal`): Beim Festschreiben (`billing.finalize`) und beim Storno (Gegenbeleg, Hook auf `invoices.cancel`) entstehen PDF und – wenn die Pflichtangaben
 * der XRechnung vollständig sind – das XML **in derselben Transaktion** wie die Festschreibung und werden als Dateien unter `rechnungen/original/<Jahr>/` abgelegt (`storeFile`: nie überschrieben, nie verändert,
 * lesbare ASCII-Namen); die Datenbank hält nur den relativen Pfad, Größe und SHA-256.
 *
 * **Warum in der Transaktion?** Das Original muss garantiert vorhanden sein: scheitert die Erzeugung (zu viele Positionen, Platte voll, Schreibfehler), scheitert das Festschreiben mit klarer Meldung und die Nummer geht
 * mit dem Zähler zurück – nichts wird still festgeschrieben, ohne dass das Original existiert. Ein nachträglicher Lauf könnte nur eine **neu erzeugte** Fassung liefern (Logo, Layout und Standardtexte ändern sich), keine
 * echte Originalfassung. Rollt die Transaktion nach dem Ablegen zurück (selten: Fehler in einem späteren Hook oder im Audit), **entfernt `onRollback` die Dateien sofort** (sie tragen Name und Anschrift eines nie ausgestellten
 * Beleges); scheitert auch das (Absturz), löst der Aufräumlauf `billing.originals` verwaiste Dateien (älter als eine Stunde) vom Datenträger.
 *
 * Das **Original** ist genau das, was beim Festschreiben erzeugt wurde; die Seite zeigt zusätzlich eine „neu erzeugte Ansicht“ (aktuelles Layout, `?fresh=1`) und kennzeichnet beide. Nur für Buchungsbelege der
 * Rechnungserstellung (nicht Angebote und Auftragsbestätigungen: sie sind keine Buchungsbelege).
 */

/**
 * Der Aufruf der Operationen: wie `storeOriginals`, aber mit den Fachfehlern der Operation (zu viele Positionen/zu viel Text: `billing.errors.pdf`; Pflichtangaben der XRechnung: `xrechnungIncomplete`).
 * Ein Fehler hier rollt das Festschreiben zurück – der Beleg wird nie ohne Original festgeschrieben. (Die Fehlertypen kommen aus `operations/errors`: ein Hook darf `@/server/operations` nicht laden.)
 */
export async function createOriginals(tx: Tx, invoiceId: string, onRollback?: (task: () => unknown) => void): Promise<void> {
  try {
    await storeOriginals(tx, invoiceId, onRollback);
  } catch (error) {
    if (error instanceof EinvoiceError) throw new OperationError({ code: "invalid", key: "billing.errors.xrechnungIncomplete", data: { problems: error.problems.join(",") } });
    if (error instanceof PdfError) fail("invalid", "billing.errors.pdf");
    throw error;
  }
}

/** Legt PDF (und XML, soweit möglich) des festgeschriebenen Beleges ab und trägt die Zeilen ein. Aufruf nur innerhalb der Transaktion, die den Beleg festschreibt. */
export async function storeOriginals(tx: Tx, invoiceId: string, onRollback?: (task: () => unknown) => void): Promise<{ pdf: string; xml: string | null }> {
  const row = await tx.invoice.findFirst({ where: { id: invoiceId, source: "billing", finalizedAt: { not: null } }, include: viewInclude });
  if (!row || !isInvoiceType(row.docType)) throw new Error("Kein festgeschriebener Buchungsbeleg");
  const workshop = await loadWorkshop(tx);
  const view = viewOf(row as ViewRow, workshop);
  if (view.draft) throw new Error("Kein festgeschriebener Buchungsbeleg");
  const year = view.issueDay.slice(0, 4);
  const dir = `${ORIGINALS_DIR}/${year}`;

  const pdf = await buildDocumentPdf(view, { logo: logoForPdf(workshop.logoDataUrl) });
  const pdfPath = await storeFile(dir, documentFileName(view.docType, view.number, "pdf"), pdf);
  onRollback?.(() => removeFile(pdfPath)); // zurückgerollt (Fehler später in der Transaktion): die Datei eines nie ausgestellten Beleges sofort wieder entfernen, nicht als Waise bis zum Aufräumlauf
  await tx.invoiceOriginal.create({ data: { invoiceId, kind: "pdf", path: pdfPath, size: pdf.byteLength, sha256: sha256(pdf) } });

  // Die XRechnung nur, wenn ihre Pflichtangaben vollständig sind (sonst gibt es sie auch später nie: der Beleg ist unveränderlich)
  let xmlPath: string | null = null;
  if (xrechnungProblems(view).length === 0) {
    const xml = new TextEncoder().encode(buildDocumentXml(view));
    xmlPath = await storeFile(dir, documentFileName(view.docType, view.number, "xml"), xml);
    const stored = xmlPath;
    onRollback?.(() => removeFile(stored));
    await tx.invoiceOriginal.create({ data: { invoiceId, kind: "xml", path: xmlPath, size: xml.byteLength, sha256: sha256(xml) } });
  }
  return { pdf: pdfPath, xml: xmlPath };
}
