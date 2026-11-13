import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("it.docs", [
  { path: "/docs/[area]", kind: "list", permission: "docs.view", params: { area: { value: "it" } } },
  { path: "/docs/[area]/new", kind: "new", permission: "docs.edit", params: { area: { value: "it" } } },
  { path: "/docs/[area]/[slug]", kind: "detail", permission: "docs.view", params: { area: { value: "it" }, slug: { table: "DocPage", column: "slug", where: "area = 'it'" } } },
  { path: "/docs/[area]/[slug]/edit", kind: "edit", permission: "docs.edit", params: { area: { value: "it" }, slug: { table: "DocPage", column: "slug", where: "area = 'it'" } } },
  { path: "/docs/vault", kind: "list", permission: "docs.vault" },
  { path: "/docs/vault/new", kind: "new", permission: "docs.vaultManage" },
  { path: "/docs/vault/[id]", kind: "detail", permission: "docs.vault", params: { id: { table: "VaultEntry" } } },
  { path: "/docs/vault/[id]/edit", kind: "edit", permission: "docs.vaultManage", params: { id: { table: "VaultEntry" } } },
  { path: "/docs/[area]/[slug]/history", kind: "other", permission: "docs.view", params: { area: { value: "it" }, slug: { table: "DocPage", column: "slug", where: "area = 'it'" } } },
]);
