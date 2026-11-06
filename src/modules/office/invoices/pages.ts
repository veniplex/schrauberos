import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("office.invoices", [
  { path: "/invoices", kind: "list", permission: "invoices.view", key: true },
  { path: "/invoices/new", kind: "new", permission: "invoices.edit" },
  { path: "/invoices/[id]", kind: "detail", permission: "invoices.view", params: { id: { table: "Invoice" } } },
  { path: "/invoices/[id]/edit", kind: "edit", permission: "invoices.edit", params: { id: { table: "Invoice" } } },
]);
