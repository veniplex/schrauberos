import "server-only";
import type { SearchProviderDef } from "@/modules/types";
import { searchEntries } from "./queries";

/** Schnellsuche: Zeiteinträge nach Tätigkeit und Notiz (eigene; mit `time.viewAll` alle). Der Treffer führt zum Eintrag mit Korrekturverlauf. */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "time",
    feature: "office.time",
    permission: "time.view",
    groupKey: "time.search.group",
    order: 45,
    async search(q, { session, limit }) {
      const rows = await searchEntries(session, q, limit);
      return rows.map((e) => ({
        id: e.id,
        title: e.activity ?? e.note ?? "–",
        subtitle: [e.orderNumber, e.employeeName].filter(Boolean).join(" · ") || undefined,
        href: `/time/entries/${e.id}`,
      }));
    },
  },
];
