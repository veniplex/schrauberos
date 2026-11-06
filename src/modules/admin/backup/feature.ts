import { defineFeature } from "@/modules/define";

export const backupFeature = defineFeature({
  id: "backup",
  module: "admin",
  nameKey: "backup.feature.name",
  descriptionKey: "backup.feature.description",
  required: true,
  order: 137,
  permissions: { group: "backup", keys: ["backup.manage"] },
  nav: [
    { id: "backup", href: "/admin/backup", labelKey: "nav.backup", icon: "backup", permission: "backup.manage", order: 137 },
  ],
  routes: ["admin/backup", "api/backups"],
});
