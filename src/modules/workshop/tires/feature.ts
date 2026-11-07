import { defineFeature } from "@/modules/define";

export const tiresFeature = defineFeature({
  id: "tires",
  module: "workshop",
  nameKey: "tires.feature.name",
  descriptionKey: "tires.feature.description",
  order: 20,
  requires: ["workshop.vehicles"],
  uses: ["workshop.appointments", "workshop.customers"],
  permissions: { group: "tires", keys: ["tires.view", "tires.create", "tires.edit", "tires.stock", "tires.delete", "tires.export", "tires.import"], marked: { export: ["tires.export"], import: ["tires.import"] } },
  nav: [
    { id: "tires", href: "/tires", labelKey: "nav.tires", icon: "tires", permission: "tires.view", order: 20 },
  ],
  quickActions: [{ id: "tires.new", labelKey: "tires.quick.new", href: "/tires/new", icon: "tires", permission: "tires.create", order: 20 },
    { id: "tires.stock", kind: "open", labelKey: "tires.quick.stock", href: "/tires", icon: "tires", permission: "tires.stock", order: 201 },
  ],
  routes: ["tires"],
  auditActions: ["tires.create", "tires.update", "tires.stock", "tires.dispose", "tires.delete", "tires.export", "tires.import", "settings.tires"],
});
