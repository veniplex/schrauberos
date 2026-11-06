import { defineFeature } from "@/modules/define";

export const appointmentsFeature = defineFeature({
  id: "appointments",
  module: "workshop",
  nameKey: "appointments.feature.name",
  descriptionKey: "appointments.feature.description",
  order: 10,
  requires: ["workshop.vehicles"],
  uses: ["workshop.tires", "workshop.customers"],
  permissions: { group: "appointments", keys: ["appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "appointments.configure"] },
  nav: [
    { id: "appointments", href: "/appointments", labelKey: "nav.appointments", icon: "calendar", permission: "appointments.view", order: 10 },
  ],
  routes: ["appointments"],
});
