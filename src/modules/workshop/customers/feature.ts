import { defineFeature } from "@/modules/define";

export const customersFeature = defineFeature({
  id: "customers",
  module: "workshop",
  nameKey: "customers.feature.name",
  descriptionKey: "customers.feature.description",
  order: 30,
  uses: ["workshop.vehicles", "workshop.tires", "workshop.appointments"],
  permissions: { group: "customers", keys: ["customers.view", "customers.edit", "customers.delete"] },
  nav: [
    { id: "customers", href: "/customers", labelKey: "nav.customers", icon: "customers", permission: "customers.view", order: 30 },
  ],
  routes: ["customers"],
});
