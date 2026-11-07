import { dayKey, isCalendarDay, noon as noonIn, parseZoned, startOfDay, startOfMonth, timeKey, wallOf, workshopZone } from "./zone";

// Tage und Uhrzeiten der Anwendung gelten in der **Zeitzone der Werkstatt** (Einstellung, `workshopZone()` in `zone.ts`) – nicht in der des Prozesses (`TZ`).
// Alle Funktionen nehmen die Zone als letzten Parameter (Standard: Werkstatt-Zone), damit Tests und Rechnungen sie ausdrücklich angeben können.

export { isCalendarDay };

export const toDateInput = (d: Date, timeZone: string = workshopZone()) => dayKey(d, timeZone);
export const toTimeInput = (d: Date, timeZone: string = workshopZone()) => timeKey(d, timeZone);

/**
 * "2026-11-05" + "09:30" -> Zeitpunkt (Werkstatt-Zone). null bei ungültiger Eingabe **und bei einer Ortszeit, die es nicht gibt**: In der Lücke der Sommerzeitumstellung
 * (z. B. 31.03.2030 02:30 in Europe/Berlin) läge ein Termin sonst zu einer Zeit, die niemand eingegeben hat.
 * (Doppelt vorkommende Zeiten beim Zurückstellen sind eindeutig genug: die erste gilt.)
 */
export function parseLocalDateTime(date: string, time: string, timeZone: string = workshopZone()): Date | null {
  return parseZoned(date, time, timeZone);
}

/** URL-Parameter -> Tagesbeginn; fällt bei Fehlern auf heute zurück. */
export function parseDateParam(value: string | undefined, now: Date = new Date(), timeZone: string = workshopZone()): Date {
  return startOfDay(value && isCalendarDay(value) ? value : now, timeZone);
}

/**
 * Ein Kalendertag (`JJJJ-MM-TT`) als gespeicherter Zeitpunkt: 12:00 Uhr der Werkstatt-Zone. So bleibt ein Rechnungsdatum, eine Fälligkeit oder eine Abwesenheit auch dann
 * derselbe Tag, wenn die Zeit verschoben gelesen wird (Sommerzeit, Sicherung auf einem Rechner in anderer Zone). Gelesen wird er mit `toDateInput`.
 */
export const noon = (day: string, timeZone: string = workshopZone()) => noonIn(day, timeZone);

/** Beginn und letzte Millisekunde eines Kalendertags (`JJJJ-MM-TT`) als Grenzen für Datenbankabfragen („von … bis …“). */
export { endOfDay as endOfDayIn, startOfDay as startOfDayIn } from "./zone";

/** Heutiges Datum als yyyy-MM-dd (Hilfsfunktion außerhalb von Komponenten, wegen react-hooks/purity). */
export const todayInput = (now: Date = new Date(), timeZone: string = workshopZone()) => dayKey(now, timeZone);

/** Aktuelles Jahr (außerhalb von Komponenten, wegen react-hooks/purity). */
export const currentYear = (now: Date = new Date(), timeZone: string = workshopZone()) => wallOf(now, timeZone).year;

/** URL-Parameter "yyyy-MM" -> Monatsbeginn; fällt bei Fehlern auf den aktuellen Monat zurück. */
export function parseMonthParam(value: string | undefined, now: Date = new Date(), timeZone: string = workshopZone()): Date {
  if (value && /^\d{4}-\d{2}$/.test(value) && isCalendarDay(`${value}-01`)) return startOfMonth(`${value}-01`, timeZone);
  return startOfMonth(now, timeZone);
}

/** Aktuelle Zeit (außerhalb von Komponenten, wegen react-hooks/purity). */
export const nowDate = () => new Date();
