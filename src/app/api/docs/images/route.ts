import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { DOC_IMAGE_MAX_BYTES, DOC_IMAGE_TYPES, DOC_PERMISSIONS, isDocArea } from "@/capabilities/docs/areas";

/** Bild für eine Dokumentationsseite hochladen (Recht: Bearbeiten im jeweiligen Bereich). Antwort: { url, id }. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const area = String(form?.get("area") ?? "");
  const file = form?.get("file");
  if (!isDocArea(area) || !(file instanceof File)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!session.can(DOC_PERMISSIONS[area].edit)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(DOC_IMAGE_TYPES as readonly string[]).includes(file.type)) return NextResponse.json({ error: "type" }, { status: 415 });
  if (file.size === 0 || file.size > DOC_IMAGE_MAX_BYTES) return NextResponse.json({ error: "size" }, { status: 413 });

  const image = await db.docImage.create({
    data: { area, name: file.name.slice(0, 120), mime: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) },
  });
  return NextResponse.json({ id: image.id, url: `/api/docs/images/${image.id}` });
}
