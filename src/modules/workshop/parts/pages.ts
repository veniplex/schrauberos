import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("workshop.parts", [
  { path: "/parts", kind: "list", permission: "parts.view", key: true },
  { path: "/parts/new", kind: "new", permission: "parts.edit" },
  { path: "/parts/receipt", kind: "other", permission: "parts.stock" },
  { path: "/parts/count", kind: "other", permission: "parts.stock" },
  { path: "/parts/[id]", kind: "detail", permission: "parts.view", params: { id: { table: "Article" } }, key: true },
  { path: "/parts/[id]/edit", kind: "edit", permission: "parts.edit", params: { id: { table: "Article" } } },
]);
