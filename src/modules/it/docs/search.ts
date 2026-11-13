import "server-only";
import { searchDocPages } from "@/capabilities/docs/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche in der IT-Dokumentation (Seiten, die die Person lesen darf). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "it-docs",
    feature: "it.docs",
    permission: "docs.view",
    groupKey: "docs.areas.it.title",
    order: 81,
    search: (q, { session, limit }) => searchDocPages(session, "it", q, limit),
  },
];
