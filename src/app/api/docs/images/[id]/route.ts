import { type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { DOC_PERMISSIONS, isDocArea } from "@/capabilities/docs/areas";

/** Liefert ein Doku-Bild aus – nur mit Leserecht auf den Bereich, zu dem das Bild gehört. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const image = await db.docImage.findUnique({ where: { id } });
  if (!image || !isDocArea(image.area)) return new Response("Not found", { status: 404 });
  if (!session.can(DOC_PERMISSIONS[image.area].view)) return new Response("Forbidden", { status: 403 });

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.size),
      "X-Content-Type-Options": "nosniff",
      // Inhalt ist unveränderlich (neue ID bei neuem Bild) – nur privat im Browser cachen
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
