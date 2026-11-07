import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("office.billing", [
  { path: "/billing", kind: "list", permission: "billing.view", key: true },
  { path: "/billing/new", kind: "new", permission: "billing.edit", query: "?type=offer" },
  { path: "/billing/[id]", kind: "detail", permission: "billing.view", params: { id: { table: "Invoice", where: "source = 'billing' AND finalizedAt IS NOT NULL AND docType = 'invoice'" } }, key: true },
  { path: "/billing/[id]/edit", kind: "edit", permission: "billing.edit", params: { id: { table: "Invoice", where: "source = 'billing' AND finalizedAt IS NULL" } } },
]);
