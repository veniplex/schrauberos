import "server-only";
import { versionOf } from "@/lib/concurrency";
import { addDaysToKey, dayKey, startOfDay } from "@/lib/zone";
import { employeeForUser, employeeNames, parseWorkWeekdays, staffSchedules, staffWithAccountIds } from "@/modules/office/employees/public";
import { orderLabels } from "@/modules/workshop/orders/public";
import type { AppSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { getHolidays } from "@/server/holidays";
import { entryMinutes, hintsFor, summarizeDays, weekDays, weekSummary, type Span, type TimeHint, type WeekSummary } from "./domain";
import { getTimeRules } from "./settings";

/**
 * Lesezugriffe der Zeiterfassung (README, „Datenzugriff“). **Wer sieht was:** Mit `time.view` nur die eigenen Zeiten (das Profil ergibt sich aus dem Benutzerkonto), mit `time.viewAll`
 * (gekennzeichnet: sensibel, personenbezogen) die aller Mitarbeiter. Gelesen wird nur, was die Person sehen darf – fremde Einträge werden ohne `time.viewAll` gar nicht erst aus der Datenbank geholt.
 * Abwesenheit kommt nur als „abwesend“ (nie Art oder Anmerkung) aus der Mitarbeiterverwaltung.
 */

export type TimeViewer = Pick<AppSession, "can" | "user" | "features">;

const ENTRY_SELECT = {
  id: true,
  employeeId: true,
  orderId: true,
  startedAt: true,
  endedAt: true,
  breakMinutes: true,
  activity: true,
  note: true,
  source: true,
  voidedAt: true,
  transferredAt: true,
  updatedAt: true,
} as const;

export type EntryRow = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  plate: string | null;
  startedAt: Date;
  endedAt: Date | null;
  breakMinutes: number;
  activity: string | null;
  note: string | null;
  source: string;
  voided: boolean;
  transferred: boolean;
  version: string;
  own: boolean;
};

/** Das Mitarbeiterprofil der angemeldeten Person (null: kein Profil mit dem Konto verknüpft). */
export const myEmployee = (viewer: TimeViewer) => employeeForUser(viewer.user.id);

async function decorate(viewer: TimeViewer, rows: Array<{ id: string; employeeId: string; orderId: string | null; startedAt: Date; endedAt: Date | null; breakMinutes: number; activity: string | null; note: string | null; source: string; voidedAt: Date | null; transferredAt: Date | null; updatedAt: Date }>, own: string | null): Promise<EntryRow[]> {
  const ownOnly = rows.every((r) => r.employeeId === own);
  const names = ownOnly ? new Map() : await employeeNames([...new Set(rows.map((r) => r.employeeId))]);
  const orders = viewer.features.has("workshop.orders") && viewer.can("orders.view") ? await orderLabels([...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))]) : new Map();
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: names.get(r.employeeId)?.name ?? null,
    orderId: r.orderId,
    orderNumber: r.orderId ? (orders.get(r.orderId)?.number ?? null) : null,
    plate: r.orderId ? (orders.get(r.orderId)?.plate ?? null) : null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    breakMinutes: r.breakMinutes,
    activity: r.activity,
    note: r.note,
    source: r.source,
    voided: r.voidedAt !== null,
    transferred: r.transferredAt !== null,
    version: versionOf(r),
    own: r.employeeId === own,
  }));
}

/** Einträge im Zeitraum (Kalendertage `JJJJ-MM-TT`, einschließlich): eigene, mit `time.viewAll` auch die aller (`employeeId` schränkt ein). Neueste zuerst, höchstens `take`. */
export async function listEntries(viewer: TimeViewer, filter: { from: string; to: string; employeeId?: string; includeVoided?: boolean }, take = 300): Promise<EntryRow[]> {
  if (!viewer.can("time.view")) throw new Error("time.view fehlt");
  const mine = await myEmployee(viewer);
  const all = viewer.can("time.viewAll");
  const employeeId = all ? filter.employeeId : (mine?.id ?? "none");
  if (!all && !mine) return [];
  const rows = await db.timeEntry.findMany({
    where: { startedAt: { gte: startOfDay(filter.from), lt: startOfDay(addDaysToKey(filter.to, 1)) }, ...(employeeId ? { employeeId } : {}), ...(filter.includeVoided ? {} : { voidedAt: null }) },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take,
    select: ENTRY_SELECT,
  });
  return decorate(viewer, rows, mine?.id ?? null);
}

/** Eine Seite von Einträgen für die API (gleiche Sichtbarkeit wie `listEntries`; zusätzlich Filter nach Auftrag und laufend). */
export async function pageEntries(
  viewer: TimeViewer,
  filter: { from?: string; to?: string; employeeId?: string; orderId?: string; includeVoided?: boolean; running?: boolean },
  page: { skip: number; take: number },
): Promise<{ rows: EntryRow[]; total: number }> {
  const mine = await myEmployee(viewer);
  const all = viewer.can("time.viewAll");
  if (!all && !mine) return { rows: [], total: 0 };
  const employeeId = all ? filter.employeeId : mine!.id;
  const where = {
    ...(filter.from || filter.to ? { startedAt: { ...(filter.from ? { gte: startOfDay(filter.from) } : {}), ...(filter.to ? { lt: startOfDay(addDaysToKey(filter.to, 1)) } : {}) } } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(filter.orderId ? { orderId: filter.orderId } : {}),
    ...(filter.includeVoided ? {} : { voidedAt: null }),
    ...(filter.running === undefined ? {} : filter.running ? { endedAt: null } : { endedAt: { not: null } }),
  };
  const [rows, total] = await Promise.all([
    db.timeEntry.findMany({ where, orderBy: [{ startedAt: "desc" }, { id: "asc" }], skip: page.skip, take: page.take, select: ENTRY_SELECT }),
    db.timeEntry.count({ where }),
  ]);
  return { rows: await decorate(viewer, rows, mine?.id ?? null), total };
}

export type EntryDetail = EntryRow & {
  corrections: Array<{ id: string; kind: string; reason: string; byName: string; at: Date; prevStartedAt: Date | null; prevEndedAt: Date | null; prevBreakMinutes: number | null; prevOrderNumber: string | null; prevActivity: string | null; prevNote: string | null }>;
};

/** Ein Eintrag mit Korrekturverlauf; fremde Einträge nur mit `time.viewAll` (sonst null: es gibt ihn für die Person nicht). */
export async function getEntry(viewer: TimeViewer, id: string): Promise<EntryDetail | null> {
  if (!viewer.can("time.view")) throw new Error("time.view fehlt");
  const mine = await myEmployee(viewer);
  const row = await db.timeEntry.findUnique({
    where: { id },
    select: { ...ENTRY_SELECT, corrections: { orderBy: { at: "asc" }, select: { id: true, kind: true, reason: true, byName: true, at: true, prevStartedAt: true, prevEndedAt: true, prevBreakMinutes: true, prevOrderId: true, prevActivity: true, prevNote: true } } },
  });
  if (!row || (row.employeeId !== mine?.id && !viewer.can("time.viewAll"))) return null;
  const [entry] = await decorate(viewer, [row], mine?.id ?? null);
  const prevOrders = viewer.features.has("workshop.orders") ? await orderLabels(row.corrections.flatMap((c) => (c.prevOrderId ? [c.prevOrderId] : []))) : new Map();
  return { ...entry, corrections: row.corrections.map(({ prevOrderId, ...c }) => ({ ...c, prevOrderNumber: prevOrderId ? (prevOrders.get(prevOrderId)?.number ?? null) : null })) };
}

/** Der laufende Eintrag der Person (oder null). */
export async function runningEntry(viewer: TimeViewer): Promise<EntryRow | null> {
  const mine = await myEmployee(viewer);
  if (!mine) return null;
  const row = await db.timeEntry.findFirst({ where: { runningKey: mine.id }, select: ENTRY_SELECT });
  return row ? (await decorate(viewer, [row], mine.id))[0] : null;
}

export type WeekView = { week: WeekSummary; hints: TimeHint[]; days: string[] };

/**
 * Woche einer Person: Ist/Soll/Saldo (Sollzeit aus den Einstellungen, Arbeitstage und Abwesenheit aus der Mitarbeiterverwaltung, Feiertage der Plattform) und die Hinweise zu Pausen und Ruhezeit.
 * Für die Hinweise werden die Einträge der Vorwoche-Tage davor mitgelesen (Ruhezeit am Montag).
 */
export async function weekFor(employee: { id: string; workWeekdays: string }, anyDay: string, now = new Date()): Promise<WeekView> {
  const days = weekDays(anyDay);
  const rows = await db.timeEntry.findMany({
    where: { employeeId: employee.id, voidedAt: null, startedAt: { gte: startOfDay(addDaysToKey(days[0], -2)), lt: startOfDay(addDaysToKey(days[6], 1)) } },
    select: { startedAt: true, endedAt: true, breakMinutes: true },
  });
  const [rules, holidays, schedules] = await Promise.all([getTimeRules(), getHolidays(), staffSchedules([employee.id], days[0], days[6])]);
  const week = weekSummary({
    days,
    summaries: summarizeDays(rows, now),
    pattern: parseWorkWeekdays(employee.workWeekdays),
    targetMinutes: rules.dailyTargetMinutes,
    holidays,
    absentDays: schedules.get(employee.id)?.absentDays ?? new Set(),
  });
  return { week, days, hints: hintsFor(rows, now).filter((h) => h.day >= days[0] && h.day <= days[6]) };
}

export type TeamRow = { employeeId: string; name: string; running: { since: Date; orderNumber: string | null } | null; worked: number; target: number; balance: number; hints: number };

/** Teamübersicht (nur mit `time.viewAll`): je aktivem Mitarbeiter mit Konto Ist/Soll/Saldo der Woche, wer gerade stempelt und wie viele Hinweise anliegen. */
export async function teamWeek(viewer: TimeViewer, anyDay: string, now = new Date()): Promise<{ days: string[]; rows: TeamRow[] }> {
  if (!viewer.can("time.viewAll")) throw new Error("time.viewAll fehlt");
  const days = weekDays(anyDay);
  const staff = await staffWithAccountIds();
  const ids = staff.map((s) => s.id);
  const [entries, schedules, rules, holidays] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId: { in: ids }, voidedAt: null, startedAt: { gte: startOfDay(addDaysToKey(days[0], -2)), lt: startOfDay(addDaysToKey(days[6], 1)) } },
      select: { employeeId: true, startedAt: true, endedAt: true, breakMinutes: true, orderId: true },
    }),
    staffSchedules(ids, days[0], days[6]),
    getTimeRules(),
    getHolidays(),
  ]);
  const orders = viewer.features.has("workshop.orders") && viewer.can("orders.view") ? await orderLabels([...new Set(entries.flatMap((e) => (e.endedAt === null && e.orderId ? [e.orderId] : [])))]) : new Map();
  const rows = staff.map((person): TeamRow => {
    const mine: Array<Span & { orderId: string | null }> = entries.filter((e) => e.employeeId === person.id);
    const schedule = schedules.get(person.id);
    const week = weekSummary({ days, summaries: summarizeDays(mine, now), pattern: parseWorkWeekdays(schedule?.workWeekdays), targetMinutes: rules.dailyTargetMinutes, holidays, absentDays: schedule?.absentDays ?? new Set() });
    const running = mine.find((e) => e.endedAt === null);
    return {
      employeeId: person.id,
      name: person.name,
      running: running ? { since: running.startedAt, orderNumber: running.orderId ? (orders.get(running.orderId)?.number ?? null) : null } : null,
      worked: week.worked,
      target: week.target,
      balance: week.balance,
      hints: hintsFor(mine, now).filter((h) => h.day >= days[0] && h.day <= days[6]).length,
    };
  });
  return { days, rows };
}

/** Mitarbeiter, für die ein Nachtrag möglich ist (nur mit `time.correctAll`): aktive Mitarbeiter mit Konto. */
export async function staffForManual(viewer: TimeViewer): Promise<Array<{ id: string; name: string }>> {
  if (!viewer.can("time.correctAll")) return [];
  return (await staffWithAccountIds()).map((s) => ({ id: s.id, name: s.name }));
}

export type OrderTimes = {
  /** Summe aller beendeten, nicht stornierten Zeiten des Auftrags in Minuten (Gesamtzahl, ohne Namen) */
  totalMinutes: number;
  /** davon noch nicht als Positionen übernommen */
  openMinutes: number;
  running: number;
  entries: EntryRow[];
};

/**
 * Zeiten eines Auftrags für den Abschnitt „Zeiten“: die Summen über **alle** Mitarbeiter (nur Zahlen, ohne Namen) und die Einzelzeilen – die eigenen, mit `time.viewAll` alle.
 */
export async function orderTimes(viewer: TimeViewer, orderId: string, now = new Date()): Promise<OrderTimes> {
  const mine = await myEmployee(viewer);
  const all = viewer.can("time.viewAll");
  const rows = await db.timeEntry.findMany({
    where: { orderId, voidedAt: null },
    orderBy: { startedAt: "desc" },
    select: { ...ENTRY_SELECT },
  });
  const done = rows.filter((r) => r.endedAt !== null);
  const sum = (list: typeof rows) => list.reduce((total, r) => total + entryMinutes(r, now), 0);
  const visible = rows.filter((r) => all || r.employeeId === mine?.id);
  return {
    totalMinutes: sum(done),
    openMinutes: sum(done.filter((r) => r.transferredAt === null)),
    running: rows.length - done.length,
    entries: await decorate(viewer, visible, mine?.id ?? null),
  };
}

/** Kennzahlen für den Stempel-Baustein der Übersicht: Heute gearbeitet (inklusive laufendem Eintrag) und der laufende Eintrag. */
export async function dashboardStamp(viewer: TimeViewer, now = new Date()): Promise<{ hasProfile: boolean; running: EntryRow | null; todayMinutes: number }> {
  const mine = await myEmployee(viewer);
  if (!mine || !mine.active) return { hasProfile: false, running: null, todayMinutes: 0 };
  const today = dayKey(now);
  const rows = await db.timeEntry.findMany({
    where: { employeeId: mine.id, voidedAt: null, OR: [{ endedAt: null }, { endedAt: { gte: startOfDay(today) } }] },
    select: { ...ENTRY_SELECT },
  });
  const summary = summarizeDays(rows, now).get(today);
  const running = rows.find((r) => r.endedAt === null);
  return { hasProfile: true, running: running ? (await decorate(viewer, [running], mine.id))[0] : null, todayMinutes: summary?.worked ?? 0 };
}

/** Schnellsuche: Einträge nach Tätigkeit und Notiz – die eigenen, mit `time.viewAll` alle (stornierte nicht). */
export async function searchEntries(viewer: TimeViewer, q: string, limit: number): Promise<EntryRow[]> {
  const mine = await myEmployee(viewer);
  const all = viewer.can("time.viewAll");
  if (!all && !mine) return [];
  const rows = await db.timeEntry.findMany({
    where: { voidedAt: null, ...(all ? {} : { employeeId: mine!.id }), OR: [{ activity: contains(q) }, { note: contains(q) }] },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: ENTRY_SELECT,
  });
  return decorate(viewer, rows, mine?.id ?? null);
}
