import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("admin.users", [
  { path: "/admin/users", kind: "list", permission: "users.view" },
  { path: "/admin/users/new", kind: "new", permission: "users.manage" },
  { path: "/admin/users/[id]", kind: "edit", permission: "users.manage", params: { id: { table: "User" } } },
]);
