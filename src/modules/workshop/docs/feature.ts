import { defineFeature } from "@/modules/define";

export const workshopDocsFeature = defineFeature({
  id: "docs",
  module: "workshop",
  nameKey: "docs.areas.workshop.title",
  descriptionKey: "docs.areas.workshop.description",
  order: 40,
  docsArea: "workshop",
  permissions: { group: "docsWorkshop", keys: ["docsWorkshop.view", "docsWorkshop.edit"] },
  nav: [
    { id: "docs-workshop", href: "/docs/workshop", labelKey: "nav.docs", icon: "docs", permission: "docsWorkshop.view", order: 40 },
  ],
  routes: [],
});
