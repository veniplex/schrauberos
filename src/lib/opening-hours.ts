import { WEEKDAYS, type Weekday } from "./constants";

export type OpeningHours = Record<Weekday, [string, string] | null>;

export const DEFAULT_OPENING_HOURS: OpeningHours = {
  mon: ["07:30", "17:00"],
  tue: ["07:30", "17:00"],
  wed: ["07:30", "17:00"],
  thu: ["07:30", "17:00"],
  fri: ["07:30", "16:00"],
  sat: null,
  sun: null,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseOpeningHours(json: string | null | undefined): OpeningHours {
  let raw: unknown = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    /* ungültig -> Standard */
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Leeres Objekt = noch nie konfiguriert -> sinnvolle Standardzeiten
  if (Object.keys(obj).length === 0) return { ...DEFAULT_OPENING_HOURS };
  const result = {} as OpeningHours;
  for (const day of WEEKDAYS) {
    const v = obj[day];
    result[day] =
      Array.isArray(v) && v.length === 2 && TIME.test(String(v[0])) && TIME.test(String(v[1]))
        ? [String(v[0]), String(v[1])]
        : null;
  }
  return result;
}

export function isValidTime(value: string): boolean {
  return TIME.test(value);
}

/** Wochentag-Schlüssel eines Datums (Mo = "mon"). */
export function weekdayKey(date: Date): Weekday {
  return WEEKDAYS[(date.getDay() + 6) % 7];
}
