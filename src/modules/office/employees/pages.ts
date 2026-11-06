import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("office.employees", [
  { path: "/employees", kind: "list", permission: "employees.view" },
  { path: "/employees/new", kind: "new", permission: "employees.edit" },
  { path: "/employees/[id]", kind: "detail", permission: "employees.view", params: { id: { table: "Employee" } } },
  { path: "/employees/[id]/edit", kind: "edit", permission: "employees.edit", params: { id: { table: "Employee" } } },
  { path: "/employees/absences", kind: "other", permission: "employees.view", key: true },
  { path: "/employees/absences", kind: "modal", permission: "employees.edit", query: "?new=1" },
]);
