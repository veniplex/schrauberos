import "server-only";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";
import { employeeName } from "./domain";

/** Schnellsuche: aktive Mitarbeiter (wie die Standardansicht der Liste) nach Name, Personalnummer, Funktion und E-Mail – nie sensible Daten (Notfallkontakt, Krankheit). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "employees",
    feature: "office.employees",
    permission: "employees.view",
    groupKey: "employees.search.group",
    order: 50,
    async search(q, { limit }) {
      const rows = await db.employee.findMany({
        where: { active: true, OR: [{ firstName: contains(q) }, { lastName: contains(q) }, { personnelNumber: contains(q) }, { jobTitle: contains(q) }, { email: contains(q) }] },
        orderBy: { lastName: "asc" },
        take: limit,
        select: { id: true, firstName: true, lastName: true, jobTitle: true },
      });
      return rows.map((e) => ({ id: e.id, title: employeeName(e), subtitle: e.jobTitle ?? undefined, href: `/employees/${e.id}` }));
    },
  },
];
