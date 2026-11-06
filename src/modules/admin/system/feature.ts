import { defineFeature } from "@/modules/define";

export const systemFeature = defineFeature({
  id: "system",
  module: "admin",
  nameKey: "system.feature.name",
  descriptionKey: "system.feature.description",
  required: true,
  order: 138,
  permissions: { group: "system", keys: ["system.view"], adminOnly: ["system.view"] },
  nav: [{ id: "system", href: "/admin/system", labelKey: "nav.system", icon: "system", permission: "system.view", order: 138 }],
  routes: ["admin/system"],
});
