import "server-only";
import { db } from "@/server/db";
import type { SearchProviderDef } from "@/modules/types";
import { archiveListedWhere, invoiceTextWhere, ledgerWhere } from "./queries";

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
        where: { AND: [ledgerWhere, archiveListedWhere, { OR: invoiceTextWhere(q, { category: false }) }] }, // eingeschränkte Kunden (Art. 18) fehlen in der Schnellsuche
        orderBy: { issueDate: "desc" },
        take: limit,
        select: { id: true, number: true, partyName: true },
      });
      return rows.map((i) => ({ id: i.id, title: i.number, subtitle: i.partyName, href: `/invoices/${i.id}` }));
    },
  },
];
