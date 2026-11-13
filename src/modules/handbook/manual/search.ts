import "server-only";
import { searchDocPages } from "@/capabilities/docs/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche im Handbuch (Seiten, die die Person lesen darf). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "handbook",
    feature: "handbook.manual",
    permission: "manual.view",
    groupKey: "docs.areas.handbook.title",
    order: 80,
    search: (q, { session, limit }) => searchDocPages(session, "handbook", q, limit),
  },
];
