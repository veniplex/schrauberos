import { defineFeature } from "@/modules/define";

export const officeDocsFeature = defineFeature({
  id: "docs",
  module: "office",
  nameKey: "docs.areas.office.title",
  descriptionKey: "docs.areas.office.description",
  order: 60,
  docsArea: "office",
  permissions: { group: "docsOffice", keys: ["docsOffice.view", "docsOffice.edit"] },
  nav: [
    { id: "docs-office", href: "/docs/office", labelKey: "nav.docs", icon: "docs", permission: "docsOffice.view", order: 60 },
  ],
  routes: [],
});
