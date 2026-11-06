import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("workshop.customers", [
  { path: "/customers", kind: "list", permission: "customers.view", key: true },
  { path: "/customers/new", kind: "new", permission: "customers.edit" },
  { path: "/customers/[id]", kind: "detail", permission: "customers.view", params: { id: { table: "Customer" } }, key: true },
  { path: "/customers/[id]/edit", kind: "edit", permission: "customers.edit", params: { id: { table: "Customer" } } },
]);
