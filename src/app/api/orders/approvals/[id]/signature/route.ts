import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { deliveryHeaders } from "@/lib/file-delivery";
import { approvalSignature } from "@/modules/workshop/orders/queries";
import { getSession } from "@/server/auth/session";
import { fileExists, fileSize, openFile } from "@/server/files";

/**
 * Liefert die Unterschrift (PNG) einer Kundenfreigabe aus – mit den Rechten, die auch den Betrag der Freigabe zeigen: Funktion aktiv, `orders.view` und `orders.prices`. Kopfzeilen
 * (nosniff, `sandbox`, Zwischenspeicher aus): `lib/file-delivery.ts`. Die Datei hat der Server selbst aus geprüften PNG-Bytes angelegt.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return new Response("Unauthorized", { status: 401 });
  if (!session.features.has("workshop.orders") || !session.can("orders.view") || !session.can("orders.prices")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const signature = await approvalSignature(id);
  if (!signature || !fileExists(signature.path)) return new Response("Not found", { status: 404 });

  return new Response(Readable.toWeb(openFile(signature.path)) as ReadableStream, {
    headers: deliveryHeaders({ mime: "image/png", name: "unterschrift.png", size: fileSize(signature.path) }),
  });
}
