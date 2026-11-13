import { defineFeature } from "@/modules/define";

export const manualFeature = defineFeature({
  id: "manual",
  module: "handbook",
  nameKey: "docs.areas.handbook.title",
  descriptionKey: "docs.areas.handbook.description",
  order: 70,
  docsArea: "handbook",
  permissions: { group: "manual", keys: ["manual.view", "manual.edit"] },
  nav: [{ id: "handbook", href: "/docs/handbook", labelKey: "nav.handbook", icon: "handbook", permission: "manual.view", order: 70 }],
  quickActions: [{ id: "handbook.new", labelKey: "docs.quick.handbookNew", href: "/docs/handbook/new", icon: "handbook", permission: "manual.edit", order: 80 }],
  routes: [],
});
