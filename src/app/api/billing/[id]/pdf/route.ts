import { type NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";
import { PdfError, pdfResponse } from "@/server/pdf";
import { buildDocumentPdf, logoForPdf } from "@/modules/office/billing/documents";
import { documentFileName } from "@/modules/office/billing/domain";
import { loadDocView } from "@/modules/office/billing/queries";

export const dynamic = "force-dynamic";

/**
 * Das PDF eines Beleges der Rechnungserstellung – nur mit Recht `billing.view`; **Sitzung und Recht werden vor der Erzeugung geprüft** (kein Rechenaufwand für Unberechtigte). Festgeschriebene Belege
 * entstehen deterministisch aus dem Schnappschuss, Entwürfe tragen den Entwurfs-Hinweis. `?download=1` erzwingt den Download. Kopfzeilen: `pdfResponse` (`lib/file-delivery.ts`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return new Response("Unauthorized", { status: 401 });
  if (!session.can("billing.view")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const loaded = await loadDocView(id);
  if (!loaded) return new Response("Not found", { status: 404 });
  try {
    const workshop = await getWorkshop();
    const bytes = await buildDocumentPdf(loaded.view, { logo: logoForPdf(workshop.logoDataUrl) });
    return pdfResponse(bytes, { name: documentFileName(loaded.view.docType, loaded.view.number, "pdf"), download: request.nextUrl.searchParams.get("download") === "1" });
  } catch (error) {
    // zu viele Positionen/zu viel Text: ein klarer Fehler statt eines Absturzes
    if (error instanceof PdfError) return new Response("Unprocessable", { status: 422 });
    throw error;
  }
}
