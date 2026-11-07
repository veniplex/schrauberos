import type { HolidayCalendar } from "@/lib/holidays";
import { addDaysToKey, dayKey, daysBetweenKeys, weekdayOfKey, workshopZone } from "@/lib/zone";

/** Was die Arbeitstage-Rechnung vom Feiertagskalender braucht (`getHolidays()` aus `@/server/holidays`); ohne Angabe sind Feiertage Arbeitstage. */
export type HolidayLookup = Pick<HolidayCalendar, "on">;

export const DEPARTMENTS = ["workshop", "office", "it", "management", "other"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const ABSENCE_TYPES = ["vacation", "sick", "training", "other"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/**
 * Arbeitstage (Mo–Fr) zwischen zwei Kalendertagen `JJJJ-MM-TT`, beide inklusive. Mit `holidays` zählt ein gesetzlicher oder eigener Feiertag auf einen Wochentag nicht
 * (ein halber Feiertag als halber Arbeitstag, daher kann das Ergebnis x,5 sein); Feiertage am Wochenende ändern nichts.
 */
export function workdaysBetweenKeys(start: string, end: string, holidays?: HolidayLookup): number {
  const days = daysBetweenKeys(start, end);
  if (days < 0) return 0;
  let n = 0;
  for (let i = 0; i <= days; i++) {
    const key = addDaysToKey(start, i);
    const wd = weekdayOfKey(key);
    if (wd === 0 || wd === 6) continue;
    const holiday = holidays?.on(key);
    n += holiday ? (holiday.half ? 0.5 : 0) : 1;
  }
  return n;
}

/** Arbeitstage (Mo–Fr) zwischen zwei Daten, beide inklusive – gezählt werden die Kalendertage in der Zeitzone der Werkstatt; mit `holidays` ohne Feiertage. */
export function workdaysBetween(start: Date, end: Date, holidays?: HolidayLookup, timeZone: string = workshopZone()): number {
  return workdaysBetweenKeys(dayKey(start, timeZone), dayKey(end, timeZone), holidays);
}

/** Arbeitstage einer Abwesenheit, die in das Zeitfenster [from, to] fallen (z. B. ein Kalenderjahr); Fenster als Kalendertage `JJJJ-MM-TT`. */
export function workdaysWithinKeys(absence: { startDate: Date; endDate: Date }, from: string, to: string, holidays?: HolidayLookup, timeZone: string = workshopZone()): number {
  const s = dayKey(absence.startDate, timeZone);
  const e = dayKey(absence.endDate, timeZone);
  return workdaysBetweenKeys(s > from ? s : from, e < to ? e : to, holidays);
}

/** Wie `workdaysWithinKeys`, das Fenster als Zeitpunkte. */
export function workdaysWithin(absence: { startDate: Date; endDate: Date }, from: Date, to: Date, holidays?: HolidayLookup, timeZone: string = workshopZone()): number {
  return workdaysWithinKeys(absence, dayKey(from, timeZone), dayKey(to, timeZone), holidays, timeZone);
}

export function employeeName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Krankheit ist besonders schützenswert: ohne Recht wird sie als neutrale Abwesenheit angezeigt. */
export function visibleAbsenceType(type: string, canSeeSensitive: boolean): AbsenceType | "masked" {
  if (type === "sick" && !canSeeSensitive) return "masked";
  return (ABSENCE_TYPES as readonly string[]).includes(type) ? (type as AbsenceType) : "other";
}
