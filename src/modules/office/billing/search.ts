import "server-only";
import { db } from "@/server/db";
import type { SearchProviderDef } from "@/modules/types";
import { docTitle } from "./domain";
import { billingTextWhere } from "./queries";

/** Schnellsuche: Belege der Rechnungserstellung nach Nummer, Empfänger, Fahrzeug und Referenz (Entwürfe und Angebote eingeschlossen; Rechnungen findet auch die Suche des Archivs). Kunden mit eingeschränkter Verarbeitung (Art. 18) erscheinen nicht. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "billing",
    feature: "office.billing",
    permission: "billing.view",
    groupKey: "billing.search.group",
    order: 41,
    async search(q, { limit }) {
      const rows = await db.invoice.findMany({
        where: { AND: [{ source: "billing" }, { OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] }, { OR: billingTextWhere(q) }] },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, number: true, partyName: true, docType: true, finalizedAt: true },
      });
      // Belegart in den Treffer (ein Entwurf hat noch keine Nummer)
      return rows.map((r) => ({ id: r.id, title: r.number || `${docTitle(r.docType)} (Entwurf)`, subtitle: `${docTitle(r.docType)} · ${r.partyName}`, href: `/billing/${r.id}` }));
    },
  },
];
