import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { normalizePlate } from "@/lib/plate";
import type { AppSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { visibleChecklistsWhere } from "./access";
import type { ChecklistStatus, SignatureMode } from "./constants";
import { outOfRange, progress as progressOf } from "./domain";

/**
 * Lesezugriffe für Checklisten. **Alles läuft durch `visibleChecklistsWhere`** (Recht der Checkliste und des Fahrzeugs bzw. Auftrags, keine Kunden mit eingeschränkter Verarbeitung): Eine Checkliste, die der
 * Betrachter nicht sehen darf, gibt es hier nicht – weder in Listen noch auf der Detailseite noch bei der Unterschrift.
 */

type Viewer = Pick<AppSession, "can" | "features"> & { user: { id: string } };

const ROW = {
  id: true,
  templateId: true,
  templateName: true,
  templateVersion: true,
  standardKey: true,
  status: true,
  vehicleId: true,
  orderId: true,
  createdByName: true,
  createdById: true,
  createdAt: true,
  completedAt: true,
  signaturePath: true,
  signedName: true,
  updatedAt: true,
  vehicle: { select: { plate: true, make: true, model: true } },
  order: { select: { number: true } },
  items: { select: { done: true, required: true } },
} as const satisfies Prisma.ChecklistSelect;

type RowData = Prisma.ChecklistGetPayload<{ select: typeof ROW }>;

export type ChecklistRow = {
  id: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  standardKey: string | null;
  status: ChecklistStatus;
  vehicleId: string;
  plate: string;
  vehicleName: string;
  orderId: string | null;
  orderNumber: string | null;
  createdByName: string;
  /** Konto, das die Checkliste begonnen hat (null: ältere Zeilen) */
  createdById: string | null;
  createdAt: Date;
  completedAt: Date | null;
  signed: boolean;
  progress: { done: number; total: number };
  requiredOpen: number;
  version: string;
};

const toRow = (row: RowData): ChecklistRow => ({
  id: row.id,
  templateId: row.templateId,
  templateName: row.templateName,
  templateVersion: row.templateVersion,
  standardKey: row.standardKey,
  status: (["open", "completed", "discarded"].includes(row.status) ? row.status : "open") as ChecklistStatus,
  vehicleId: row.vehicleId,
  plate: row.vehicle.plate,
  vehicleName: [row.vehicle.make, row.vehicle.model].filter(Boolean).join(" "),
  orderId: row.orderId,
  orderNumber: row.order?.number ?? null,
  createdByName: row.createdByName,
  createdById: row.createdById,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
  signed: row.signaturePath !== null || row.signedName !== null,
  progress: progressOf(row.items),
  requiredOpen: row.items.filter((i) => i.required && !i.done).length,
  version: versionOf(row),
});

export type ChecklistFilters = { status?: ChecklistStatus | "all"; q?: string; standardKey?: string; vehicleId?: string; orderId?: string };

function filterWhere(f: ChecklistFilters): Prisma.ChecklistWhereInput {
  const term = f.q?.trim();
  const plate = term ? normalizePlate(term) : "";
  return {
    ...(f.status && f.status !== "all" ? { status: f.status } : {}),
    ...(f.standardKey ? { standardKey: f.standardKey } : {}),
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.orderId ? { orderId: f.orderId } : {}),
    ...(term
      ? { OR: [{ templateName: contains(term) }, { vehicle: { is: { plate: contains(term) } } }, ...(plate ? [{ vehicle: { is: { plateNorm: { contains: plate } } } }] : []), { order: { is: { number: contains(term) } } }] }
      : {}),
  };
}

/** Eine Seite von Checklisten (neueste zuerst). */
export async function listChecklists(viewer: Viewer, filters: ChecklistFilters, page: { skip: number; take: number }): Promise<{ rows: ChecklistRow[]; total: number }> {
  const visible = visibleChecklistsWhere(viewer);
  if (!visible) return { rows: [], total: 0 };
  const where: Prisma.ChecklistWhereInput = { AND: [visible, filterWhere(filters)] };
  const [rows, total] = await Promise.all([
    db.checklist.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.skip, take: page.take, select: ROW }),
    db.checklist.count({ where }),
  ]);
  return { rows: rows.map(toRow), total };
}

/** Anzahl nach Zustand (Reiter der Liste und Baustein der Übersicht). */
export async function statusCounts(viewer: Viewer): Promise<Record<ChecklistStatus, number>> {
  const visible = visibleChecklistsWhere(viewer);
  const zero = { open: 0, completed: 0, discarded: 0 };
  if (!visible) return zero;
  const groups = await db.checklist.groupBy({ by: ["status"], where: visible, _count: { _all: true } });
  for (const g of groups) if (g.status in zero) zero[g.status as ChecklistStatus] = g._count._all;
  return zero;
}

/** Checklisten eines Fahrzeugs (ohne Auftrag) oder Auftrags für den Abschnitt der Seite (verworfene nicht). */
export async function checklistsOf(viewer: Viewer, owner: { type: "vehicle" | "order"; id: string }): Promise<ChecklistRow[]> {
  const visible = visibleChecklistsWhere(viewer);
  if (!visible) return [];
  const rows = await db.checklist.findMany({
    where: { AND: [visible, owner.type === "order" ? { orderId: owner.id } : { vehicleId: owner.id }, { status: { not: "discarded" } }] },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: ROW,
  });
  return rows.map(toRow);
}

/** Offene Checklisten für den Baustein der Übersicht (die ältesten zuerst). */
export async function openChecklists(viewer: Viewer, limit = 5): Promise<ChecklistRow[]> {
  const visible = visibleChecklistsWhere(viewer);
  if (!visible) return [];
  const rows = await db.checklist.findMany({ where: { AND: [visible, { status: "open" }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, select: ROW });
  return rows.map(toRow);
}

export type ChecklistItemView = {
  id: string;
  position: number;
  label: string;
  type: string;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  targetValue: number | null;
  options: string | null;
  required: boolean;
  hint: string | null;
  done: boolean;
  numberValue: number | null;
  textValue: string | null;
  doneByName: string | null;
  doneAt: Date | null;
  version: string;
  outOfRange: boolean;
};

export type ChecklistDetail = ChecklistRow & {
  signatureMode: SignatureMode;
  customerName: string | null;
  signedName: string | null;
  hasSignatureImage: boolean;
  note: string | null;
  completedByName: string | null;
  items: ChecklistItemView[];
  events: Array<{ id: string; kind: string; byName: string; note: string | null; at: Date }>;
  /** Auftrag (falls vorhanden) ist offen: nur dann lässt sich die Checkliste ändern */
  ownerOpen: boolean;
};

/** Eine Checkliste mit Punkten und Verlauf (null: gibt es für den Betrachter nicht). */
export async function getChecklist(viewer: Viewer, id: string): Promise<ChecklistDetail | null> {
  const visible = visibleChecklistsWhere(viewer);
  if (!visible) return null;
  const row = await db.checklist.findFirst({
    where: { AND: [visible, { id }] },
    select: {
      ...ROW,
      signatureMode: true,
      customerName: true,
      note: true,
      completedByName: true,
      order: { select: { number: true, status: true } },
      items: { orderBy: { position: "asc" } },
      events: { orderBy: { at: "asc" }, select: { id: true, kind: true, byName: true, note: true, at: true } },
    },
  });
  if (!row) return null;
  const base = toRow({ ...row, items: row.items.map((i) => ({ done: i.done, required: i.required })) });
  return {
    ...base,
    signatureMode: (["none", "optional", "required"].includes(row.signatureMode) ? row.signatureMode : "none") as SignatureMode,
    customerName: row.customerName,
    signedName: row.signedName,
    hasSignatureImage: row.signaturePath !== null,
    note: row.note,
    completedByName: row.completedByName,
    items: row.items.map((i) => ({
      id: i.id,
      position: i.position,
      label: i.label,
      type: i.type,
      unit: i.unit,
      minValue: i.minValue,
      maxValue: i.maxValue,
      targetValue: i.targetValue,
      options: i.options,
      required: i.required,
      hint: i.hint,
      done: i.done,
      numberValue: i.numberValue,
      textValue: i.textValue,
      doneByName: i.doneByName,
      doneAt: i.doneAt,
      version: versionOf(i),
      outOfRange: outOfRange(i),
    })),
    events: row.events,
    ownerOpen: row.order ? ["accepted", "in_progress", "ready"].includes(row.order.status) : true,
  };
}

/** Pfad der Unterschrift einer sichtbaren Checkliste – für die Auslieferung. */
export async function signatureOf(viewer: Viewer, id: string): Promise<{ path: string } | null> {
  const visible = visibleChecklistsWhere(viewer);
  if (!visible) return null;
  const row = await db.checklist.findFirst({ where: { AND: [visible, { id, status: "completed" }] }, select: { signaturePath: true } });
  return row?.signaturePath ? { path: row.signaturePath } : null;
}

/* ───────────── Vorlagen ───────────── */

export type TemplateRow = { id: string; name: string; standardKey: string | null; archived: boolean; version: number; signatureMode: SignatureMode; itemCount: number; updatedAt: Date; versionToken: string };

const mode = (value: string): SignatureMode => (value === "optional" || value === "required" ? value : "none");

/** Vorlagen für den Start (aktive) bzw. die Verwaltung (alle, auch archivierte). */
export async function listTemplates(viewer: Pick<AppSession, "can">, options: { includeArchived?: boolean } = {}): Promise<TemplateRow[]> {
  if (!viewer.can("checklists.view")) return [];
  const rows = await db.checklistTemplate.findMany({
    where: options.includeArchived && viewer.can("checklists.manage") ? {} : { archivedAt: null },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { id: true, name: true, standardKey: true, archivedAt: true, updatedAt: true, versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, signatureMode: true, _count: { select: { items: true } } } } },
  });
  return rows.flatMap((t) =>
    t.versions[0]
      ? [{ id: t.id, name: t.name, standardKey: t.standardKey, archived: t.archivedAt !== null, version: t.versions[0].version, signatureMode: mode(t.versions[0].signatureMode), itemCount: t.versions[0]._count.items, updatedAt: t.updatedAt, versionToken: versionOf(t) }]
      : [],
  );
}

export type TemplateDetail = TemplateRow & {
  description: string | null;
  items: Array<{ label: string; type: string; unit: string | null; minValue: number | null; maxValue: number | null; targetValue: number | null; options: string | null; required: boolean; hint: string | null }>;
  versions: Array<{ version: number; name: string; note: string | null; createdByName: string; createdAt: Date; signatureMode: SignatureMode; itemCount: number; checklists: number }>;
};

/** Eine Vorlage mit den Punkten der aktuellen Version und allen Versionen (nur mit `checklists.manage`). */
export async function getTemplate(viewer: Pick<AppSession, "can">, id: string): Promise<TemplateDetail | null> {
  if (!viewer.can("checklists.manage")) return null;
  const t = await db.checklistTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      standardKey: true,
      archivedAt: true,
      updatedAt: true,
      versions: { orderBy: { version: "desc" }, select: { version: true, name: true, description: true, note: true, createdByName: true, createdAt: true, signatureMode: true, items: { orderBy: { position: "asc" } }, _count: { select: { checklists: true } } } },
    },
  });
  const latest = t?.versions[0];
  if (!t || !latest) return null;
  return {
    id: t.id,
    name: t.name,
    standardKey: t.standardKey,
    archived: t.archivedAt !== null,
    version: latest.version,
    signatureMode: mode(latest.signatureMode),
    itemCount: latest.items.length,
    updatedAt: t.updatedAt,
    versionToken: versionOf(t),
    description: latest.description,
    items: latest.items.map((i) => ({ label: i.label, type: i.type, unit: i.unit, minValue: i.minValue, maxValue: i.maxValue, targetValue: i.targetValue, options: i.options, required: i.required, hint: i.hint })),
    versions: t.versions.map((v) => ({ version: v.version, name: v.name, note: v.note, createdByName: v.createdByName, createdAt: v.createdAt, signatureMode: mode(v.signatureMode), itemCount: v.items.length, checklists: v._count.checklists })),
  };
}

/** Schnellsuche: Checklisten nach Vorlage, Kennzeichen und Auftragsnummer. */
export async function searchChecklists(viewer: Viewer, q: string, limit: number): Promise<ChecklistRow[]> {
  return (await listChecklists(viewer, { q, status: "all" }, { skip: 0, take: limit })).rows;
}

/* ───────────── Protokoll für den Druck (F8) ───────────── */

export type ChecklistProtocol = {
  id: string;
  templateName: string;
  templateVersion: number;
  standardKey: string | null;
  status: ChecklistStatus;
  plate: string;
  orderNumber: string | null;
  createdByName: string;
  completedAt: Date | null;
  completedByName: string | null;
  customerName: string | null;
  note: string | null;
  /** `image`: gezeichnete Unterschrift (Bytes über `readProtocolSignature`), `typed`: getippter Name mit Bestätigung, `none` */
  signature: { kind: "image" | "typed" | "none"; name: string | null };
  items: Array<{ label: string; type: string; unit: string | null; required: boolean; done: boolean; numberValue: number | null; textValue: string | null; outOfRange: boolean; targetValue: number | null; hint: string | null }>;
};

function toProtocol(detail: ChecklistDetail): ChecklistProtocol {
  return {
    id: detail.id,
    templateName: detail.templateName,
    templateVersion: detail.templateVersion,
    standardKey: detail.standardKey,
    status: detail.status,
    plate: detail.plate,
    orderNumber: detail.orderNumber,
    createdByName: detail.createdByName,
    completedAt: detail.completedAt,
    completedByName: detail.completedByName,
    customerName: detail.customerName,
    note: detail.note,
    signature: detail.hasSignatureImage ? { kind: "image", name: detail.customerName } : detail.signedName ? { kind: "typed", name: detail.signedName } : { kind: "none", name: null },
    items: detail.items.map((i) => ({ label: i.label, type: i.type, unit: i.unit, required: i.required, done: i.done, numberValue: i.numberValue, textValue: i.textValue, outOfRange: i.outOfRange, targetValue: i.targetValue, hint: i.hint })),
  };
}

/** Eine Checkliste samt Punkten und Unterschrift-Referenz für den Druck (F8) – mit denselben Rechten und Sperren wie die Detailseite (null: gibt es für den Betrachter nicht). */
export async function checklistProtocol(viewer: Viewer, id: string): Promise<ChecklistProtocol | null> {
  const detail = await getChecklist(viewer, id);
  return detail ? toProtocol(detail) : null;
}

/** Das Annahmeprotokoll eines Auftrags: die zuletzt abgeschlossene, sonst die jüngste offene Checkliste der Vorlage „Annahmeprotokoll“ (null: keines oder nicht sichtbar). */
export async function intakeProtocol(viewer: Viewer, orderId: string): Promise<ChecklistProtocol | null> {
  const visible = visibleChecklistsWhere(viewer);
  if (!visible) return null;
  const rows = await db.checklist.findMany({ where: { AND: [visible, { orderId, standardKey: "intake", status: { in: ["completed", "open"] } }] }, orderBy: [{ createdAt: "desc" }], select: { id: true, status: true } });
  const pick = rows.find((r) => r.status === "completed") ?? rows[0];
  return pick ? checklistProtocol(viewer, pick.id) : null;
}

/** Die Bytes der gezeichneten Unterschrift (PNG) einer abgeschlossenen, sichtbaren Checkliste; null, wenn es keine gibt oder sie nicht sichtbar ist. */
export async function readProtocolSignature(viewer: Viewer, id: string): Promise<Buffer | null> {
  const signature = await signatureOf(viewer, id);
  if (!signature) return null;
  const { readFile } = await import("node:fs/promises");
  const { resolveRel } = await import("@/server/files");
  return readFile(resolveRel(signature.path)).catch(() => null);
}
