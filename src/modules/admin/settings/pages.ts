import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("admin.settings", [
  { path: "/settings", kind: "other", permission: "settings.manage" },
  { path: "/settings", kind: "other", permission: "settings.manage", query: "?tab=security" },
  { path: "/settings", kind: "other", permission: "settings.manage", query: "?tab=holidays" },
]);
