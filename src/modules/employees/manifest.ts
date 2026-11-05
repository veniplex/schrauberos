import type { ModuleManifest } from "../types";
import { EmployeesWidget } from "./widgets";

/** Büro: Mitarbeiter, Abwesenheiten, Qualifikationen. */
export const employeesModule: ModuleManifest = {
  id: "employees",
  nav: [
    { id: "employees", href: "/employees", labelKey: "nav.employees", icon: "employees", permission: "employees.view", section: "office", order: 40 },
    { id: "absences", href: "/employees/absences", labelKey: "nav.absences", icon: "absences", permission: "employees.view", section: "office", order: 41 },
  ],
  widgets: [{ id: "employees-overview", permission: "employees.view", area: "office", span: 1, order: 40, Component: EmployeesWidget }],
};
