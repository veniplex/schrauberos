import "server-only";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";
import { customerDisplayName } from "./domain";

/** Schnellsuche: Kunden nach Name, Firma, Kundennummer, Ort, Telefon und E-Mail (Kontaktdaten sind mit `customers.view` sichtbar, das der Anbieter verlangt). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "customers",
    feature: "workshop.customers",
    permission: "customers.view",
    groupKey: "customers.search.group",
    order: 30,
    async search(q, { limit }) {
      const rows = await db.customer.findMany({
        where: { OR: [{ lastName: contains(q) }, { firstName: contains(q) }, { company: contains(q) }, { customerNumber: contains(q) }, { city: contains(q) }, { phone: contains(q) }, { email: contains(q) }] },
        orderBy: { lastName: "asc" },
        take: limit,
        select: { id: true, firstName: true, lastName: true, company: true, customerNumber: true, city: true },
      });
      return rows.map((c) => ({ id: c.id, title: customerDisplayName(c), subtitle: [c.customerNumber ? `#${c.customerNumber}` : "", c.city ?? ""].filter(Boolean).join(" · ") || undefined, href: `/customers/${c.id}` }));
    },
  },
];
