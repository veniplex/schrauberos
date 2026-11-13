import { type NextRequest } from "next/server";
import { errorResponse } from "@/lib/file-delivery";
import { getSession } from "@/server/auth/session";
import { PdfError, pdfResponse } from "@/server/pdf";
import { deliverPdf } from "@/modules/office/billing/deliver";
import { billingReadAllowed, loadDocView } from "@/modules/office/billing/queries";

export const dynamic = "force-dynamic";

/**
 * Das PDF eines Beleges der Rechnungserstellung – nur mit Recht `billing.view`; **Sitzung und Recht werden vor der Erzeugung geprüft** (kein Rechenaufwand für Unberechtigte).
 * Festgeschriebene **Rechnungen** (Buchungsbelege) liefert die Route standardmäßig als **Original**: die beim Festschreiben abgelegte, unveränderliche Datei (`InvoiceOriginal`, SHA-256 geprüft), Kopf
 * `X-Document-Version: original`. `?fresh=1` erzeugt dagegen eine **neu erzeugte Ansicht** aus dem Schnappschuss (aktuelles Layout und Logo, `X-Document-Version: regenerated`, Dateiname mit
 * `_neu-erzeugt`) – sie ist nie das Original. Ist das Original beschädigt (Prüfsumme/Datei), antwortet die Route mit 500 statt still eine neue Fassung als Original auszugeben. Angebote,
 * Auftragsbestätigungen und Entwürfe entstehen wie bisher bei jedem Abruf neu. `?download=1` erzwingt den Download. Die Logik steht in `billing/deliver.ts` (dieselbe wie in der Schnittstelle);
 * Kopfzeilen: `pdfResponse` (`lib/file-delivery.ts`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return errorResponse(401, "Unauthorized");
  if (!session.can("billing.view")) return errorResponse(403, "Forbidden");

  const { id } = await params;
  const loaded = await loadDocView(id);
  if (!loaded || !(await billingReadAllowed(session, loaded.row))) return errorResponse(404, "Not found"); // Art. 18: nur festgeschriebene Rechnungen eingeschränkter Kunden, nur mit invoices.view
  const download = request.nextUrl.searchParams.get("download") === "1";
  try {
    const delivered = await deliverPdf(loaded.view, { fresh: request.nextUrl.searchParams.get("fresh") === "1" });
    if (delivered.kind === "damaged") return errorResponse(500, "Original damaged");
    return pdfResponse(delivered.bytes, { name: delivered.name, download, headers: { "X-Document-Version": delivered.kind } });
  } catch (error) {
    // zu viele Positionen/zu viel Text: ein klarer Fehler statt eines Absturzes
    if (error instanceof PdfError) return errorResponse(422, "Unprocessable");
    throw error;
  }
}
