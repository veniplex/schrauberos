import "server-only";
import { normalizePlate } from "@/lib/plate";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche: Reifensätze nach Marke, Modell, Lagerort und Kennzeichen des Fahrzeugs. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "tires",
    feature: "workshop.tires",
    permission: "tires.view",
    groupKey: "tires.search.group",
    order: 20,
    async search(q, { limit }) {
      const plate = normalizePlate(q);
      const rows = await db.tireSet.findMany({
        where: { OR: [{ brand: contains(q) }, { model: contains(q) }, { storageLocation: contains(q) }, ...(plate ? [{ vehicle: { plateNorm: { contains: plate } } }] : [])] },
        orderBy: { storedAt: "desc" },
        take: limit,
        select: { id: true, brand: true, model: true, storageLocation: true, vehicle: { select: { plate: true } } },
      });
      return rows.map((s) => ({
        id: s.id,
        title: [s.vehicle.plate, [s.brand, s.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
        subtitle: s.storageLocation ?? undefined,
        href: `/tires/${s.id}`,
      }));
    },
  },
];
