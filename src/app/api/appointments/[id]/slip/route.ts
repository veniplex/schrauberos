import { type NextRequest } from "next/server";
import { getI18n } from "@/i18n/server";
import { errorResponse } from "@/lib/file-delivery";
import { safeName } from "@/lib/filename";
import { parseCardSize } from "@/lib/print-card";
import { appointmentSlipData } from "@/modules/workshop/appointments/queries";
import { appointmentSlipModel } from "@/modules/workshop/appointments/slip";
import { buildCardPdf, pdfResponse } from "@/server/pdf";
import { pdfErrorResponse, pdfRouteSession } from "@/server/pdf/route-guard";
import { getWorkshop } from "@/server/workshop";

export const dynamic = "force-dynamic";

/**
 * Der Terminzettel (F8) als PDF – nur mit Recht `appointments.view`; **Sitzung und Recht werden vor der Erzeugung geprüft**. Termine, deren Kunde oder Fahrzeughalter eingeschränkt verarbeitet wird
 * (Art. 18), gibt es nicht (404). Das Telefon des Kunden nur mit `customers.view`, die Notizen des Termins nur auf Wunsch (`notes=1`). Parameter: `size` (`a5` oder `a6`), `notes`, `download=1`.
 * Kopfzeilen: `pdfResponse` (`lib/file-delivery.ts`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await pdfRouteSession("appointments.view");
  if (guard.response) return guard.response;
  const { id } = await params;
  const query = request.nextUrl.searchParams;
  const withNotes = query.get("notes") === "1";
  const data = await appointmentSlipData(guard.session, id, { withNotes });
  if (!data) return errorResponse(404, "Not found");

  const size = parseCardSize(query.get("size"), ["a5", "a6"], "a5");
  const workshop = await getWorkshop(); // setzt auch die Zeitzone der Werkstatt für die Zeiten auf dem Zettel
  const i18n = await getI18n();
  try {
    const bytes = await buildCardPdf(appointmentSlipModel(data, { i18n, workshop, withNotes }), size);
    return pdfResponse(bytes, { name: `${safeName(`terminzettel-${data.plate ?? data.title}`, 60)}.pdf`, download: query.get("download") === "1" });
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
