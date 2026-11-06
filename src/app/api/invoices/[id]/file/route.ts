import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { fileExists, fileSize, openFile } from "@/server/files";

/** Liefert die Datei einer Rechnung aus – nur mit Recht `invoices.view`. ?download=1 erzwingt den Download. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  if (!session.can("invoices.view")) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const file = await db.invoiceFile.findUnique({ where: { invoiceId: id } });
  if (!file || !fileExists(file.path)) return new Response("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  // Dateiname nur ASCII im einfachen Parameter + UTF-8-Variante (RFC 5987)
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Readable.toWeb(openFile(file.path)) as ReadableStream, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(fileSize(file.path)),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
