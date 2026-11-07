import { type NextRequest } from "next/server";
import { getI18n } from "@/i18n/server";
import { safeName } from "@/lib/filename";
import { MAX_LABEL_COPIES, parseClampedInt, parseLabelFormat, labelsPerPage } from "@/lib/labels";
import { errorResponse } from "@/lib/file-delivery";
import { tireLabelContent } from "@/modules/workshop/tires/label";
import { tireLabelData } from "@/modules/workshop/tires/queries";
import { buildLabelsPdf, pdfResponse } from "@/server/pdf";
import { pdfErrorResponse, pdfRouteSession } from "@/server/pdf/route-guard";
import { getPublicUrl } from "@/server/public-url";

export const dynamic = "force-dynamic";

/**
 * Das Etikett eines Reifensatzes als PDF (F8) – nur mit Recht `tires.view`; **Sitzung und Recht werden vor der Erzeugung geprüft**. Sätze von Fahrzeugen eingeschränkt verarbeiteter Kunden (Art. 18)
 * gibt es nicht (404). Parameter: `format` (`62x29`, `100x50`, `sheet-3x8`), `copies` (Anzahl gleicher Etiketten), `skip` (Bogen: schon benutzte Felder), `download=1`. Der QR-Code enthält den Link zur
 * Seite des Satzes (Adresse aus der Einstellung, nie aus dem Header). Kopfzeilen: `pdfResponse` (`lib/file-delivery.ts`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await pdfRouteSession("tires.view");
  if (guard.response) return guard.response;
  const { id } = await params;
  const data = await tireLabelData(guard.session, id);
  if (!data) return errorResponse(404, "Not found");

  const query = request.nextUrl.searchParams;
  const format = parseLabelFormat(query.get("format"));
  // außerhalb der Grenzen wird geklemmt (nicht still auf 1/0 zurückgesetzt); die Seite zeigt den Hinweis dazu
  const copies = parseClampedInt(query.get("copies") ?? undefined, 1, MAX_LABEL_COPIES, 1).value;
  const skip = parseClampedInt(query.get("skip") ?? undefined, 0, labelsPerPage(format) - 1, 0).value;
  const i18n = await getI18n();
  const content = tireLabelContent(data, i18n, await getPublicUrl());
  try {
    const bytes = await buildLabelsPdf({ title: i18n.t("tires.label.documentTitle", { plate: data.plate }), format, labels: Array.from({ length: copies }, () => content), skip });
    return pdfResponse(bytes, { name: `${safeName(i18n.t("tires.label.fileName", { plate: data.plate }), 60)}.pdf`, download: query.get("download") === "1" });
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
