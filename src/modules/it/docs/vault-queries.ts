import "server-only";
import { versionOf } from "@/lib/concurrency";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { VAULT_KINDS, type VaultKind, type VaultState } from "./vault-constants";

/**
 * Lesen des IT-Tresors (einzige Stelle neben den Operationen, die die Tabelle `VaultEntry` berührt – `architecture.test.ts` erzwingt `it/docs/vault*.ts`). Festgelegt: **die verschlüsselten Spalten
 * (`wrappedKey`, `payload`) werden hier nie gelesen** – der Zustand eines Eintrags (hinterlegt/leer/neu eingeben) kommt aus einer getrennten Abfrage nur der IDs. Es gibt keine Volltextsuche über Zugangsdaten
 * und keinen Weg, Titel in die Schnellsuche, die API, Webhooks oder CSV zu bringen.
 */
export type VaultListRow = { id: string; title: string; kind: VaultKind; system: string | null; state: VaultState; updatedAt: Date; updatedByName: string | null };

const kindOf = (value: string): VaultKind => ((VAULT_KINDS as readonly string[]).includes(value) ? (value as VaultKind) : "other");

async function sealedIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.vaultEntry.findMany({ where: { id: { in: ids }, wrappedKey: { not: null } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export async function listVaultEntries(filters: { q?: string; kind?: string } = {}): Promise<VaultListRow[]> {
  const q = filters.q?.trim();
  const rows = await db.vaultEntry.findMany({
    where: {
      ...((VAULT_KINDS as readonly string[]).includes(filters.kind ?? "") ? { kind: filters.kind } : {}),
      ...(q ? { OR: [{ title: contains(q) }, { system: contains(q) }] } : {}),
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true, kind: true, system: true, unreadableAt: true, updatedAt: true, updatedByName: true },
  });
  const sealed = await sealedIds(rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, title: r.title, kind: kindOf(r.kind), system: r.system, state: sealed.has(r.id) ? "sealed" : r.unreadableAt ? "unreadable" : "empty", updatedAt: r.updatedAt, updatedByName: r.updatedByName }));
}

export async function getVaultEntry(id: string): Promise<(VaultListRow & { version: string; createdByName: string | null; createdAt: Date }) | null> {
  const row = await db.vaultEntry.findUnique({ where: { id }, select: { id: true, title: true, kind: true, system: true, unreadableAt: true, updatedAt: true, updatedByName: true, createdByName: true, createdAt: true } });
  if (!row) return null;
  const sealed = await sealedIds([row.id]);
  return {
    id: row.id,
    title: row.title,
    kind: kindOf(row.kind),
    system: row.system,
    state: sealed.has(row.id) ? "sealed" : row.unreadableAt ? "unreadable" : "empty",
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    version: versionOf(row),
  };
}

/** Nur die Überschrift für den Seitentitel (nach der Rechteprüfung gelesen). */
export async function vaultTitle(id: string): Promise<string | null> {
  return (await db.vaultEntry.findUnique({ where: { id }, select: { title: true } }))?.title ?? null;
}
