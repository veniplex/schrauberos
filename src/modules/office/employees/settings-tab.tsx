import type { SettingsTabDef } from "@/modules/types";
import { getEmployeeRules } from "./settings";
import { EmployeeSettingsForm } from "./settings-form";

async function EmployeesSettingsTab() {
  return <EmployeeSettingsForm initial={await getEmployeeRules()} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "employees", feature: "office.employees", labelKey: "employees.settings.tab", permission: "settings.manage", order: 35, Component: EmployeesSettingsTab },
];
