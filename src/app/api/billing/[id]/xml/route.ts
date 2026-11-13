import { type NextRequest } from "next/server";
import { deliveryHeaders, errorResponse } from "@/lib/file-delivery";
import { EinvoiceError } from "@/lib/einvoice/ubl";
import { getSession } from "@/server/auth/session";
import { deliverXml } from "@/modules/office/billing/deliver";
import { billingReadAllowed, loadDocView } from "@/modules/office/billing/queries";

export const dynamic = "force-dynamic";

/**
 * Die XRechnung (UBL-XML) eines festgeschriebenen Beleges – nur mit Recht `billing.view`, immer als Download. Wie das PDF: Festgeschriebene Rechnungen liefern das beim Festschreiben abgelegte **Original**
 * (SHA-256 geprüft, `X-Document-Version: original`; beschädigt → 500). Gibt es keins (Altbeleg) oder verlangt `?fresh=1` die neu erzeugte Ansicht, entsteht die Datei aus dem Schnappschuss (`X-Document-Version:
 * regenerated`, Dateiname mit `_neu-erzeugt`). Fehlen Pflichtangaben (z. B. die Käuferreferenz), antwortet die Route mit 422 und den Codes der fehlenden Angaben im Kopf `x-problems` (die Detailseite zeigt dieselbe Liste
 * vorab). Die Logik steht in `billing/deliver.ts` (dieselbe wie in der Schnittstelle).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return errorResponse(401, "Unauthorized");
  if (!session.can("billing.view")) return errorResponse(403, "Forbidden");

  const { id } = await params;
  const loaded = await loadDocView(id);
  if (!loaded || !(await billingReadAllowed(session, loaded.row))) return errorResponse(404, "Not found"); // Art. 18: nur festgeschriebene Rechnungen eingeschränkter Kunden, nur mit invoices.view
  try {
    const delivered = await deliverXml(loaded.view, { fresh: request.nextUrl.searchParams.get("fresh") === "1" });
    if (delivered.kind === "damaged") return errorResponse(500, "Original damaged");
    if (delivered.kind === "incomplete") return errorResponse(422, "Unprocessable", { "x-problems": delivered.problems.join(",") });
    return new Response(new Uint8Array(delivered.bytes), { headers: { ...deliveryHeaders({ mime: "application/xml", name: delivered.name, download: true, size: delivered.bytes.byteLength }), "X-Document-Version": delivered.kind } });
  } catch (error) {
    if (error instanceof EinvoiceError) return errorResponse(422, "Unprocessable", { "x-problems": error.problems.join(",") });
    throw error;
  }
}
