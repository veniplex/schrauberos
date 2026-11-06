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
  routes: ["employees"],
});
