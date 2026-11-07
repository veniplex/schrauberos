import { defineFeature } from "@/modules/define";

export const appointmentsFeature = defineFeature({
  id: "appointments",
  module: "workshop",
  nameKey: "appointments.feature.name",
  descriptionKey: "appointments.feature.description",
  order: 10,
  requires: ["workshop.vehicles"],
  uses: ["workshop.tires", "workshop.customers", "office.employees"],
  permissions: { group: "appointments", keys: ["appointments.view", "appointments.create", "appointments.edit", "appointments.delete", "appointments.configure"] },
  nav: [
    { id: "appointments", href: "/appointments", labelKey: "nav.appointments", icon: "calendar", permission: "appointments.view", order: 10 },
  ],
  quickActions: [{ id: "appointments.new", labelKey: "appointments.quick.new", href: "/appointments?new=1", icon: "calendar", permission: "appointments.create", order: 10 }],
  routes: ["appointments"],
  auditActions: ["appointment.create", "appointment.update", "appointment.status", "appointment.delete", "settings.appointments"],
});
