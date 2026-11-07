import "server-only";
import { db } from "@/server/db";
import { employeeName } from "./domain";

/**
 * Aktive Mitarbeiter mit aktivem Benutzerkonto – für Zuordnungen in anderen Funktionen (z. B. „Zuständig“ im Termin): `id` ist die Benutzer-ID (das ist, worauf die
 * Zuordnung zeigt), `name` der Mitarbeitername. So erscheinen in der Auswahl die Menschen der Werkstatt und nicht jedes technische Konto.
 */
export async function staffWithAccount(): Promise<Array<{ id: string; name: string }>> {
  const rows = await db.employee.findMany({
    where: { active: true, userId: { not: null }, user: { is: { active: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { firstName: true, lastName: true, userId: true },
  });
  return rows.flatMap((row) => (row.userId ? [{ id: row.userId, name: employeeName(row) }] : []));
}
