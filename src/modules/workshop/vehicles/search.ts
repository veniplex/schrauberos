import "server-only";
import { db } from "@/server/db";
import type { SearchProviderDef } from "@/modules/types";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { vehicleTextWhere } from "./queries";

/** Schnellsuche: Fahrzeuge nach Kennzeichen, Hersteller, Modell, FIN und Halter (Halter nur als Anzeigename, Richtlinie D7). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "vehicles",
    feature: "workshop.vehicles",
    permission: "vehicles.view",
    groupKey: "vehicles.search.group",
    order: 31,
    async search(q, { limit }) {
      const rows = await db.vehicle.findMany({
        where: { archivedAt: null, OR: vehicleTextWhere(q) },
        orderBy: { plateNorm: "asc" },
        take: limit,
        select: { id: true, plate: true, make: true, model: true, customer: { select: { firstName: true, lastName: true, company: true } } },
      });
      return rows.map((v) => ({
        id: v.id,
        title: v.plate,
        subtitle: [[v.make, v.model].filter(Boolean).join(" "), v.customer ? customerDisplayName(v.customer) : ""].filter(Boolean).join(" · ") || undefined,
        href: `/vehicles/${v.id}`,
      }));
    },
  },
];
