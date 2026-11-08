import "server-only";
import { searchKey } from "@/lib/search-key";
import { db } from "@/server/db";
import type { KeyRebuildStep } from "@/server/search-key-rebuild";

/**
 * Suchspalte der Rechnungen und Belege (`partyKey` aus dem Geschäftspartner) neu berechnen; siehe `server/search-key-rebuild.ts`. Das ist eine abgeleitete Suchhilfe, kein Inhalt des Belegs:
 * Auch festgeschriebene Rechnungen bekommen den neuen Schlüssel (der Beleg selbst – Nummer, Beträge, Partner – bleibt unverändert); `updatedAt` bleibt, die Eindeutigkeitsspalte `outgoingKey` wird nie angefasst.
 */
export const rebuildInvoiceKeys: KeyRebuildStep = async (cursor, limit) => {
  const rows = await db.invoice.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, updatedAt: true, partyName: true, partyKey: true },
  });
  let changed = 0;
  for (const row of rows) {
    const key = searchKey(row.partyName);
    if (key === row.partyKey) continue;
    changed += (await db.invoice.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { partyKey: key, updatedAt: row.updatedAt } })).count;
  }
  return { next: rows.length < limit ? null : rows[rows.length - 1]!.id, scanned: rows.length, changed };
};
