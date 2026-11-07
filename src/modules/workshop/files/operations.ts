import { createHash } from "node:crypto";
import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { truncateName } from "@/lib/file-delivery";
import { sanitizeImage } from "@/lib/image-sanitize";
import { checkUpload } from "@/lib/upload-sniff";
import { isOrderOpen } from "@/modules/workshop/orders/public";
import { db } from "@/server/db";
import { removeFile, storeFile } from "@/server/files";
import { defineOperation, fail, failField } from "@/server/operations";
import { ownerAccess, visibleFilesWhere } from "./access";
import { CAPTION_MAX, FILE_CATEGORIES, FILE_EXTENSIONS, FILE_MAX_BYTES, FILE_OWNER_TYPES, FILE_TYPES, isImageType, MAX_FILES_PER_OWNER } from "./constants";

/**
 * Operationen für Dokumente & Fotos an Fahrzeugen und Aufträgen. **Hochladen** ist für Oberfläche (Route `/api/files`) und API (`POST /api/v1/files`) dieselbe Operation:
 *  - Inhalt statt gemeldetem Typ (`checkUpload`: Magic Bytes, **gespeichert wird der erkannte Typ**), nur JPEG, PNG und PDF; Dateigröße begrenzt;
 *  - Fotos laufen durch `sanitizeImage`: **Bildpunkte aus dem Dateikopf** (Grenze gegen Dekompressionsbomben), **Exif/GPS, XMP, Kommentare und Anhängsel entfernt**, die Drehung bleibt;
 *  - die Datei entsteht in `prepare` (außerhalb der Transaktion) und wird in `finish` wieder entfernt, wenn die Transaktion scheitert (Rollback-Aufräumen wie bei der Freigabe-Unterschrift);
 *  - **Idempotenz:** derselbe `uploadKey` (Header `Idempotency-Key`) derselben Person liefert den vorhandenen Eintrag – keine Dublette, auch nicht bei verlorener Antwort oder gleichzeitigem Wiederholen;
 *    derselbe Schlüssel mit anderem Inhalt, an anderem Eigentümer, in anderer Art oder für eine inzwischen entfernte Datei wird abgelehnt (`keyReuse`);
 *  - **Kontingent:** höchstens `MAX_FILES_PER_OWNER` Dateien je Fahrzeug/Auftrag – **entfernte zählen bis zum Löschlauf mit** (sonst ließe sich der Datenträger über Hochladen und Entfernen füllen); die Oberfläche wird zusätzlich je Konto und Stunde gedrosselt.
 * Dateien werden nie überschrieben oder verändert (Backups nutzen Hardlinks): **Entfernen** setzt `archivedAt`; ein Löschlauf (`jobs.ts`, `purge.ts`) löst entfernte Dateien nach einer Frist endgültig vom Datenträger.
 */

const uploadKeyField = z.string().regex(/^[A-Za-z0-9._:~-]{1,128}$/, { error: "validation.invalid" });

export const uploadFileInput = z.object({
  ownerType: z.enum(FILE_OWNER_TYPES),
  ownerId: z.string().min(1).max(64),
  category: z.enum(FILE_CATEGORIES).default("photo"),
  caption: z.string().trim().max(CAPTION_MAX).optional(),
  /** Name der hochgeladenen Datei (nur zur Anzeige und für den Download; nie für den Pfad) */
  name: z.string().max(400).default("datei"),
  /** vom Absender gemeldeter Typ (muss, wenn angegeben, zum Inhalt passen) */
  declaredType: z.string().max(120).default(""),
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array, { error: "files.errors.empty" }),
  uploadKey: uploadKeyField.optional(),
});
export type UploadFileInput = z.output<typeof uploadFileInput>;

type Prepared = { existingId: string | null; path: string | null; mime: string; size: number; width: number | null; height: number | null; sha256: string; strippedBytes: number; label: string };

const byName = (principal: { user: { name: string } }): string => principal.user.name.slice(0, 80);

export const uploadFileOperation = defineOperation({
  name: "files.upload",
  permission: "files.upload",
  input: uploadFileInput,
  audit: "files.upload",
  prepare: async ({ input: d, principal }): Promise<Prepared> => {
    // Wiederholung mit demselben Schlüssel zuerst (auch wenn der Auftrag inzwischen geschlossen ist): der vorhandene Eintrag, solange er zum selben Ziel gehört und nicht entfernt ist
    if (d.uploadKey) {
      const same = await db.fileAttachment.findUnique({ where: { uploadedById_uploadKey: { uploadedById: principal.user.id, uploadKey: d.uploadKey } }, select: { id: true, sha256: true, category: true, vehicleId: true, orderId: true, archivedAt: true } });
      if (same) {
        const sameTarget = (d.ownerType === "vehicle" ? same.vehicleId : same.orderId) === d.ownerId && same.category === d.category;
        if (!sameTarget || same.archivedAt !== null) failField("file", "files.errors.keyReuse");
        const hash = createHash("sha256").update(d.bytes).digest("hex");
        if (same.sha256 !== hash) failField("file", "files.errors.keyReuse");
        return { existingId: same.id, path: null, mime: "", size: 0, width: null, height: null, sha256: hash, strippedBytes: 0, label: "" };
      }
    }
    const owner = await ownerAccess(principal, d.ownerType, d.ownerId);
    if (d.bytes.length === 0) failField("file", "files.errors.empty");
    if (d.bytes.length > FILE_MAX_BYTES) failField("file", "files.errors.tooLarge");
    const checked = checkUpload(d.bytes, d.declaredType, FILE_TYPES);
    if (!checked.ok) failField("file", checked.reason === "mismatch" ? "files.errors.mismatch" : "files.errors.type");
    const sha256 = createHash("sha256").update(d.bytes).digest("hex");
    // Kontingent: entfernte Dateien zählen bis zum Löschlauf mit (purgedAt noch leer)
    if ((await db.fileAttachment.count({ where: d.ownerType === "vehicle" ? { vehicleId: owner.id, purgedAt: null } : { orderId: owner.id, purgedAt: null } })) >= MAX_FILES_PER_OWNER) fail("invalid", "files.errors.tooMany");

    let content: Buffer = Buffer.from(d.bytes);
    let width: number | null = null;
    let height: number | null = null;
    let strippedBytes = 0;
    if (isImageType(checked.mime)) {
      const clean = sanitizeImage(d.bytes);
      if (!clean.ok) failField("file", clean.reason === "size" ? "files.errors.pixels" : "files.errors.corrupt");
      content = clean.bytes;
      width = clean.width;
      height = clean.height;
      strippedBytes = clean.removedBytes;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = checked.mime === "application/pdf" ? "dokument" : "foto";
    const ext = FILE_EXTENSIONS[checked.mime as keyof typeof FILE_EXTENSIONS];
    const path = await storeFile(owner.dir, `${prefix}-${stamp}.${ext}`, content);
    return { existingId: null, path, mime: checked.mime, size: content.length, width, height, sha256, strippedBytes, label: owner.label };
  },
  run: async ({ input: d, principal, prepared, tx, audit, emit, afterCommit }) => {
    if (prepared.existingId) return { id: prepared.existingId, replayed: true };
    const owner = await ownerAccess(principal, d.ownerType, d.ownerId, tx);
    const data = {
      ...(owner.type === "vehicle" ? { vehicleId: owner.id } : { orderId: owner.id }),
      category: d.category,
      caption: d.caption || null,
      name: truncateName(d.name, 120) || "datei",
      mime: prepared.mime,
      size: prepared.size,
      width: prepared.width,
      height: prepared.height,
      path: prepared.path!,
      sha256: prepared.sha256,
      uploadKey: d.uploadKey ?? null,
      uploadedById: principal.user.id,
      uploadedByName: byName(principal),
      strippedBytes: prepared.strippedBytes,
    };
    let id: string;
    try {
      id = (await tx.fileAttachment.create({ data, select: { id: true } })).id;
    } catch (error) {
      // gleichzeitige Wiederholung mit demselben Schlüssel: die andere Anfrage war schneller – deren Eintrag gilt, die eben abgelegte Datei entfällt
      if ((error as { code?: string }).code === "P2002" && d.uploadKey) {
        const same = await tx.fileAttachment.findUnique({ where: { uploadedById_uploadKey: { uploadedById: principal.user.id, uploadKey: d.uploadKey } }, select: { id: true } });
        if (same) {
          afterCommit(() => removeFile(prepared.path!));
          return { id: same.id, replayed: true };
        }
      }
      throw error;
    }
    await emit("file.uploaded", { owner: owner.type, category: d.category }, id);
    // Das Audit-Log nennt Fahrzeug bzw. Auftrag und Art, nie den Dateinamen (er kann Namen von Personen enthalten)
    audit({ target: `${owner.label} · ${d.category}`, entityId: id });
    return { id, replayed: false };
  },
  finish: async (prepared, ok) => {
    if (!ok && prepared?.path) await removeFile(prepared.path).catch(() => undefined);
  },
});

/** Wer eine Datei verändern darf: `files.delete` (Leitung) oder die hochladende Person mit `files.upload`. */
const mayChange = (principal: { user: { id: string }; can(permission: "files.delete" | "files.upload"): boolean }, row: { uploadedById: string }): boolean =>
  principal.can("files.delete") || (row.uploadedById === principal.user.id && principal.can("files.upload"));

const updateInput = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  category: z.enum(FILE_CATEGORIES),
  caption: z.string().trim().max(CAPTION_MAX).optional(),
});

/** Beschriftung und Art einer Datei ändern (eigene Dateien; mit `files.delete` alle). Die Datei selbst bleibt unverändert. */
export const updateFileOperation = defineOperation({
  name: "files.update",
  permission: "files.view",
  input: updateInput,
  audit: "files.update",
  run: async ({ input: d, principal, tx, audit }) => {
    const where = visibleFilesWhere(principal);
    if (!where) fail("forbidden");
    const row = await tx.fileAttachment.findFirst({ where: { id: d.id, ...where }, select: { id: true, uploadedById: true, vehicle: { select: { plate: true } }, order: { select: { number: true, status: true } } } });
    if (!row) fail("notFound");
    if (!mayChange(principal, row)) fail("forbidden");
    if (row.order && !isOrderOpen(row.order.status)) fail("invalid", "files.errors.orderClosed");
    if (!(await claimRow(tx.fileAttachment, d.id, d.version))) fail("conflict");
    await tx.fileAttachment.update({ where: { id: d.id }, data: { category: d.category, caption: d.caption || null } });
    audit({ target: `${row.vehicle?.plate ?? row.order?.number ?? ""} · ${d.category}`, entityId: d.id });
    return { id: d.id };
  },
});

/**
 * Entfernt eine Datei: sie bekommt `archivedAt` und verschwindet aus Listen und Auslieferung, die Datei bleibt unverändert auf dem Datenträger (nie überschrieben, Backups nutzen Hardlinks) – ein Versehen
 * lässt sich über die Datenbank und das Dateiverzeichnis nachvollziehen. Entfernen darf, wer `files.delete` hat (Leitung) oder die Datei selbst hochgeladen hat (mit `files.upload`).
 */
export const archiveFileOperation = defineOperation({
  name: "files.archive",
  permission: "files.view",
  input: z.object({ id: z.string().min(1) }),
  audit: "files.archive",
  run: async ({ input: d, principal, tx, audit }) => {
    const where = visibleFilesWhere(principal);
    if (!where) fail("forbidden");
    const row = await tx.fileAttachment.findFirst({ where: { id: d.id, ...where }, select: { id: true, uploadedById: true, category: true, vehicle: { select: { plate: true } }, order: { select: { number: true, status: true } } } });
    if (!row) fail("notFound");
    if (!mayChange(principal, row)) fail("forbidden");
    if (row.order && !isOrderOpen(row.order.status)) fail("invalid", "files.errors.orderClosed");
    // bedingt: von zwei gleichzeitigen Aufrufen entfernt genau einer
    const done = await tx.fileAttachment.updateMany({ where: { id: d.id, archivedAt: null }, data: { archivedAt: new Date(), archivedByName: byName(principal) } });
    if (done.count === 0) fail("notFound");
    audit({ target: `${row.vehicle?.plate ?? row.order?.number ?? ""} · ${row.category}`, entityId: d.id });
    return { id: d.id };
  },
});
