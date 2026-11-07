import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("admin.backup", [
  { path: "/admin/backup", kind: "other", permission: "backup.manage" },
  { path: "/admin/backup/offsite", kind: "other", permission: "backup.manage" },
  { path: "/admin/backup/key", kind: "other", permission: "backup.keys" },
]);
