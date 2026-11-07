import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“). */
export const pages = definePages("office.time", [
  { path: "/time", kind: "list", permission: "time.view", key: true },
  { path: "/time/entries", kind: "list", permission: "time.view" },
  { path: "/time/entries/new", kind: "new", permission: "time.correct" },
  { path: "/time/entries/[id]", kind: "detail", permission: "time.view", params: { id: { table: "TimeEntry" } }, key: true },
  { path: "/time/team", kind: "list", permission: "time.viewAll" },
]);
