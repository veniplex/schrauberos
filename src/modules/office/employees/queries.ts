import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/modules/types";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { ABSENCE_TYPES, employeeName, type AbsenceType } from "./domain";

/**
 * Lesezugriffe der Funktion „Mitarbeiter“ – **der einzige Ort**, an dem Seiten, Dashboard-Bausteine und andere Funktionen Mitarbeiterdaten aus der Datenbank holen
 * (Muster siehe README, „Datenzugriff“; erzwungen vom Architekturtest). Jede Abfrage hat ein explizites `select` und bekommt den Betrachter (`viewer`, die Sitzung oder
 * das Prinzipal der Operation): Besonders schützenswerte Daten – Notfallkontakt, Krankheit (Art und Anmerkung) – werden ohne `employees.sensitive` **gar nicht aus der
 * Datenbank gelesen** (nicht erst danach maskiert). `visibleAbsenceType` in der Oberfläche bleibt als zweite Linie.
 * Getestet in `queries.test.ts` (mit protokolliertem SQL: kein sensibles Feld in der Auswahl).
 */

const SENSITIVE = "employees.sensitive" as const;

/** Spalten, die jeder mit `employees.view` sehen darf. */
const BASE = {
  id: true,
  personnelNumber: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  department: true,
  email: true,
  phone: true,
  mobile: true,
  hireDate: true,
  leaveDate: true,
  active: true,
  vacationDaysPerYear: true,
  notes: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.EmployeeSelect;

/** Die Spalten ohne besonders geschützte Daten, auch für die API (`api.ts`): nie Notfallkontakt. */
export const employeeBaseSelect = BASE;

/** Nur mit `employees.sensitive`. */
const EMERGENCY = { emergencyName: true, emergencyPhone: true, emergencyRelation: true } as const satisfies Prisma.EmployeeSelect;

const NAME = { id: true, firstName: true, lastName: true } as const satisfies Prisma.EmployeeSelect;
const EMPLOYEE_NAME = { employee: { select: { firstName: true, lastName: true } } } as const;

export type Emergency = { name: string | null; phone: string | null; relation: string | null };
export type EmployeeName = { id: string; firstName: string; lastName: string };

/** Abwesenheit, wie der Betrachter sie sehen darf: Krankheit ohne `employees.sensitive` ist `masked`, ohne Anmerkung. */
export type AbsenceView = { id: string; employeeId: string; type: AbsenceType | "masked"; startDate: Date; endDate: Date; note: string | null };
export type AbsenceWithEmployee = AbsenceView & { employee: { firstName: string; lastName: string } };

const knownType = (type: string): AbsenceType => ((ABSENCE_TYPES as readonly string[]).includes(type) ? (type as AbsenceType) : "other");

/* ───────────── Mitarbeiter ───────────── */

/** Liste (Standardsicht): Stammdaten und Benutzername; nie Notfallkontakt. */
export async function listEmployees(viewer: Viewer, args: { where: Prisma.EmployeeWhereInput; orderBy: Prisma.EmployeeOrderByWithRelationInput[]; skip?: number; take?: number }) {
  requireView(viewer);
  return db.employee.findMany({ ...args, select: { ...BASE, user: { select: { id: true, username: true } } } });
}

export async function countEmployees(viewer: Viewer, where: Prisma.EmployeeWhereInput): Promise<number> {
  requireView(viewer);
  return db.employee.count({ where });
}

/** Name für den Seitentitel. */
export async function employeeTitle(id: string): Promise<EmployeeName | null> {
  return db.employee.findUnique({ where: { id }, select: NAME });
}

/** Schnellsuche: aktive Mitarbeiter (wie die Standardansicht der Liste) nach Name, Personalnummer, Funktion und E-Mail – nie sensible Daten. */
export async function searchEmployees(viewer: Viewer, q: string, limit: number): Promise<Array<{ id: string; name: string; jobTitle: string | null }>> {
  requireView(viewer);
  const rows = await db.employee.findMany({
    where: { active: true, OR: [{ firstName: contains(q) }, { lastName: contains(q) }, { personnelNumber: contains(q) }, { jobTitle: contains(q) }, { email: contains(q) }] },
    orderBy: { lastName: "asc" },
    take: limit,
    select: { id: true, firstName: true, lastName: true, jobTitle: true },
  });
  return rows.map((e) => ({ id: e.id, name: employeeName(e), jobTitle: e.jobTitle }));
}

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

/** Aktive Mitarbeiter (Auswahllisten, Raster) – nur Name; für andere Funktionen über `public.ts`. */
export async function activeEmployees(): Promise<EmployeeName[]> {
  return db.employee.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: NAME });
}

/** Konten, die einem Mitarbeiter zugeordnet werden können: aktive ohne Mitarbeiter, dazu das bisherige Konto dieses Mitarbeiters (`currentUserId`). */
export async function linkableAccounts(viewer: Viewer, currentUserId?: string | null): Promise<Array<{ id: string; name: string; username: string }>> {
  requireAccess(viewer);
  return db.user.findMany({
    where: { active: true, OR: [{ employee: { is: null } }, ...(currentUserId ? [{ id: currentUserId }] : [])] },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });
}

/** Mitarbeiter zum Bearbeiten: Stammdaten; der Notfallkontakt wird nur mit `employees.sensitive` gelesen (eigene Abfrage), sonst ist `emergency` null. */
export async function getEmployeeForEdit(viewer: Viewer, id: string) {
  requireAccess(viewer);
  const row = await db.employee.findUnique({ where: { id }, select: BASE });
  if (!row) return null;
  let emergency: Emergency | null = null;
  if (viewer.can(SENSITIVE)) {
    const e = await db.employee.findUnique({ where: { id }, select: EMERGENCY });
    emergency = e ? { name: e.emergencyName, phone: e.emergencyPhone, relation: e.emergencyRelation } : null;
  }
  return { ...row, emergency };
}

/** Detailseite: Stammdaten, Konto, Abwesenheiten (die letzten 20), Qualifikationen; Notfallkontakt nur mit `employees.sensitive`. */
export async function getEmployeeDetail(viewer: Viewer, id: string) {
  const base = await getEmployeeForEdit(viewer, id);
  if (!base) return null;
  const [user, absences, qualifications] = await Promise.all([
    base.userId ? db.user.findUnique({ where: { id: base.userId }, select: { id: true, name: true, username: true, active: true } }) : null,
    readAbsences(viewer, { employeeId: id }, { order: "startDesc", take: 20 }),
    db.qualification.findMany({ where: { employeeId: id }, orderBy: [{ expiresAt: "asc" }, { name: "asc" }], select: { id: true, employeeId: true, name: true, issuedAt: true, expiresAt: true, note: true } }),
  ]);
  return { ...base, user, absences: absences.map((a) => ({ id: a.id, employeeId: a.employeeId, type: a.type, startDate: a.startDate, endDate: a.endDate, note: a.note }) satisfies AbsenceView), qualifications };
}

/* ───────────── Abwesenheiten ───────────── */

type AbsenceOrder = "startAsc" | "startDesc" | "endAsc";
const ORDER: Record<AbsenceOrder, Prisma.AbsenceOrderByWithRelationInput> = { startAsc: { startDate: "asc" }, startDesc: { startDate: "desc" }, endAsc: { endDate: "asc" } };
const compare: Record<AbsenceOrder, (a: AbsenceView, b: AbsenceView) => number> = {
  startAsc: (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  startDesc: (a, b) => b.startDate.getTime() - a.startDate.getTime(),
  endAsc: (a, b) => a.endDate.getTime() - b.endDate.getTime(),
};

/**
 * Abwesenheiten, die `where` erfüllen. Mit `employees.sensitive` alle; sonst werden Krankheitszeilen **ohne Art und Anmerkung** gelesen (nur Zeitraum und Mitarbeiter) und
 * als `masked` geliefert – die Spalten `type` und `note` dieser Zeilen verlassen die Datenbank nicht.
 */
async function readAbsences(viewer: Viewer, where: Prisma.AbsenceWhereInput, opts: { order: AbsenceOrder; take?: number }): Promise<AbsenceWithEmployee[]> {
  const orderBy = ORDER[opts.order];
  const sensitive = viewer.can(SENSITIVE);
  const open = await db.absence.findMany({
    where: sensitive ? where : { AND: [where, { type: { not: "sick" } }] },
    orderBy,
    take: opts.take,
    select: { id: true, employeeId: true, type: true, startDate: true, endDate: true, note: true, ...EMPLOYEE_NAME },
  });
  const rows: AbsenceWithEmployee[] = open.map((a) => ({ ...a, type: knownType(a.type) }));
  if (sensitive) return rows;
  const hidden = await db.absence.findMany({
    where: { AND: [where, { type: "sick" }] },
    orderBy,
    take: opts.take,
    select: { id: true, employeeId: true, startDate: true, endDate: true, ...EMPLOYEE_NAME },
  });
  rows.push(...hidden.map((a): AbsenceWithEmployee => ({ ...a, type: "masked", note: null })));
  rows.sort(compare[opts.order]);
  return opts.take != null ? rows.slice(0, opts.take) : rows;
}

/** Abwesenheiten, die einen Zeitraum berühren (Monatsraster, Liste des Monats). */
export async function absencesOverlapping(viewer: Viewer, from: Date, to: Date): Promise<AbsenceWithEmployee[]> {
  requireView(viewer);
  return readAbsences(viewer, { startDate: { lte: to }, endDate: { gte: from } }, { order: "startAsc" });
}

/** Bausteine „heute abwesend“: Abwesenheiten, die von `from` bis `to` (je einschließlich) laufen. */
export async function absencesAround(viewer: Viewer, from: Date, to: Date): Promise<AbsenceWithEmployee[]> {
  requireView(viewer);
  return readAbsences(viewer, { startDate: { lte: to }, endDate: { gte: from } }, { order: "endAsc" });
}

/* ───────────── Qualifikationen ───────────── */

/** Bald ablaufende oder abgelaufene Qualifikationen aktiver Mitarbeiter (Baustein), ohne Anmerkung. */
export async function expiringQualifications(viewer: Viewer, before: Date, take: number) {
  requireView(viewer);
  return db.qualification.findMany({
    where: { expiresAt: { not: null, lte: before }, employee: { is: { active: true } } },
    orderBy: { expiresAt: "asc" },
    take,
    select: { id: true, employeeId: true, name: true, expiresAt: true, ...EMPLOYEE_NAME },
  });
}

/** Zweite Linie: Wer die Abfragen ohne `employees.view` aufruft, hat einen Fehler gemacht (Seiten und Bausteine prüfen das Recht vorher). */
function requireView(viewer: Viewer): void {
  if (!viewer.can("employees.view")) throw new Error("employees.view fehlt");
}

/** Bearbeiten reicht auch ohne eigenes Leserecht aus (die Bearbeiten-Seite verlangt `employees.edit`). */
function requireAccess(viewer: Viewer): void {
  if (!viewer.can("employees.view") && !viewer.can("employees.edit")) throw new Error("employees.view fehlt");
}
