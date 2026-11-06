import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("handbook.manual", [
  { path: "/docs/[area]", kind: "list", permission: "handbook.view", params: { area: { value: "handbook" } } },
  { path: "/docs/[area]/new", kind: "new", permission: "handbook.edit", params: { area: { value: "handbook" } } },
  { path: "/docs/[area]/[slug]", kind: "detail", permission: "handbook.view", params: { area: { value: "handbook" }, slug: { table: "DocPage", column: "slug", where: "area = 'handbook'" } }, key: true },
  { path: "/docs/[area]/[slug]/edit", kind: "edit", permission: "handbook.edit", params: { area: { value: "handbook" }, slug: { table: "DocPage", column: "slug", where: "area = 'handbook'" } } },
  { path: "/docs/[area]/[slug]/history", kind: "other", permission: "handbook.view", params: { area: { value: "handbook" }, slug: { table: "DocPage", column: "slug", where: "area = 'handbook'" } } },
]);
