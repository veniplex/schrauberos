import { defineFeature } from "@/modules/define";

export const invoicesFeature = defineFeature({
  id: "invoices",
  module: "office",
  nameKey: "invoices.feature.name",
  descriptionKey: "invoices.feature.description",
  order: 30,
  uses: ["workshop.customers"],
  permissions: { group: "invoices", keys: ["invoices.view", "invoices.edit", "invoices.delete"] },
  nav: [
    { id: "invoices", href: "/invoices", labelKey: "nav.invoices", icon: "invoices", permission: "invoices.view", order: 30 },
  ],
  routes: ["invoices"],
});
