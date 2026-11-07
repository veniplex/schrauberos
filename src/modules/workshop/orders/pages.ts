import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("workshop.orders", [
  { path: "/orders", kind: "list", permission: "orders.view", key: true },
  { path: "/orders/new", kind: "new", permission: "orders.create" },
  { path: "/orders/[id]", kind: "detail", permission: "orders.view", params: { id: { table: "Order" } }, key: true },
  { path: "/orders/[id]/edit", kind: "edit", permission: "orders.edit", params: { id: { table: "Order" } } },
]);
