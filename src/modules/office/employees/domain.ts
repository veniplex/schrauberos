import type { HolidayLookup } from "@/lib/holidays";
import { addDaysToKey, dayKey, daysBetweenKeys, weekdayOfKey, workshopZone } from "@/lib/zone";
import { FULL_WEEK, type WorkPattern } from "./work-pattern";

export const DEPARTMENTS = ["workshop", "office", "it", "management", "other"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const ABSENCE_TYPES = ["vacation", "sick", "training", "other"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/**
 * Arbeitstage zwischen zwei Kalendertagen `JJJJ-MM-TT`, beide inklusive. Gezählt werden nur die Tage des `pattern` (Arbeitstage-Muster der Person, Standard Montag bis Freitag).
 * Mit `holidays` zählt ein gesetzlicher oder eigener Feiertag auf einen Arbeitstag nicht (ein halber Feiertag als halber Arbeitstag, daher kann das Ergebnis x,5 sein);
 * Feiertage an Tagen, an denen die Person nicht arbeitet, ändern nichts.
 */
export function workdaysBetweenKeys(start: string, end: string, holidays?: HolidayLookup, pattern: WorkPattern = FULL_WEEK): number {
  const days = daysBetweenKeys(start, end);
  if (days < 0) return 0;
  let n = 0;
  for (let i = 0; i <= days; i++) {
    const key = addDaysToKey(start, i);
    if (!pattern.has(weekdayOfKey(key))) continue;
    const holiday = holidays?.on(key);
    n += holiday ? (holiday.half ? 0.5 : 0) : 1;
  }
  return n;
}

/** Arbeitstage zwischen zwei Daten, beide inklusive – gezählt werden die Kalendertage in der Zeitzone der Werkstatt; mit `holidays` ohne Feiertage, mit `pattern` nur die Arbeitstage der Person. */
export function workdaysBetween(start: Date, end: Date, holidays?: HolidayLookup, timeZone: string = workshopZone(), pattern: WorkPattern = FULL_WEEK): number {
  return workdaysBetweenKeys(dayKey(start, timeZone), dayKey(end, timeZone), holidays, pattern);
}

/** Arbeitstage einer Abwesenheit, die in das Zeitfenster [from, to] fallen (z. B. ein Kalenderjahr); Fenster als Kalendertage `JJJJ-MM-TT`. */
export function workdaysWithinKeys(absence: { startDate: Date; endDate: Date }, from: string, to: string, holidays?: HolidayLookup, timeZone: string = workshopZone(), pattern: WorkPattern = FULL_WEEK): number {
  const s = dayKey(absence.startDate, timeZone);
  const e = dayKey(absence.endDate, timeZone);
  return workdaysBetweenKeys(s > from ? s : from, e < to ? e : to, holidays, pattern);
}

/** Wie `workdaysWithinKeys`, das Fenster als Zeitpunkte. */
export function workdaysWithin(absence: { startDate: Date; endDate: Date }, from: Date, to: Date, holidays?: HolidayLookup, timeZone: string = workshopZone(), pattern: WorkPattern = FULL_WEEK): number {
  return workdaysWithinKeys(absence, dayKey(from, timeZone), dayKey(to, timeZone), holidays, timeZone, pattern);
}

export function employeeName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Krankheit ist besonders schützenswert: ohne Recht wird sie als neutrale Abwesenheit angezeigt. */
export function visibleAbsenceType(type: string, canSeeSensitive: boolean): AbsenceType | "masked" {
  if (type === "sick" && !canSeeSensitive) return "masked";
  return (ABSENCE_TYPES as readonly string[]).includes(type) ? (type as AbsenceType) : "other";
}
