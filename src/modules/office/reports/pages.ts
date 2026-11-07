import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): die Übersicht und die fünf Berichte. */
export const pages = definePages("office.reports", [
  { path: "/reports", kind: "list", permission: "reports.view", key: true },
  { path: "/reports/revenue", kind: "other", permission: "reports.view", key: true },
  { path: "/reports/open-items", kind: "other", permission: "reports.view" },
  { path: "/reports/utilization", kind: "other", permission: "reports.view" },
  { path: "/reports/storage", kind: "other", permission: "reports.view" },
  { path: "/reports/due", kind: "other", permission: "reports.view" },
]);
