import { defineFeature } from "@/modules/define";

export const updatesFeature = defineFeature({
  id: "updates",
  module: "admin",
  nameKey: "updates.feature.name",
  descriptionKey: "updates.feature.description",
  required: true,
  order: 136,
  permissions: { group: "updates", keys: ["updates.manage"], adminOnly: ["updates.manage"] },
  nav: [
    { id: "updates", href: "/admin/updates", labelKey: "nav.updates", icon: "updates", permission: "updates.manage", order: 136 },
  ],
  routes: ["admin/updates", "api/updates"],
});
