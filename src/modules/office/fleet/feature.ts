import { defineFeature } from "@/modules/define";

export const fleetFeature = defineFeature({
  id: "fleet",
  module: "office",
  nameKey: "fleet.feature.name",
  descriptionKey: "fleet.feature.description",
  order: 50,
  requires: ["office.employees"],
  permissions: { group: "fleet", keys: ["fleet.view", "fleet.edit", "fleet.delete"] },
  nav: [
    { id: "fleet", href: "/fleet", labelKey: "nav.fleet", icon: "fleet", permission: "fleet.view", order: 50 },
  ],
  routes: ["fleet"],
});
