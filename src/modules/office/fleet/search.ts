import "server-only";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche: Fuhrparkfahrzeuge nach Kennzeichen, Hersteller, Modell, FIN und Standort. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "fleet",
    feature: "office.fleet",
    permission: "fleet.view",
    groupKey: "fleet.search.group",
    order: 60,
    async search(q, { limit }) {
      const rows = await db.fleetVehicle.findMany({
        where: { OR: [{ plate: contains(q) }, { make: contains(q) }, { model: contains(q) }, { vin: contains(q) }, { location: contains(q) }] },
        orderBy: { plate: "asc" },
        take: limit,
        select: { id: true, plate: true, make: true, model: true },
      });
      return rows.map((v) => ({ id: v.id, title: v.plate, subtitle: [v.make, v.model].filter(Boolean).join(" ") || undefined, href: `/fleet/${v.id}` }));
    },
  },
];
