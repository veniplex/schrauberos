import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("admin.roles", [
  { path: "/admin/roles", kind: "list", permission: "roles.manage" },
  { path: "/admin/roles/new", kind: "new", permission: "roles.manage" },
  { path: "/admin/roles/[id]", kind: "edit", permission: "roles.manage", params: { id: { table: "Role", where: "key = 'advisor'" } } },
]);
