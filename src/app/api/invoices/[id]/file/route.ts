import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { deliveryHeaders } from "@/lib/file-delivery";
import { fileExists, fileSize, openFile } from "@/server/files";

/**
 * Liefert die Datei einer Rechnung aus – nur mit Recht `invoices.view`. ?download=1 erzwingt den Download. Kopfzeilen (nosniff, PDF inline,
 * sonst `sandbox`, XML nur als Download, sicherer Dateiname): siehe `lib/file-delivery.ts`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return new Response("Unauthorized", { status: 401 });
  if (!session.can("invoices.view")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const file = await db.invoiceFile.findUnique({ where: { invoiceId: id } });
  if (!file || !fileExists(file.path)) return new Response("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  return new Response(Readable.toWeb(openFile(file.path)) as ReadableStream, {
    headers: deliveryHeaders({ mime: file.mime, name: file.name, download, size: fileSize(file.path) }),
  });
}
