import { defineFeature } from "@/modules/define";

export const manualFeature = defineFeature({
  id: "manual",
  module: "handbook",
  nameKey: "docs.areas.handbook.title",
  descriptionKey: "docs.areas.handbook.description",
  order: 70,
  docsArea: "handbook",
  permissions: { group: "handbook", keys: ["handbook.view", "handbook.edit"] },
  nav: [{ id: "handbook", href: "/docs/handbook", labelKey: "nav.handbook", icon: "handbook", permission: "handbook.view", order: 70 }],
  quickActions: [{ id: "handbook.new", labelKey: "docs.quick.handbookNew", href: "/docs/handbook/new", icon: "handbook", permission: "handbook.edit", order: 80 }],
  routes: [],
});
