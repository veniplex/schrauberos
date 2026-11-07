import "server-only";
import type { SearchProviderDef } from "@/modules/types";
import { searchChecklists } from "./queries";

/** Schnellsuche: Checklisten nach Vorlage, Kennzeichen und Auftragsnummer – nur, was die Person nach den Rechten für Fahrzeug bzw. Auftrag sehen darf. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "checklists",
    feature: "workshop.checklists",
    permission: "checklists.view",
    groupKey: "checklists.search.group",
    order: 26,
    async search(q, { session, limit }) {
      const rows = await searchChecklists(session, q, limit);
      return rows.map((c) => ({ id: c.id, title: `${c.templateName} · ${c.plate}`, subtitle: c.orderNumber ?? c.vehicleName ?? undefined, href: `/checklists/${c.id}` }));
    },
  },
];
