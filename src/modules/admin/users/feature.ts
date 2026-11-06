import { defineFeature } from "@/modules/define";

export const usersFeature = defineFeature({
  id: "users",
  module: "admin",
  nameKey: "users.feature.name",
  descriptionKey: "users.feature.description",
  order: 100,
  required: true,
  permissions: { group: "users", keys: ["users.view", "users.manage"], adminOnly: ["users.manage"] },
  nav: [
    { id: "users", href: "/admin/users", labelKey: "nav.users", icon: "users", permission: "users.view", order: 100 },
  ],
  routes: ["admin/users"],
});
