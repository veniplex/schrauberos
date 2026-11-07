import { defineFeature } from "@/modules/define";

export const employeesFeature = defineFeature({
  id: "employees",
  module: "office",
  nameKey: "employees.feature.name",
  descriptionKey: "employees.feature.description",
  order: 40,
  permissions: { group: "employees", keys: ["employees.view", "employees.edit", "employees.delete", "employees.sensitive"] },
  nav: [
    { id: "employees", href: "/employees", labelKey: "nav.employees", icon: "employees", permission: "employees.view", order: 40 },
    { id: "absences", href: "/employees/absences", labelKey: "nav.absences", icon: "absences", permission: "employees.view", order: 41 },
  ],
  quickActions: [{ id: "employees.new", labelKey: "employees.quick.new", href: "/employees/new", icon: "employees", permission: "employees.edit", order: 50 }],
  routes: ["employees"],
  auditActions: [
    "employee.create",
    "employee.update",
    "employee.sensitiveUpdate",
    "employee.delete",
    "employee.absenceCreate",
    "employee.absenceDelete",
    "employee.qualificationCreate",
    "employee.qualificationDelete",
  ],
});
