import { addDaysToKey, daysBetweenKeys, isCalendarDay } from "./zone";

/**
 * Zeiträume für Berichte, Zeiterfassung und Filter (`components/ui/date-range.tsx`): reine Rechnung mit Kalendertagen als Text `JJJJ-MM-TT` (keine Uhrzeit, keine Zone – „heute“ liefert der
 * Aufrufer in der Zone der Werkstatt, `todayInput()`). Beide Enden gehören zum Zeitraum.
 */
export type RangePreset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth" | "thisYear";
export const RANGE_PRESETS: readonly RangePreset[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "thisYear"];

export type DayRange = { from: string; to: string };

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const lastDayOfMonth = (day: string) => {
  const [year, month] = day.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return addDaysToKey(next, -1);
};

export function presetRange(preset: RangePreset, today: string): DayRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDaysToKey(today, -1);
      return { from: day, to: day };
    }
    case "last7":
      return { from: addDaysToKey(today, -6), to: today };
    case "last30":
      return { from: addDaysToKey(today, -29), to: today };
    case "thisMonth":
      return { from: monthStart(today), to: lastDayOfMonth(today) };
    case "lastMonth": {
      const previous = addDaysToKey(monthStart(today), -1);
      return { from: monthStart(previous), to: previous };
    }
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

export type RangeState = "empty" | "incomplete" | "invalid" | "reversed" | "tooLong" | "ok";

/** Prüft einen Zeitraum aus zwei Eingabefeldern. `empty`: beide leer (kein Filter), `incomplete`: nur ein Ende. */
export function rangeState(from: string, to: string, options: { maxDays?: number } = {}): RangeState {
  if (!from && !to) return "empty";
  if (!from || !to) return from ? (isCalendarDay(from) ? "incomplete" : "invalid") : isCalendarDay(to) ? "incomplete" : "invalid";
  if (!isCalendarDay(from) || !isCalendarDay(to)) return "invalid";
  if (from > to) return "reversed";
  if (options.maxDays !== undefined && daysBetweenKeys(from, to) + 1 > options.maxDays) return "tooLong";
  return "ok";
}

/** Anzahl der Tage (beide Enden eingeschlossen); 0 bei ungültigem Zeitraum. */
export const rangeDays = (from: string, to: string): number => (rangeState(from, to) === "ok" ? daysBetweenKeys(from, to) + 1 : 0);
