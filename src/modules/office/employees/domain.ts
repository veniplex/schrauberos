import { addDays, differenceInCalendarDays, getDay, max as maxDate, min as minDate, startOfDay } from "date-fns";

export const DEPARTMENTS = ["workshop", "office", "it", "management", "other"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const ABSENCE_TYPES = ["vacation", "sick", "training", "other"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/** Arbeitstage (Mo–Fr) zwischen zwei Daten, beide inklusive. Feiertage werden nicht berücksichtigt. */
export function workdaysBetween(start: Date, end: Date): number {
  const s = startOfDay(start);
  const days = differenceInCalendarDays(startOfDay(end), s);
  if (days < 0) return 0;
  let n = 0;
  for (let i = 0; i <= days; i++) {
    const wd = getDay(addDays(s, i));
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** Arbeitstage einer Abwesenheit, die in das Zeitfenster [from, to] fallen (z. B. ein Kalenderjahr). */
export function workdaysWithin(absence: { startDate: Date; endDate: Date }, from: Date, to: Date): number {
  const s = maxDate([startOfDay(absence.startDate), startOfDay(from)]);
  const e = minDate([startOfDay(absence.endDate), startOfDay(to)]);
  return workdaysBetween(s, e);
}

export function employeeName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Krankheit ist besonders schützenswert: ohne Recht wird sie als neutrale Abwesenheit angezeigt. */
export function visibleAbsenceType(type: string, canSeeSensitive: boolean): AbsenceType | "masked" {
  if (type === "sick" && !canSeeSensitive) return "masked";
  return (ABSENCE_TYPES as readonly string[]).includes(type) ? (type as AbsenceType) : "other";
}
