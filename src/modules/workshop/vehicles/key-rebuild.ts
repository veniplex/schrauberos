import "server-only";
import { normalizePlate } from "@/lib/plate";
import { searchKey } from "@/lib/search-key";
import { db } from "@/server/db";
import type { KeyRebuildStep } from "@/server/search-key-rebuild";

/** Suchspalten der Fahrzeuge (`plateNorm`, `searchKey`) neu berechnen; siehe `server/search-key-rebuild.ts` (Version, Cursor, ohne `updatedAt` zu ändern). */
export const rebuildVehicleKeys: KeyRebuildStep = async (cursor, limit) => {
  const rows = await db.vehicle.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, updatedAt: true, plate: true, make: true, model: true, vin: true, plateNorm: true, searchKey: true },
  });
  let changed = 0;
  for (const row of rows) {
    const keys = { plateNorm: normalizePlate(row.plate), searchKey: searchKey(row.make, row.model, row.vin) };
    if (keys.plateNorm === row.plateNorm && keys.searchKey === row.searchKey) continue;
    changed += (await db.vehicle.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { ...keys, updatedAt: row.updatedAt } })).count;
  }
  return { next: rows.length < limit ? null : rows[rows.length - 1]!.id, scanned: rows.length, changed };
};
