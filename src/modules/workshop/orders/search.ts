import "server-only";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import type { SearchProviderDef } from "@/modules/types";
import { listOrders } from "./queries";

/** Schnellsuche: Aufträge nach Nummer, Kennzeichen, Fahrzeug und Name des Halters (dieselbe Bedingung wie die Liste). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "orders",
    feature: "workshop.orders",
    permission: "orders.view",
    groupKey: "orders.search.group",
    order: 15,
    async search(q, { session, limit }) {
      const { rows } = await listOrders(session, { q, status: "all" }, { skip: 0, take: limit, orderBy: [{ acceptedAt: "desc" }] });
      return rows.map((o) => ({
        id: o.id,
        title: `${o.number} · ${o.vehicle.plate}`,
        subtitle: [o.customer ? customerDisplayName(o.customer) : "", [o.vehicle.make, o.vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || undefined,
        href: `/orders/${o.id}`,
      }));
    },
  },
];
