import "server-only";
import type { SearchProviderDef } from "@/modules/types";
import { searchEmployees } from "./queries";

/** Schnellsuche: aktive Mitarbeiter (wie die Standardansicht der Liste) nach Name, Personalnummer, Funktion und E-Mail – nie sensible Daten (Notfallkontakt, Krankheit). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "employees",
    feature: "office.employees",
    permission: "employees.view",
    groupKey: "employees.search.group",
    order: 50,
    async search(q, { session, limit }) {
      const rows = await searchEmployees(session, q, limit);
      return rows.map((e) => ({ id: e.id, title: e.name, subtitle: e.jobTitle ?? undefined, href: `/employees/${e.id}` }));
    },
  },
];
