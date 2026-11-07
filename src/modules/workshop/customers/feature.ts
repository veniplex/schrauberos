import { defineFeature } from "@/modules/define";

export const customersFeature = defineFeature({
  id: "customers",
  module: "workshop",
  nameKey: "customers.feature.name",
  descriptionKey: "customers.feature.description",
  order: 30,
  uses: ["workshop.vehicles", "workshop.tires", "workshop.appointments"],
  permissions: { group: "customers", keys: ["customers.view", "customers.edit", "customers.delete", "customers.export", "customers.import"], marked: { export: ["customers.export"], import: ["customers.import"] } },
  nav: [
    { id: "customers", href: "/customers", labelKey: "nav.customers", icon: "customers", permission: "customers.view", order: 30 },
  ],
  quickActions: [{ id: "customers.new", labelKey: "customers.quick.new", href: "/customers/new", icon: "customers", permission: "customers.edit", order: 30 }],
  routes: ["customers", "api/customers"],
  auditActions: ["customer.create", "customer.update", "customer.archive", "customer.unarchive", "customer.delete", "customer.export", "customer.import"],
});
