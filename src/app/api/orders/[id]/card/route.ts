import { type NextRequest } from "next/server";
import { getI18n } from "@/i18n/server";
import { errorResponse } from "@/lib/file-delivery";
import { safeName } from "@/lib/filename";
import { parseCardSize } from "@/lib/print-card";
import { printNotesFor } from "@/modules/registry";
import { orderCardModel } from "@/modules/workshop/orders/card";
import { orderCardData } from "@/modules/workshop/orders/queries";
import { buildCardPdf, pdfResponse } from "@/server/pdf";
import { pdfErrorResponse, pdfRouteSession } from "@/server/pdf/route-guard";
import { getPublicUrl } from "@/server/public-url";
import { getWorkshop } from "@/server/workshop";

export const dynamic = "force-dynamic";

/**
 * Die Auftragskarte (Werkstattlaufzettel, F8) als PDF – nur mit Recht `orders.view`; **Sitzung und Recht werden vor der Erzeugung geprüft**. Aufträge und Fahrzeuge von Kunden mit eingeschränkter
 * Verarbeitung (Art. 18) gibt es nicht (404). **Keine Preise**, auch nicht mit `orders.prices`. Parameter: `size` (`a4` oder `a5`), `download=1`. Der QR-Code enthält den Link zur Auftragsseite (Adresse aus
 * der Einstellung, nie aus dem Header). Kopfzeilen: `pdfResponse` (`lib/file-delivery.ts`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await pdfRouteSession("orders.view");
  if (guard.response) return guard.response;
  const { id } = await params;
  const data = await orderCardData(guard.session, id);
  if (!data) return errorResponse(404, "Not found");

  const size = parseCardSize(request.nextUrl.searchParams.get("size"), ["a4", "a5"], "a4");
  const workshop = await getWorkshop(); // setzt auch die Zeitzone der Werkstatt für die Zeiten auf der Karte
  const i18n = await getI18n();
  const [base, extras] = await Promise.all([getPublicUrl(), printNotesFor(guard.session, "orders/card", data.id, i18n)]);
  try {
    const model = orderCardModel(data, { i18n, workshop, base, extras });
    const bytes = await buildCardPdf(model, size);
    return pdfResponse(bytes, { name: `${safeName(`auftragskarte-${data.number}`, 60)}.pdf`, download: request.nextUrl.searchParams.get("download") === "1" });
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
