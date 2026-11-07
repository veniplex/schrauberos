import "server-only";
import type { SearchProviderDef } from "@/modules/types";
import { listArticles } from "./queries";

/** Schnellsuche: Artikel nach Nummer, Bezeichnung und Lieferant (normalisierte Suchspalte, Wörter in beliebiger Reihenfolge). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "parts",
    feature: "workshop.parts",
    permission: "parts.view",
    groupKey: "parts.search.group",
    order: 25,
    async search(q, { session, limit }) {
      const { rows } = await listArticles(session, { q, archived: "active" }, { skip: 0, take: limit, orderBy: [{ number: "asc" }] });
      return rows.map((a) => ({ id: a.id, title: `${a.number} · ${a.name}`, subtitle: a.supplier ?? undefined, href: `/parts/${a.id}` }));
    },
  },
];
