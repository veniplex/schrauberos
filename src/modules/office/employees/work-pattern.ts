/**
 * Arbeitstage-Muster je Mitarbeiter (Teilzeit nach Wochentagen, P4b-4): Wochentage als Zahlen 0 = Sonntag … 6 = Samstag (wie `weekdayOfKey`), gespeichert als aufsteigende,
 * kommagetrennte Zeichenfolge (`Employee.workWeekdays`, Standard Montag bis Freitag). Rein, ohne Datenbank.
 */
export type WorkPattern = ReadonlySet<number>;

export const DEFAULT_WORK_WEEKDAYS = "1,2,3,4,5";
/** Montag bis Freitag */
export const FULL_WEEK: WorkPattern = new Set([1, 2, 3, 4, 5]);
/** Reihenfolge der Anzeige: Montag zuerst, Sonntag zuletzt */
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Liest die gespeicherte Zeichenfolge; ungültige oder leere Werte ergeben den Standard (Montag bis Freitag) – ein Mitarbeiter ohne einen einzigen Arbeitstag gibt es nicht. */
export function parseWorkWeekdays(text: string | null | undefined): WorkPattern {
  if (!text) return FULL_WEEK;
  const days = new Set<number>();
  for (const part of text.split(",")) {
    const n = Number(part);
    if (part.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 6) days.add(n);
    else return FULL_WEEK;
  }
  return days.size > 0 ? days : FULL_WEEK;
}

/** Die Zeichenfolge zum Speichern: aufsteigend, ohne Doppelte. */
export function formatWorkWeekdays(days: Iterable<number>): string {
  return [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b).join(",");
}

/** Liste der Wochentage (für API und Formulare), aufsteigend. */
export const workWeekdayList = (text: string | null | undefined): number[] => [...parseWorkWeekdays(text)].sort((a, b) => a - b);

/** Arbeitet die Person an dieser Woche in Vollzeit (Montag bis Freitag)? */
export const isFullWeek = (pattern: WorkPattern): boolean => pattern.size === FULL_WEEK.size && [...FULL_WEEK].every((d) => pattern.has(d));
