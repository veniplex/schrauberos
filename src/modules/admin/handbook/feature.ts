import { defineFeature } from "@/modules/define";

export const handbookFeature = defineFeature({
  id: "handbook",
  module: "admin",
  nameKey: "handbook.feature.name",
  descriptionKey: "handbook.feature.description",
  order: 140,
  permissions: { group: "handbook", keys: ["handbook.view"] },
  nav: [
    { id: "handbook", href: "/admin/handbook", labelKey: "nav.handbook", icon: "docs", permission: "handbook.view", order: 140 },
  ],
  routes: ["admin/handbook"],
});
