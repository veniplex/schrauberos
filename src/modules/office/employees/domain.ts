import { addDaysToKey, dayKey, daysBetweenKeys, weekdayOfKey, workshopZone } from "@/lib/zone";

export const DEPARTMENTS = ["workshop", "office", "it", "management", "other"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const ABSENCE_TYPES = ["vacation", "sick", "training", "other"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/** Arbeitstage (Mo–Fr) zwischen zwei Kalendertagen `JJJJ-MM-TT`, beide inklusive. Feiertage werden nicht berücksichtigt. */
export function workdaysBetweenKeys(start: string, end: string): number {
  const days = daysBetweenKeys(start, end);
  if (days < 0) return 0;
  let n = 0;
  for (let i = 0; i <= days; i++) {
    const wd = weekdayOfKey(addDaysToKey(start, i));
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** Arbeitstage (Mo–Fr) zwischen zwei Daten, beide inklusive – gezählt werden die Kalendertage in der Zeitzone der Werkstatt. Feiertage werden nicht berücksichtigt. */
export function workdaysBetween(start: Date, end: Date, timeZone: string = workshopZone()): number {
  return workdaysBetweenKeys(dayKey(start, timeZone), dayKey(end, timeZone));
}

/** Arbeitstage einer Abwesenheit, die in das Zeitfenster [from, to] fallen (z. B. ein Kalenderjahr); Fenster als Kalendertage `JJJJ-MM-TT`. */
export function workdaysWithinKeys(absence: { startDate: Date; endDate: Date }, from: string, to: string, timeZone: string = workshopZone()): number {
  const s = dayKey(absence.startDate, timeZone);
  const e = dayKey(absence.endDate, timeZone);
  return workdaysBetweenKeys(s > from ? s : from, e < to ? e : to);
}

/** Wie `workdaysWithinKeys`, das Fenster als Zeitpunkte. */
export function workdaysWithin(absence: { startDate: Date; endDate: Date }, from: Date, to: Date, timeZone: string = workshopZone()): number {
  return workdaysWithinKeys(absence, dayKey(from, timeZone), dayKey(to, timeZone), timeZone);
}

export function employeeName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Krankheit ist besonders schützenswert: ohne Recht wird sie als neutrale Abwesenheit angezeigt. */
export function visibleAbsenceType(type: string, canSeeSensitive: boolean): AbsenceType | "masked" {
  if (type === "sick" && !canSeeSensitive) return "masked";
  return (ABSENCE_TYPES as readonly string[]).includes(type) ? (type as AbsenceType) : "other";
}
