import { NextResponse, type NextRequest } from "next/server";
import { ByteBudget, RateLimiter } from "@/lib/rate-limit";
import { FILE_MAX_BYTES } from "@/modules/workshop/files/constants";
import { uploadFileOperation } from "@/modules/workshop/files/operations";
import { getSession } from "@/server/auth/session";
import { isBehindProxy } from "@/server/auth/network";
import { isSameOriginUpload } from "@/server/request-guard";
import type { OperationFailure } from "@/server/operations";

/**
 * Drossel der Oberfläche je Konto und Stunde (im Arbeitsspeicher, ein Prozess): höchstens 200 Dateien und 500 MB. Ein fehlerhaftes Skript oder ein Dauerlauf (hochladen, entfernen, wiederholen)
 * kann das Volume so nicht in Minuten füllen – es hält zugleich die Datenbank. Gezählt wird die angekündigte Größe jeder Anfrage; abgewiesen wird mit 429 und `Retry-After`.
 */
const UPLOADS_PER_HOUR = 200;
const UPLOAD_BYTES_PER_HOUR = 500 * 1024 * 1024;
const uploadRate = new RateLimiter({ max: UPLOADS_PER_HOUR, windowMs: 3_600_000 });
const uploadBytes = new ByteBudget({ maxBytes: UPLOAD_BYTES_PER_HOUR, windowMs: 3_600_000 });

/** Mehr als die Datei selbst darf der Body nicht haben (Formularfelder, Rand): größere Anfragen werden gar nicht erst gelesen. */
const BODY_OVERHEAD = 64 * 1024;
const KEY_SHAPE = /^[A-Za-z0-9._:~-]{1,128}$/;

/** Fehler der Operation → HTTP-Status: Typ 415, Größe/Bildpunkte 413, Recht 403, unbekannt 404, Konflikt 409, sonst 422. */
function statusOf(failure: OperationFailure): number {
  const key = failure.fields?.file?.key ?? failure.key ?? "";
  if (key === "files.errors.type" || key === "files.errors.mismatch") return 415;
  if (key === "files.errors.tooLarge" || key === "files.errors.pixels") return 413;
  switch (failure.code) {
    case "forbidden":
      return 403;
    case "notFound":
      return 404;
    case "conflict":
    case "duplicate":
    case "inUse":
      return 409;
    case "busy":
      return 503;
    case "failed":
      return 500;
    default:
      return 422;
  }
}

/**
 * Datei an ein Fahrzeug oder einen Auftrag hochladen (Foto-Galerie der Oberfläche; Anmeldung über die Sitzung). Antwort: `{ id, url, replayed }`.
 * Schutz: Sitzung, gleiche Herkunft und eigener Header (`isSameOriginUpload`), Funktion und Recht, **Content-Length ist Pflicht** und begrenzt (411/413 – `formData()` puffert alles im Speicher),
 * danach prüft die Operation `files.upload` Eigentümer (Recht, Archiv, Auftrag offen, Art. 18), Inhalt (Magic Bytes), Bildpunkte und bereinigt die Metadaten (Exif/GPS).
 * **`Idempotency-Key`:** derselbe Schlüssel derselben Person liefert die vorhandene Datei (200, `replayed: true`) – ging die Antwort verloren, entsteht beim Wiederholen keine Dublette.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginUpload(request, await isBehindProxy())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!session.features.has("workshop.files")) return NextResponse.json({ error: "notFound" }, { status: 404 });
  if (!session.can("files.upload")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const header = request.headers.get("content-length");
  const announced = header === null || header.trim() === "" ? Number.NaN : Number(header);
  if (!Number.isInteger(announced) || announced < 0) return NextResponse.json({ error: "lengthRequired" }, { status: 411 });
  if (announced > FILE_MAX_BYTES + BODY_OVERHEAD) return NextResponse.json({ error: "size" }, { status: 413 });
  const decision = uploadRate.take(session.user.id);
  const bytesDecision = decision.allowed ? uploadBytes.take(session.user.id, announced) : decision;
  if (!bytesDecision.allowed) return NextResponse.json({ error: "rateLimited" }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(bytesDecision.retryAfterMs / 1000))) } });
  const key = request.headers.get("idempotency-key");
  if (key !== null && !KEY_SHAPE.test(key)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };
  const outcome = await uploadFileOperation.execute(session, {
    ownerType: text("ownerType"),
    ownerId: text("ownerId"),
    category: text("category"),
    caption: text("caption"),
    name: file.name,
    declaredType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    ...(key ? { uploadKey: key } : {}),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.failure.fields?.file?.key ?? outcome.failure.key ?? outcome.failure.code }, { status: statusOf(outcome.failure) });
  return NextResponse.json({ id: outcome.data.id, url: `/api/files/${outcome.data.id}`, replayed: outcome.data.replayed }, { status: outcome.data.replayed ? 200 : 201 });
}
