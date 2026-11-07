import "server-only";
import { db } from "@/server/db";
import type { SearchProviderDef } from "@/modules/types";
import { invoiceTextWhere, ledgerWhere } from "./queries";

/** Schnellsuche: Rechnungen nach Nummer, Geschäftspartner und Referenz. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "invoices",
    feature: "office.invoices",
    permission: "invoices.view",
    groupKey: "invoices.search.group",
    order: 40,
    async search(q, { limit }) {
      const rows = await db.invoice.findMany({
        where: { AND: [ledgerWhere, { OR: invoiceTextWhere(q, { category: false }) }] },
        orderBy: { issueDate: "desc" },
        take: limit,
        select: { id: true, number: true, partyName: true },
      });
      return rows.map((i) => ({ id: i.id, title: i.number, subtitle: i.partyName, href: `/invoices/${i.id}` }));
    },
  },
];
