import { defineFeature } from "@/modules/define";

export const modulesFeature = defineFeature({
  id: "modules",
  module: "admin",
  nameKey: "modules.feature.name",
  descriptionKey: "modules.feature.description",
  order: 130,
  required: true,
  permissions: { group: "modules", keys: ["modules.manage"], adminOnly: ["modules.manage"] },
  nav: [
    { id: "modules", href: "/admin/modules", labelKey: "nav.modules", icon: "modules", permission: "modules.manage", order: 130 },
  ],
  routes: ["admin/modules"],
});
