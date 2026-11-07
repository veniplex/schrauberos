import { defineFeature } from "@/modules/define";

export const itDocsFeature = defineFeature({
  id: "docs",
  module: "it",
  nameKey: "docs.areas.it.title",
  descriptionKey: "docs.areas.it.description",
  order: 64,
  docsArea: "it",
  permissions: { group: "docsIt", keys: ["docsIt.view", "docsIt.edit"] },
  nav: [{ id: "docs-it", href: "/docs/it", labelKey: "nav.docsIt", icon: "docs", permission: "docsIt.view", order: 64 }],
  quickActions: [{ id: "docsIt.new", labelKey: "docs.quick.itNew", href: "/docs/it/new", icon: "docs", permission: "docsIt.edit", order: 81 }],
  routes: [],
});
