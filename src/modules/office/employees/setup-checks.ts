import "server-only";
import type { SetupCheckDef } from "@/modules/types";
import { countEmployees } from "./queries";

/** Einrichtungsschritt der Mitarbeiter: der erste Mitarbeiter ist angelegt. */
export const setupChecks: SetupCheckDef[] = [
  {
    id: "firstEmployee",
    feature: "office.employees",
    permission: "employees.edit",
    labelKey: "employees.checklist.first.label",
    hintKey: "employees.checklist.first.hint",
    href: "/employees/new",
    order: 41,
    done: async ({ session }) => (await countEmployees(session, {})) > 0,
  },
];
