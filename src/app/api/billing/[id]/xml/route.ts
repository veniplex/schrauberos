import { type NextRequest } from "next/server";
import { deliveryHeaders, errorResponse } from "@/lib/file-delivery";
import { EinvoiceError } from "@/lib/einvoice/ubl";
import { getSession } from "@/server/auth/session";
import { buildDocumentXml, xrechnungProblems } from "@/modules/office/billing/xrechnung";
import { documentFileName } from "@/modules/office/billing/domain";
import { loadDocView } from "@/modules/office/billing/queries";

export const dynamic = "force-dynamic";

/**
 * Die XRechnung (UBL-XML) eines festgeschriebenen Beleges – nur mit Recht `billing.view`, immer als Download. Fehlen Pflichtangaben (z. B. die Käuferreferenz), antwortet die Route mit 422 und den Codes
 * der fehlenden Angaben im Kopf `x-problems` (die Detailseite zeigt dieselbe Liste vorab). Die Datei entsteht deterministisch aus dem Schnappschuss; es wird nichts gespeichert.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return errorResponse(401, "Unauthorized");
  if (!session.can("billing.view")) return errorResponse(403, "Forbidden");

  const { id } = await params;
  const loaded = await loadDocView(id);
  if (!loaded) return errorResponse(404, "Not found");
  const problems = xrechnungProblems(loaded.view);
  if (problems.length > 0) return errorResponse(422, "Unprocessable", { "x-problems": problems.join(",") });
  try {
    const bytes = new TextEncoder().encode(buildDocumentXml(loaded.view));
    return new Response(bytes, { headers: deliveryHeaders({ mime: "application/xml", name: documentFileName(loaded.view.docType, loaded.view.number, "xml"), download: true, size: bytes.byteLength }) });
  } catch (error) {
    if (error instanceof EinvoiceError) return errorResponse(422, "Unprocessable", { "x-problems": error.problems.join(",") });
    throw error;
  }
}
