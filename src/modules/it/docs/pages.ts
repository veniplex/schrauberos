import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("it.docs", [
  { path: "/docs/[area]", kind: "list", permission: "docsIt.view", params: { area: { value: "it" } } },
  { path: "/docs/[area]/new", kind: "new", permission: "docsIt.edit", params: { area: { value: "it" } } },
  { path: "/docs/[area]/[slug]", kind: "detail", permission: "docsIt.view", params: { area: { value: "it" }, slug: { table: "DocPage", column: "slug", where: "area = 'it'" } } },
  { path: "/docs/[area]/[slug]/edit", kind: "edit", permission: "docsIt.edit", params: { area: { value: "it" }, slug: { table: "DocPage", column: "slug", where: "area = 'it'" } } },
  { path: "/docs/[area]/[slug]/history", kind: "other", permission: "docsIt.view", params: { area: { value: "it" }, slug: { table: "DocPage", column: "slug", where: "area = 'it'" } } },
]);
