import { defineFeature } from "@/modules/define";

export const vehiclesFeature = defineFeature({
  id: "vehicles",
  module: "workshop",
  nameKey: "vehicles.feature.name",
  descriptionKey: "vehicles.feature.description",
  order: 31,
  uses: ["workshop.customers", "workshop.tires", "workshop.appointments"],
  permissions: { group: "vehicles", keys: ["vehicles.view", "vehicles.edit", "vehicles.delete", "vehicles.export", "vehicles.import"], marked: { export: ["vehicles.export"], import: ["vehicles.import"] } },
  nav: [
    { id: "vehicles", href: "/vehicles", labelKey: "nav.vehicles", icon: "vehicles", permission: "vehicles.view", order: 31 },
  ],
  quickActions: [{ id: "vehicles.new", labelKey: "vehicles.quick.new", href: "/vehicles/new", icon: "vehicles", permission: "vehicles.edit", order: 31 },
    { id: "vehicles.list", kind: "open", labelKey: "vehicles.quick.list", href: "/vehicles", icon: "vehicles", permission: "vehicles.view", order: 202 },
  ],
  routes: ["vehicles", "api/vehicles"],
  auditActions: ["vehicle.create", "vehicle.update", "vehicle.archive", "vehicle.unarchive", "vehicle.delete", "vehicle.transfer", "vehicle.export", "vehicle.import"],
});
