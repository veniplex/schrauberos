import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/modules/types";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { versionOf } from "@/lib/concurrency";
import { endOfDayIn, startOfDayIn, todayInput } from "@/lib/dates";
import { dayKey } from "@/lib/zone";
import { getHolidays } from "@/server/holidays";
import { absenceHints, type AbsenceHints, type PlannedAbsence } from "./absence-overlap";
import { ABSENCE_TYPES, employeeName, type AbsenceType } from "./domain";
import { getEmployeeRules } from "./settings";
import { vacationBalance, type VacationBalance } from "./vacation";
import { parseWorkWeekdays } from "./work-pattern";

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
  workWeekdays: true,
  vacationCarryYear: true,
  vacationCarryDays: true,
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
const EMPLOYEE_NAME = { employee: { select: { firstName: true, lastName: true, workWeekdays: true } } } as const;

export type Emergency = { name: string | null; phone: string | null; relation: string | null };
export type EmployeeName = { id: string; firstName: string; lastName: string };

/** Abwesenheit, wie der Betrachter sie sehen darf: Krankheit ohne `employees.sensitive` ist `masked`, ohne Anmerkung. */
export type AbsenceView = { id: string; employeeId: string; type: AbsenceType | "masked"; startDate: Date; endDate: Date; note: string | null; /** Version zum Bearbeiten (null bei verdeckter Krankheit: nicht bearbeitbar) */ version: string | null };
export type AbsenceWithEmployee = AbsenceView & { employee: { firstName: string; lastName: string; workWeekdays: string } };

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

/** Arbeitstage-Muster (Teilzeit) der aktiven Mitarbeiter: Kennung → gespeicherte Wochentage (`work-pattern.ts`) – für das Monatsraster der Abwesenheiten. */
export async function staffWorkPatterns(viewer: Viewer): Promise<Map<string, string>> {
  requireView(viewer);
  const rows = await db.employee.findMany({ where: { active: true }, select: { id: true, workWeekdays: true } });
  return new Map(rows.map((r) => [r.id, r.workWeekdays]));
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
    db.qualification.findMany({ where: { employeeId: id }, orderBy: [{ expiresAt: "asc" }, { name: "asc" }], select: { id: true, employeeId: true, name: true, issuedAt: true, expiresAt: true, note: true, updatedAt: true } }),
  ]);
  return {
    ...base,
    user,
    absences: absences.map((a) => ({ id: a.id, employeeId: a.employeeId, type: a.type, startDate: a.startDate, endDate: a.endDate, note: a.note, version: a.version }) satisfies AbsenceView),
    qualifications,
  };
}

/**
 * Urlaubsstand eines Mitarbeiters für ein Jahr (Anspruch, Übertrag, genommen, Rest; `vacation.ts`). Liest die Urlaubseinträge (Art „Urlaub“, nie sensibel) bis zu sechs Jahre zurück,
 * die Feiertage der Werkstatt und den Verfall-Stichtag aus den Einstellungen. `null`, wenn es die Person nicht gibt.
 */
export async function getVacationBalance(viewer: Viewer, employeeId: string, year: number): Promise<VacationBalance | null> {
  requireView(viewer);
  const [employee, rules, holidays] = await Promise.all([
    db.employee.findUnique({
      where: { id: employeeId },
      select: { hireDate: true, leaveDate: true, vacationDaysPerYear: true, workWeekdays: true, vacationCarryYear: true, vacationCarryDays: true, createdAt: true },
    }),
    getEmployeeRules(),
    getHolidays(),
  ]);
  if (!employee) return null;
  const vacations = await db.absence.findMany({
    where: { employeeId, type: "vacation", endDate: { gte: startOfDayIn(`${year - 7}-01-01`) }, startDate: { lte: endOfDayIn(`${year}-12-31`) } },
    select: { startDate: true, endDate: true },
  });
  return vacationBalance({
    year,
    daysPerYear: employee.vacationDaysPerYear,
    hire: employee.hireDate ? dayKey(employee.hireDate) : null,
    leave: employee.leaveDate ? dayKey(employee.leaveDate) : null,
    carry: employee.vacationCarryYear != null && employee.vacationCarryDays != null ? { year: employee.vacationCarryYear, days: employee.vacationCarryDays } : null,
    trackingStartYear: Number(dayKey(employee.createdAt).slice(0, 4)),
    vacations: vacations.map((v) => ({ start: dayKey(v.startDate), end: dayKey(v.endDate) })),
    holidays,
    pattern: parseWorkWeekdays(employee.workWeekdays),
    deadline: { month: rules.vacationCarryMonth, day: rules.vacationCarryDay },
    today: todayInput(),
  });
}

/** Eine Abwesenheit zum Bearbeiten; Krankheit nur mit `employees.sensitive` (sonst wird sie gar nicht gelesen: `null`). */
export async function getAbsenceForEdit(viewer: Viewer, id: string) {
  if (!viewer.can("employees.edit")) throw new Error("employees.edit fehlt");
  const row = await db.absence.findFirst({
    where: { id, ...(viewer.can(SENSITIVE) ? {} : { type: { not: "sick" } }) },
    select: { id: true, employeeId: true, type: true, startDate: true, endDate: true, note: true, updatedAt: true },
  });
  return row ? { id: row.id, employeeId: row.employeeId, type: knownType(row.type), startDate: row.startDate, endDate: row.endDate, note: row.note, version: versionOf(row) } : null;
}

/** Eine Qualifikation zum Bearbeiten. */
export async function getQualificationForEdit(viewer: Viewer, id: string) {
  if (!viewer.can("employees.edit")) throw new Error("employees.edit fehlt");
  const row = await db.qualification.findUnique({ where: { id }, select: { id: true, employeeId: true, name: true, issuedAt: true, expiresAt: true, note: true, updatedAt: true } });
  return row ? { id: row.id, employeeId: row.employeeId, name: row.name, issuedAt: row.issuedAt, expiresAt: row.expiresAt, note: row.note, version: versionOf(row) } : null;
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
    select: { id: true, employeeId: true, type: true, startDate: true, endDate: true, note: true, updatedAt: true, ...EMPLOYEE_NAME },
  });
  const rows: AbsenceWithEmployee[] = open.map(({ updatedAt, ...a }) => ({ ...a, type: knownType(a.type), version: versionOf({ updatedAt }) }));
  if (sensitive) return rows;
  const hidden = await db.absence.findMany({
    where: { AND: [where, { type: "sick" }] },
    orderBy,
    take: opts.take,
    select: { id: true, employeeId: true, startDate: true, endDate: true, ...EMPLOYEE_NAME },
  });
  rows.push(...hidden.map((a): AbsenceWithEmployee => ({ ...a, type: "masked", note: null, version: null })));
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

/**
 * Hinweise zu einem geplanten Zeitraum (Überschneidungen derselben Person, exakte Dublette; `absence-overlap.ts`). Verlangt `employees.edit` (Formular „Abwesenheit eintragen“);
 * Krankheitszeilen kommen ohne Recht `employees.sensitive` nur als `masked` (ohne Art und Anmerkung) an, der Hinweis nennt dann bloß den Zeitraum.
 */
export async function absenceHintsFor(viewer: Viewer, planned: PlannedAbsence & { employeeId: string; /** beim Bearbeiten: diese Abwesenheit nicht mitzählen */ excludeId?: string }): Promise<AbsenceHints> {
  if (!viewer.can("employees.edit")) throw new Error("employees.edit fehlt");
  const rows = await readAbsences(
    viewer,
    { employeeId: planned.employeeId, startDate: { lte: endOfDayIn(planned.end) }, endDate: { gte: startOfDayIn(planned.start) }, ...(planned.excludeId ? { id: { not: planned.excludeId } } : {}) },
    { order: "startAsc", take: 50 },
  );
  return absenceHints(planned, rows.map((r) => ({ type: r.type, startDate: r.startDate, endDate: r.endDate })));
}

/**
 * Ist die Person (Benutzerkonto) an einem der Kalendertage `from`…`to` (`JJJJ-MM-TT`, einschließlich) abwesend? Für die Hinweise im Terminformular: Die Abfrage liest **nur die Zeiträume**,
 * nie die Art oder die Anmerkung – Krankheit bleibt auch hier unsichtbar („abwesend“ ist alles, was andere Funktionen erfahren). Ohne Mitarbeiter-Eintrag zum Konto: nein.
 */
export async function userAbsentBetween(userId: string, from: string, to: string): Promise<boolean> {
  const count = await db.absence.count({ where: { employee: { userId }, startDate: { lte: endOfDayIn(to) }, endDate: { gte: startOfDayIn(from) } } });
  return count > 0;
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
