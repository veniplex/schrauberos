import { NextResponse, type NextRequest } from "next/server";
import { checkUpload } from "@/lib/upload-sniff";
import { db } from "@/server/db";
import { removeFile, storeFile } from "@/server/files";
import { getSession } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { isSameOriginUpload } from "@/server/request-guard";
import { DOC_IMAGE_MAX_BYTES, DOC_IMAGE_TYPES, DOC_PERMISSIONS, isDocArea } from "@/capabilities/docs/areas";

/** Mehr als die Bilddatei selbst darf der Body nicht haben (Formularfelder, Rand): größere Anfragen werden gar nicht erst gelesen. */
const BODY_OVERHEAD = 64 * 1024;

/**
 * Bild für eine Dokumentationsseite hochladen (Recht: Bearbeiten im jeweiligen Bereich). Antwort: { url, id }.
 * Schutz: Sitzung + Recht, gleiche Herkunft und eigener Header (`isSameOriginUpload`), Größe schon vor dem Lesen (Content-Length) und der **Inhalt** der Datei
 * (Magic Bytes) muss ein Bild des erlaubten Typs sein – der gemeldete Typ allein zählt nicht.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginUpload(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > DOC_IMAGE_MAX_BYTES + BODY_OVERHEAD) return NextResponse.json({ error: "size" }, { status: 413 });

  const form = await request.formData().catch(() => null);
  const area = String(form?.get("area") ?? "");
  const file = form?.get("file");
  if (!isDocArea(area) || !(file instanceof File)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!session.can(DOC_PERMISSIONS[area].edit)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (file.size === 0 || file.size > DOC_IMAGE_MAX_BYTES) return NextResponse.json({ error: "size" }, { status: 413 });
  const data = new Uint8Array(await file.arrayBuffer());
  const checked = checkUpload(data, file.type, DOC_IMAGE_TYPES);
  if (!checked.ok) return NextResponse.json({ error: "type" }, { status: 415 });

  // Als normale Datei ablegen (doku/<bereich>/<Name>.<Endung>), in der Datenbank steht nur der Pfad
  // Typ und Endung richten sich nach dem erkannten Inhalt, nicht nach dem hochgeladenen Namen
  const mime = checked.mime;
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[mime] ?? "img";
  const path = await storeFile(`doku/${area}`, `${file.name.replace(/\.[^.]*$/, "") || "bild"}.${ext}`, data);
  try {
    const image = await db.docImage.create({ data: { area, name: file.name.slice(0, 120), mime, size: file.size, path } });
    await audit("docs.imageUpload", { target: `${area}: ${file.name.slice(0, 80)}`, entityId: image.id });
    return NextResponse.json({ id: image.id, url: `/api/docs/images/${image.id}` });
  } catch (error) {
    await removeFile(path).catch(() => undefined);
    throw error;
  }
}
