import { defineFeature } from "@/modules/define";

export const vehiclesFeature = defineFeature({
  id: "vehicles",
  module: "workshop",
  nameKey: "vehicles.feature.name",
  descriptionKey: "vehicles.feature.description",
  order: 31,
  uses: ["workshop.customers", "workshop.tires", "workshop.appointments"],
  permissions: { group: "vehicles", keys: ["vehicles.view", "vehicles.edit", "vehicles.delete"] },
  nav: [
    { id: "vehicles", href: "/vehicles", labelKey: "nav.vehicles", icon: "vehicles", permission: "vehicles.view", order: 31 },
  ],
  quickActions: [{ id: "vehicles.new", labelKey: "vehicles.quick.new", href: "/vehicles/new", icon: "vehicles", permission: "vehicles.edit", order: 31 }],
  routes: ["vehicles"],
});
