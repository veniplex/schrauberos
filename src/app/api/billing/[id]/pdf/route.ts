import { type NextRequest } from "next/server";
import { errorResponse } from "@/lib/file-delivery";
import { getSession } from "@/server/auth/session";
import { getWorkshopLogo } from "@/server/workshop";
import { PdfError, pdfResponse } from "@/server/pdf";
import { isInvoiceType } from "@/modules/office/billing/constants";
import { buildDocumentPdf, logoForPdf } from "@/modules/office/billing/documents";
import { documentFileName } from "@/modules/office/billing/domain";
import { readOriginal } from "@/modules/office/billing/original-files";
import { loadDocView } from "@/modules/office/billing/queries";

export const dynamic = "force-dynamic";

/**
 * Das PDF eines Beleges der Rechnungserstellung – nur mit Recht `billing.view`; **Sitzung und Recht werden vor der Erzeugung geprüft** (kein Rechenaufwand für Unberechtigte).
 * Festgeschriebene **Rechnungen** (Buchungsbelege) liefert die Route standardmäßig als **Original**: die beim Festschreiben abgelegte, unveränderliche Datei (`InvoiceOriginal`, SHA-256 geprüft), Kopf
 * `X-Document-Version: original`. `?fresh=1` erzeugt dagegen eine **neu erzeugte Ansicht** aus dem Schnappschuss (aktuelles Layout und Logo, `X-Document-Version: regenerated`, Dateiname mit
 * `_neu-erzeugt`) – sie ist nie das Original. Ist das Original beschädigt (Prüfsumme/Datei), antwortet die Route mit 500 statt still eine neue Fassung als Original auszugeben. Angebote,
 * Auftragsbestätigungen und Entwürfe entstehen wie bisher bei jedem Abruf neu. `?download=1` erzwingt den Download. Kopfzeilen: `pdfResponse` (`lib/file-delivery.ts`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return errorResponse(401, "Unauthorized");
  if (!session.can("billing.view")) return errorResponse(403, "Forbidden");

  const { id } = await params;
  const loaded = await loadDocView(id);
  if (!loaded) return errorResponse(404, "Not found");
  const download = request.nextUrl.searchParams.get("download") === "1";
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  const { view } = loaded;
  const name = documentFileName(view.docType, view.number, "pdf");
  const finalizedInvoice = !view.draft && isInvoiceType(view.docType);
  if (finalizedInvoice && !fresh) {
    const original = await readOriginal(id, "pdf");
    if (original === "damaged") return errorResponse(500, "Original damaged");
    if (original) return pdfResponse(original.bytes, { name, download, headers: { "X-Document-Version": "original" } });
  }
  try {
    const bytes = await buildDocumentPdf(view, { logo: logoForPdf(await getWorkshopLogo()) });
    return pdfResponse(bytes, { name: finalizedInvoice ? name.replace(/.pdf$/, "_neu-erzeugt.pdf") : name, download, headers: { "X-Document-Version": "regenerated" } });
  } catch (error) {
    // zu viele Positionen/zu viel Text: ein klarer Fehler statt eines Absturzes
    if (error instanceof PdfError) return errorResponse(422, "Unprocessable");
    throw error;
  }
}
