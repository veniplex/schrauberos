import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { deliveryHeaders } from "@/lib/file-delivery";
import { signatureOf } from "@/modules/workshop/checklists/queries";
import { getSession } from "@/server/auth/session";
import { fileExists, fileSize, openFile } from "@/server/files";

/**
 * Liefert die Unterschrift (PNG) einer abgeschlossenen Checkliste aus – mit den Rechten, die auch die Checkliste zeigen: Funktion aktiv, `checklists.view` und das Recht auf Fahrzeug bzw. Auftrag, kein Kunde mit
 * eingeschränkter Verarbeitung (sonst 404). Kopfzeilen (nosniff, `sandbox`, Zwischenspeicher aus): `lib/file-delivery.ts`. Die Datei hat der Server selbst aus geprüften PNG-Bytes angelegt.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return new Response("Unauthorized", { status: 401 });
  if (!session.features.has("workshop.checklists") || !session.can("checklists.view")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const signature = await signatureOf(session, id);
  if (!signature || !fileExists(signature.path)) return new Response("Not found", { status: 404 });

  return new Response(Readable.toWeb(openFile(signature.path)) as ReadableStream, {
    headers: deliveryHeaders({ mime: "image/png", name: "unterschrift.png", size: fileSize(signature.path) }),
  });
}
