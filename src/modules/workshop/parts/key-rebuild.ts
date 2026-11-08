import "server-only";
import { searchKey } from "@/lib/search-key";
import { db } from "@/server/db";
import type { KeyRebuildStep } from "@/server/search-key-rebuild";

/** Suchspalte der Artikel (`searchKey` aus Nummer, Bezeichnung, Lieferant) neu berechnen; siehe `server/search-key-rebuild.ts` (Version, Cursor, ohne `updatedAt` zu ändern). */
export const rebuildArticleKeys: KeyRebuildStep = async (cursor, limit) => {
  const rows = await db.article.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, updatedAt: true, number: true, name: true, supplier: true, searchKey: true },
  });
  let changed = 0;
  for (const row of rows) {
    const key = searchKey(row.number, row.name, row.supplier);
    if (key === row.searchKey) continue;
    changed += (await db.article.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { searchKey: key, updatedAt: row.updatedAt } })).count;
  }
  return { next: rows.length < limit ? null : rows[rows.length - 1]!.id, scanned: rows.length, changed };
};
