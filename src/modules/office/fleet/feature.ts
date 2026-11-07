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
  quickActions: [{ id: "fleet.new", labelKey: "fleet.quick.new", href: "/fleet/new", icon: "fleet", permission: "fleet.edit", order: 60 }],
  routes: ["fleet"],
  auditActions: [
    "fleet.create",
    "fleet.update",
    "fleet.delete",
    "fleet.mileageAdd",
    "fleet.mileageDelete",
    "fleet.costAdd",
    "fleet.costDelete",
    "fleet.licenseCheck",
    "fleet.licenseCheckDelete",
  ],
});
