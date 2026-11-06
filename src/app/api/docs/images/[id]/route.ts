import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { fileExists, fileSize, openFile } from "@/server/files";
import { isDocArea } from "@/capabilities/docs/areas";
import { canViewDocImage } from "@/capabilities/docs/images";

/** Liefert ein Doku-Bild aus – nur mit Leserecht auf den Bereich und nur, wenn das Bild auf einer für den Betrachter sichtbaren Seite steht (Bearbeiter: alle). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const image = await db.docImage.findUnique({ where: { id } });
  if (!image || !isDocArea(image.area) || !fileExists(image.path)) return new Response("Not found", { status: 404 });
  if (!(await canViewDocImage(session, { id: image.id, area: image.area }))) return new Response("Forbidden", { status: 403 });

  return new Response(Readable.toWeb(openFile(image.path)) as ReadableStream, {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(fileSize(image.path)),
      "X-Content-Type-Options": "nosniff",
      // Inhalt ist unveränderlich (neue ID bei neuem Bild) – nur privat im Browser cachen
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
