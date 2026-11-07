import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { deliveryHeaders } from "@/lib/file-delivery";
import { fileForDelivery } from "@/modules/workshop/files/queries";
import { getSession } from "@/server/auth/session";
import { fileExists, fileSize, openFile } from "@/server/files";

/**
 * Liefert eine Datei (Foto, PDF) aus – nur mit den Rechten, die auch die Dateiliste zeigen: Funktion aktiv, `files.view` **und** das Recht auf Fahrzeug bzw. Auftrag, kein Kunde mit
 * eingeschränkter Verarbeitung, nicht entfernt (sonst 404, nie ein Hinweis auf die Existenz). Kopfzeilen (nosniff, `sandbox`, Content-Disposition): `lib/file-delivery.ts`; mit `?download=1` als Download.
 * Der Inhalt ist unveränderlich (neue Kennung bei neuer Datei), der Zwischenspeicher nur privat und kurz.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return new Response("Unauthorized", { status: 401 });
  if (!session.features.has("workshop.files") || !session.can("files.view")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const file = await fileForDelivery(session, id);
  if (!file || !fileExists(file.path)) return new Response("Not found", { status: 404 });

  return new Response(Readable.toWeb(openFile(file.path)) as ReadableStream, {
    headers: deliveryHeaders({ mime: file.mime, name: file.name, size: fileSize(file.path), download: request.nextUrl.searchParams.get("download") === "1", cacheControl: "private, max-age=300" }),
  });
}
