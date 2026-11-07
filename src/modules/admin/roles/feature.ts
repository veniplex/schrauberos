import { defineFeature } from "@/modules/define";

export const rolesFeature = defineFeature({
  id: "roles",
  module: "admin",
  nameKey: "roles.feature.name",
  descriptionKey: "roles.feature.description",
  order: 110,
  required: true,
  permissions: { group: "roles", keys: ["roles.manage"], adminOnly: ["roles.manage"] },
  nav: [
    { id: "roles", href: "/admin/roles", labelKey: "nav.roles", icon: "roles", permission: "roles.manage", order: 110 },
  ],
  routes: ["admin/roles"],
  auditActions: ["role.create", "role.update", "role.delete"],
});
