import { NextResponse, type NextRequest } from "next/server";
import { readEInvoice } from "@/lib/einvoice/extract";
import { centsToInput } from "@/lib/money";
import { checkUpload } from "@/lib/upload-sniff";
import { INVOICE_FILE_MAX_BYTES } from "@/modules/office/invoices/domain";
import { isBehindProxy } from "@/server/auth/network";
import { getSession } from "@/server/auth/session";
import { isSameOriginUpload } from "@/server/request-guard";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

/**
 * Liest eine E-Rechnung (XRechnung/ZUGFeRD als XML) und liefert die Angaben **als Vorschlag** für das Formular „Eingangsrechnung“ – es wird nichts gespeichert. Die Datei selbst
 * kommt erst mit dem Formular als Beleg und bleibt dabei unverändert. Recht `invoices.edit` (wie das Formular), gleiche Herkunft wie bei den Upload-Routen. Gelesen wird mit dem
 * entitätsfreien Leser `src/lib/einvoice` (keine DTD, keine Entitäten, Obergrenzen); der Inhalt muss eine E-Rechnung sein (`checkUpload`, Positivliste der Wurzeln).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!session.can("invoices.edit")) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  if (!isSameOriginUpload(request, await isBehindProxy())) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });

  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > INVOICE_FILE_MAX_BYTES + 1024 * 1024) return NextResponse.json({ error: "tooLarge" }, { status: 413, headers });
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 400, headers });
  }
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "failed" }, { status: 400, headers });
  if (file.size > INVOICE_FILE_MAX_BYTES) return NextResponse.json({ error: "tooLarge" }, { status: 413, headers });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkUpload(bytes, file.type, ["application/xml"]).ok) return NextResponse.json({ error: "notXml" }, { status: 422, headers });
  const result = readEInvoice(bytes);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422, headers });

  const p = result.proposal;
  return NextResponse.json(
    {
      proposal: {
        syntax: p.syntax,
        creditNote: p.creditNote,
        number: p.number ?? "",
        issueDate: p.issueDate ?? "",
        dueDate: p.dueDate ?? "",
        partyName: p.seller ?? "",
        buyer: p.buyer ?? "",
        currency: p.currency ?? "",
        net: centsToInput(p.netCents),
        vat: centsToInput(p.vatCents),
        gross: centsToInput(p.grossCents),
        warnings: p.warnings,
      },
    },
    { headers },
  );
}
