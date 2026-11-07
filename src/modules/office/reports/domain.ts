import { WEEKDAYS } from "@/lib/constants";
import type { HolidayLookup } from "@/lib/holidays";
import type { OpeningHours } from "@/lib/opening-hours";
import { addDaysToKey, daysBetweenKeys, isCalendarDay, parseZoned, weekdayOfKey } from "@/lib/zone";

/**
 * Rechenregeln der Berichte (F9) – reine Funktionen ohne Datenbank, getestet gegen handgerechnete Fälle. Tage sind Kalendertage der Werkstatt-Zone (`JJJJ-MM-TT`), Monate `JJJJ-MM`.
 */

/** Höchstens so viele Monate umfasst der Umsatzbericht (36 Abfragen je Aufruf sind die Obergrenze). */
export const MAX_REVENUE_MONTHS = 36;
/** Auslastung: höchstens ein Jahr (366 Tage) – die Termine des Zeitraums werden im Speicher auf Öffnungszeiten verteilt. */
export const MAX_UTILIZATION_DAYS = 366;
/** So viele Zeilen zeigt eine Liste im Bericht höchstens (die Summen darüber zählen alle). */
export const REPORT_LIST_LIMIT = 50;

/* ───────────── Zeiträume ───────────── */

export const isDay = (value: unknown): value is string => typeof value === "string" && isCalendarDay(value);

export const monthOfDay = (day: string): string => day.slice(0, 7);

/** Letzter Tag eines Monats `JJJJ-MM`. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Der folgende Monat `JJJJ-MM`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Der Zeitraum auf ganze Monate gerundet (Umsatz je Monat zeigt nie einen halben Monat): `from` auf den Ersten, `to` auf den Letzten des Monats. */
export function snapToMonths(from: string, to: string): { from: string; to: string } {
  return { from: `${monthOfDay(from)}-01`, to: lastDayOfMonth(monthOfDay(to)) };
}

/** Die Monate `JJJJ-MM` von `from` bis `to` (Tage, beide einschließlich), aufsteigend. */
export function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let month = monthOfDay(from); month <= monthOfDay(to); month = nextMonth(month)) out.push(month);
  return out;
}

export type PeriodProblem = "invalid" | "reversed" | "tooLong";

/** Prüft einen Zeitraum aus Eingabetexten; `maxDays` begrenzt die Länge (beide Tage zählen mit). */
export function parsePeriod(from: unknown, to: unknown, options: { maxDays: number }): { ok: true; from: string; to: string } | { ok: false; problem: PeriodProblem } {
  if (!isDay(from) || !isDay(to)) return { ok: false, problem: "invalid" };
  if (to < from) return { ok: false, problem: "reversed" };
  if (daysBetweenKeys(from, to) + 1 > options.maxDays) return { ok: false, problem: "tooLong" };
  return { ok: true, from, to };
}

/* ───────────── Auslastung ───────────── */

export type Interval = { start: number; end: number };

/**
 * Die Öffnungszeiten als Zeitabschnitte (Millisekunden) für die Tage `days` (aufsteigend): je Tag [Beginn, Ende) der Werkstatt-Zone nach Wochentag; ein **ganzer Feiertag** hat keine, ein **halber** nur
 * die erste Hälfte. Ein Tag ohne Öffnungszeit (geschlossen) hat keinen Abschnitt. Zeiten in der Umstellungslücke der Sommerzeit gibt es nicht (`parseZoned` → keine Öffnung an diesem Tag).
 */
export function openingIntervals(days: readonly string[], hours: OpeningHours, holidays: HolidayLookup, timeZone?: string): Interval[] {
  const out: Interval[] = [];
  for (const day of days) {
    const range = hours[WEEKDAYS[(weekdayOfKey(day) + 6) % 7]];
    if (!range) continue;
    const holiday = holidays.on(day);
    if (holiday && !holiday.half) continue;
    const start = parseZoned(day, range[0], timeZone)?.getTime();
    let end = parseZoned(day, range[1], timeZone)?.getTime();
    if (start === undefined || end === undefined || end <= start) continue;
    if (holiday?.half) end = start + (end - start) / 2;
    out.push({ start, end });
  }
  return out;
}

/** Alle Tage `from`…`to` (einschließlich) als Kalendertage. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDaysToKey(day, 1)) out.push(day);
  return out;
}

/** Summe der Länge der Abschnitte in Minuten. */
export const totalMinutes = (intervals: readonly Interval[]): number => intervals.reduce((sum, i) => sum + (i.end - i.start) / 60_000, 0);

/**
 * Wie viele Minuten eines Termins [startsAt, endsAt) liegen **innerhalb der Öffnungszeiten** (`intervals` aufsteigend, ohne Überlappung)? Zeiten außerhalb (über Nacht, Wochenende, Feiertag) zählen
 * nicht – die Auslastung bezieht sich auf die Zeit, in der die Werkstatt offen ist, und überschreitet nie 100 %, solange kein Platz doppelt belegt ist.
 */
export function overlapMinutes(startsAt: number, endsAt: number, intervals: readonly Interval[]): number {
  if (endsAt <= startsAt || intervals.length === 0) return 0;
  // erster Abschnitt, der nach dem Beginn noch endet (binäre Suche)
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid].end > startsAt) hi = mid;
    else lo = mid + 1;
  }
  let minutes = 0;
  for (let i = lo; i < intervals.length && intervals[i].start < endsAt; i++) minutes += (Math.min(endsAt, intervals[i].end) - Math.max(startsAt, intervals[i].start)) / 60_000;
  return minutes;
}

/** Auslastung in Prozent (eine Nachkommastelle); `null`, wenn es keine Öffnungszeit gibt (Teilen durch null: keine Aussage). */
export function utilizationPercent(bookedMinutes: number, capacityMinutes: number): number | null {
  if (capacityMinutes <= 0) return null;
  return Math.round((bookedMinutes / capacityMinutes) * 1000) / 10;
}

/** Zeitraum des Umsatzberichts: gültig, nicht vertauscht und höchstens `MAX_REVENUE_MONTHS` Monate (nach dem Runden auf ganze Monate). */
export function parseRevenuePeriod(from: unknown, to: unknown): { ok: true; from: string; to: string } | { ok: false; problem: PeriodProblem } {
  const period = parsePeriod(from, to, { maxDays: 366 * 3 });
  if (!period.ok) return period;
  const snapped = snapToMonths(period.from, period.to);
  return monthKeys(snapped.from, snapped.to).length > MAX_REVENUE_MONTHS ? { ok: false, problem: "tooLong" } : { ok: true, from: period.from, to: period.to };
}

/** Voreinstellung eines Berichts mit Zeitraum: dieses Jahr bis heute (Umsatz) bzw. dieser Monat bis heute (Auslastung). */
export const thisYearUntil = (today: string): { from: string; to: string } => ({ from: `${today.slice(0, 4)}-01-01`, to: today });
export const thisMonthUntil = (today: string): { from: string; to: string } => ({ from: `${today.slice(0, 7)}-01`, to: today });
