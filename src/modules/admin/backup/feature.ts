import { defineFeature } from "@/modules/define";

export const backupFeature = defineFeature({
  id: "backup",
  module: "admin",
  nameKey: "backup.feature.name",
  descriptionKey: "backup.feature.description",
  required: true,
  order: 137,
  permissions: { group: "backup", keys: ["backup.manage", "backup.keys"], adminOnly: ["backup.manage", "backup.keys"] },
  nav: [
    { id: "backup", href: "/admin/backup", labelKey: "nav.backup", icon: "backup", permission: "backup.manage", order: 135 },
  ],
  routes: ["admin/backup", "api/backups"],
  auditActions: [
    "backup.create",
    "backup.delete",
    "backup.download",
    "backup.restore",
    "backup.upload",
    "backup.createFailed",
    "backup.runNow",
    "backup.restoreFailed",
    "backup.uploadFailed",
    "backup.offsiteSettings",
    "backup.offsiteFailed",
    "backup.offsiteFetch",
    "settings.backupPlan",
  ],
});
