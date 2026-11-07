import { defineFeature } from "@/modules/define";

export const settingsFeature = defineFeature({
  id: "settings",
  module: "admin",
  nameKey: "settings.feature.name",
  descriptionKey: "settings.feature.description",
  order: 120,
  required: true,
  permissions: { group: "settings", keys: ["settings.manage"], adminOnly: ["settings.manage"] },
  nav: [
    { id: "settings", href: "/settings", labelKey: "nav.settings", icon: "settings", permission: "settings.manage", order: 120 },
  ],
  routes: ["settings"],
  auditActions: ["settings.workshop", "settings.security", "settings.csp", "settings.holidays", "settings.publicUrl"],
});
