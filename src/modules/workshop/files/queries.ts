import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import type { AppSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { visibleFilesWhere } from "./access";
import type { FileCategory, FileOwnerType } from "./constants";

/**
 * Lesezugriffe für Dokumente & Fotos. **Alles läuft durch `visibleFilesWhere`** (Recht der Datei und des Eigentümers, keine Kunden mit eingeschränkter Verarbeitung, keine entfernten Dateien):
 * Eine Datei, die der Betrachter nicht sehen darf, gibt es hier nicht – weder in Listen noch in der Auslieferung noch in der API.
 */

type Viewer = Pick<AppSession, "can" | "features">;

const SELECT = {
  id: true,
  vehicleId: true,
  orderId: true,
  category: true,
  caption: true,
  name: true,
  mime: true,
  size: true,
  width: true,
  height: true,
  uploadedById: true,
  uploadedByName: true,
  strippedBytes: true,
  createdAt: true,
  updatedAt: true,
  vehicle: { select: { plate: true } },
  order: { select: { number: true, status: true } },
} as const satisfies Prisma.FileAttachmentSelect;

type Row = Prisma.FileAttachmentGetPayload<{ select: typeof SELECT }>;

export type FileRow = {
  id: string;
  ownerType: FileOwnerType;
  ownerId: string;
  /** Kennzeichen bzw. Auftragsnummer */
  ownerLabel: string;
  category: FileCategory | string;
  caption: string | null;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedById: string;
  uploadedByName: string;
  strippedBytes: number;
  createdAt: Date;
  version: string;
  /** die Person darf diese Datei ändern/entfernen (Leitung mit `files.delete` oder eigene Datei mit `files.upload`) */
  mayChange: boolean;
  /** Auftrag nicht mehr offen: Änderungen sind gesperrt */
  locked: boolean;
  isImage: boolean;
};

function toRow(row: Row, viewer: Viewer & { user: { id: string } }): FileRow {
  const isOrder = row.orderId !== null;
  const locked = isOrder && !["accepted", "in_progress", "ready"].includes(row.order?.status ?? "");
  return {
    id: row.id,
    ownerType: isOrder ? "order" : "vehicle",
    ownerId: (isOrder ? row.orderId : row.vehicleId) ?? "",
    ownerLabel: (isOrder ? row.order?.number : row.vehicle?.plate) ?? "",
    category: row.category,
    caption: row.caption,
    name: row.name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedByName,
    strippedBytes: row.strippedBytes,
    createdAt: row.createdAt,
    version: versionOf(row),
    mayChange: !locked && (viewer.can("files.delete") || (row.uploadedById === viewer.user.id && viewer.can("files.upload"))),
    locked,
    isImage: row.mime.startsWith("image/"),
  };
}

type Session = Viewer & { user: { id: string } };

/** Dateien eines Fahrzeugs oder Auftrags (neueste zuerst). Leer, wenn der Betrachter sie nicht sehen darf. */
export async function filesOf(viewer: Session, owner: { type: FileOwnerType; id: string }): Promise<FileRow[]> {
  const visible = visibleFilesWhere(viewer);
  if (!visible) return [];
  const rows = await db.fileAttachment.findMany({
    where: { AND: [visible, owner.type === "vehicle" ? { vehicleId: owner.id } : { orderId: owner.id }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SELECT,
  });
  return rows.map((row) => toRow(row, viewer));
}

export type FileListFilters = { q?: string; category?: string; ownerType?: FileOwnerType; ownerId?: string; uploadedById?: string };

function filterWhere(f: FileListFilters): Prisma.FileAttachmentWhereInput {
  const term = f.q?.trim();
  return {
    ...(f.category ? { category: f.category } : {}),
    ...(f.ownerType === "vehicle" ? { vehicleId: f.ownerId ?? { not: null } } : f.ownerType === "order" ? { orderId: f.ownerId ?? { not: null } } : {}),
    ...(f.uploadedById ? { uploadedById: f.uploadedById } : {}),
    ...(term ? { OR: [{ name: contains(term) }, { caption: contains(term) }, { vehicle: { is: { plate: contains(term) } } }, { order: { is: { number: contains(term) } } }] } : {}),
  };
}

/** Eine Seite der Dateiliste (Übersicht und API). */
export async function listFiles(viewer: Session, filters: FileListFilters, page: { skip: number; take: number }): Promise<{ rows: FileRow[]; total: number }> {
  const visible = visibleFilesWhere(viewer);
  if (!visible) return { rows: [], total: 0 };
  const where: Prisma.FileAttachmentWhereInput = { AND: [visible, filterWhere(filters)] };
  const [rows, total] = await Promise.all([
    db.fileAttachment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.skip, take: page.take, select: SELECT }),
    db.fileAttachment.count({ where }),
  ]);
  return { rows: rows.map((row) => toRow(row, viewer)), total };
}

/** Eine sichtbare Datei samt Ablagepfad – für die Auslieferung (null: gibt es für den Betrachter nicht). */
export async function fileForDelivery(viewer: Viewer, id: string): Promise<{ id: string; name: string; mime: string; path: string; size: number } | null> {
  const visible = visibleFilesWhere(viewer);
  if (!visible) return null;
  return db.fileAttachment.findFirst({ where: { AND: [visible, { id }] }, select: { id: true, name: true, mime: true, path: true, size: true } });
}

/** Eine sichtbare Datei (API und Detail). */
export async function getFile(viewer: Session, id: string): Promise<FileRow | null> {
  const visible = visibleFilesWhere(viewer);
  if (!visible) return null;
  const row = await db.fileAttachment.findFirst({ where: { AND: [visible, { id }] }, select: SELECT });
  return row ? toRow(row, viewer) : null;
}

/** Anzahl sichtbarer Dateien je Eigentümer-Art (Kopfzeile der Übersicht). */
export async function countFiles(viewer: Viewer): Promise<number> {
  const visible = visibleFilesWhere(viewer);
  return visible ? db.fileAttachment.count({ where: visible }) : 0;
}

/** Schnellsuche: Dateien nach Beschriftung und Name. */
export async function searchFiles(viewer: Session, q: string, limit: number): Promise<FileRow[]> {
  return (await listFiles(viewer, { q }, { skip: 0, take: limit })).rows;
}
