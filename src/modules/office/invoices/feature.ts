import { defineFeature } from "@/modules/define";

export const invoicesFeature = defineFeature({
  id: "invoices",
  module: "office",
  nameKey: "invoices.feature.name",
  descriptionKey: "invoices.feature.description",
  order: 30,
  uses: ["workshop.customers"],
  permissions: { group: "invoices", keys: ["invoices.view", "invoices.edit", "invoices.delete", "invoices.finalize", "invoices.export", "invoices.import"], marked: { sensitive: ["invoices.finalize"], export: ["invoices.export"], import: ["invoices.import"] } },
  nav: [
    { id: "invoices", href: "/invoices", labelKey: "nav.invoices", icon: "invoices", permission: "invoices.view", order: 30 },
  ],
  quickActions: [{ id: "invoices.new", labelKey: "invoices.quick.new", href: "/invoices/new", icon: "invoices", permission: "invoices.edit", order: 40 }],
  routes: ["invoices", "api/invoices"],
  auditActions: [
    "invoice.create",
    "invoice.update",
    "invoice.pay",
    "invoice.reopen",
    "invoice.finalize",
    "invoice.cancel",
    "invoice.delete",
    "invoice.export",
    "invoice.import",
    "invoice.accountantExport",
  ],
});
