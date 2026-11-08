import "server-only";
import { db } from "@/server/db";
import type { KeyRebuildStep } from "@/server/search-key-rebuild";
import { customerSearchKeys } from "./domain";

/** Suchspalten der Kunden (`nameKey/cityKey/phoneKey`) neu berechnen; siehe `server/search-key-rebuild.ts` (Version, Cursor, ohne `updatedAt` zu ändern). */
export const rebuildCustomerKeys: KeyRebuildStep = async (cursor, limit) => {
  const rows = await db.customer.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, updatedAt: true, firstName: true, lastName: true, company: true, city: true, phone: true, nameKey: true, cityKey: true, phoneKey: true },
  });
  let changed = 0;
  for (const row of rows) {
    const keys = customerSearchKeys(row);
    if (keys.nameKey === row.nameKey && keys.cityKey === row.cityKey && keys.phoneKey === row.phoneKey) continue;
    changed += (await db.customer.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { ...keys, updatedAt: row.updatedAt } })).count;
  }
  return { next: rows.length < limit ? null : rows[rows.length - 1]!.id, scanned: rows.length, changed };
};
