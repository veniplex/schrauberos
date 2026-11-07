import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“). */
export const pages = definePages("workshop.checklists", [
  { path: "/checklists", kind: "list", permission: "checklists.view", key: true },
  { path: "/checklists/new", kind: "new", permission: "checklists.fill" },
  { path: "/checklists/[id]", kind: "detail", permission: "checklists.view", params: { id: { table: "Checklist" } }, key: true },
  { path: "/checklists/templates", kind: "list", permission: "checklists.manage" },
  { path: "/checklists/templates/new", kind: "new", permission: "checklists.manage" },
  { path: "/checklists/templates/[id]", kind: "edit", permission: "checklists.manage", params: { id: { table: "ChecklistTemplate" } } },
]);
