import { defineFeature } from "@/modules/define";

export const auditFeature = defineFeature({
  id: "audit",
  module: "admin",
  nameKey: "audit.feature.name",
  descriptionKey: "audit.feature.description",
  required: true,
  order: 135,
  permissions: { group: "audit", keys: ["audit.view"] },
  nav: [
    { id: "audit", href: "/admin/audit", labelKey: "nav.audit", icon: "audit", permission: "audit.view", order: 135 },
  ],
  routes: ["admin/audit"],
});
