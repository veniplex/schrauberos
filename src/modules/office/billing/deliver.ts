import "server-only";
import { getWorkshopLogo } from "@/server/workshop";
import { isInvoiceType } from "./constants";
import { buildDocumentPdf, logoForPdf } from "./documents";
import { documentFileName } from "./domain";
import { readOriginal } from "./original-files";
import type { DocView } from "./view";
import { buildDocumentXml, xrechnungProblems } from "./xrechnung";

/**
 * **Eine** Auslieferungslogik für PDF und XRechnung eines Beleges der Rechnungserstellung – die Routen der Oberfläche (`/api/billing/<id>/pdf|xml`) und die Schnittstelle (`/api/v1/billing-documents/<id>/pdf|xml`)
 * rufen dieselbe Funktion, damit nie die eine Seite das Original und die andere eine neu erzeugte Fassung unter dem Namen des Originals liefert (Integrationen der Steuerberater-Übergabe, Archiv):
 *
 *  - Festgeschriebene **Rechnungen** (Buchungsbelege): standardmäßig das **Original** (beim Festschreiben abgelegt, SHA-256 geprüft, `X-Document-Version: original`). `fresh` liefert stattdessen eine **neu erzeugte
 *    Ansicht** aus dem Schnappschuss (aktuelles Layout und Logo, `X-Document-Version: regenerated`, Dateiname mit `_neu-erzeugt`) – nie das Original.
 *  - Ist das Original beschädigt (Prüfsumme, Datei fehlt), meldet die Auslieferung `damaged` (die Aufrufer antworten mit einem Fehler, nie still mit einer neuen Fassung). Gibt es keins (Altbeleg, XRechnung nicht möglich),
 *    entsteht die Fassung neu und ist als `regenerated` gekennzeichnet (auch im Dateinamen).
 *  - Angebote, Auftragsbestätigungen und Entwürfe entstehen bei jedem Abruf neu (keine Buchungsbelege): `regenerated`, Dateiname unverändert.
 */
export type Delivered = { kind: "original" | "regenerated"; bytes: Uint8Array; name: string } | { kind: "damaged" };
export type DeliveredXml = Delivered | { kind: "incomplete"; problems: string[] };

const isBooking = (view: DocView): boolean => !view.draft && isInvoiceType(view.docType);
/** Dateiname einer neu erzeugten Fassung eines Buchungsbeleges: kennzeichnet, dass es nicht das Original ist */
const freshName = (name: string): string => name.replace(/(\.[a-z]+)$/, "_neu-erzeugt$1");

/** PDF; kann `PdfError` werfen (zu viele Positionen/zu viel Text). */
export async function deliverPdf(view: DocView, options: { fresh?: boolean } = {}): Promise<Delivered> {
  const name = documentFileName(view.docType, view.number, "pdf");
  const booking = isBooking(view);
  if (booking && !options.fresh) {
    const original = await readOriginal(view.id, "pdf");
    if (original === "damaged") return { kind: "damaged" };
    if (original) return { kind: "original", bytes: original.bytes, name };
  }
  const bytes = await buildDocumentPdf(view, { logo: logoForPdf(await getWorkshopLogo()) });
  return { kind: "regenerated", bytes, name: booking ? freshName(name) : name };
}

/** XRechnung; kann `EinvoiceError` (`lib/einvoice/ubl`) werfen. Fehlen Pflichtangaben und gibt es kein Original, meldet sie `incomplete`. */
export async function deliverXml(view: DocView, options: { fresh?: boolean } = {}): Promise<DeliveredXml> {
  const name = documentFileName(view.docType, view.number, "xml");
  const booking = isBooking(view);
  if (booking && !options.fresh) {
    const original = await readOriginal(view.id, "xml");
    if (original === "damaged") return { kind: "damaged" };
    if (original) return { kind: "original", bytes: original.bytes, name };
  }
  const problems = xrechnungProblems(view);
  if (problems.length > 0) return { kind: "incomplete", problems };
  return { kind: "regenerated", bytes: new TextEncoder().encode(buildDocumentXml(view)), name: booking ? freshName(name) : name };
}
