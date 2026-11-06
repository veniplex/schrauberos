import { format, isValid, parse, startOfDay } from "date-fns";

// Termine werden in der Serverzeitzone (Umgebungsvariable TZ, z. B. Europe/Berlin) ein- und ausgegeben.

export const toDateInput = (d: Date) => format(d, "yyyy-MM-dd");
export const toTimeInput = (d: Date) => format(d, "HH:mm");

/**
 * `JJJJ-MM-TT` ist ein **echter Kalendertag**: kein Monat 13, kein 30. Februar, kein 29. Februar im Nichtschaltjahr, Jahr ab 1000.
 * (Die bloße Form „vier Ziffern, Bindestrich, zwei, zwei“ lässt `2026-02-30` durch; JavaScript rollt das still auf den 2. März – oder liefert „Invalid Date“.)
 */
export function isCalendarDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1000) return false;
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * "2026-11-05" + "09:30" -> Date (lokal). null bei ungültiger Eingabe **und bei einer Ortszeit, die es nicht gibt**: In der Lücke der Sommerzeitumstellung
 * (z. B. 31.03.2030 02:30 in Europe/Berlin) verschiebt `Date` still auf 03:30 – ein Termin läge dann zu einer Zeit, die niemand eingegeben hat.
 * (Doppelt vorkommende Zeiten beim Zurückstellen sind eindeutig genug: die erste gilt.)
 */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const d = parse(`${date} ${time}`, "yyyy-MM-dd HH:mm", new Date());
  if (!isValid(d)) return null;
  return format(d, "yyyy-MM-dd HH:mm") === `${date} ${time}` ? d : null;
}

/** URL-Parameter -> Tagesbeginn; fällt bei Fehlern auf heute zurück. */
export function parseDateParam(value: string | undefined): Date {
  if (value) {
    const d = parse(value, "yyyy-MM-dd", new Date());
    if (isValid(d)) return startOfDay(d);
  }
  return startOfDay(new Date());
}

/** Heutiges Datum als yyyy-MM-dd (Hilfsfunktion außerhalb von Komponenten, wegen react-hooks/purity). */
export const todayInput = () => toDateInput(new Date());

/** Aktuelles Jahr (außerhalb von Komponenten, wegen react-hooks/purity). */
export const currentYear = () => new Date().getFullYear();

/** URL-Parameter "yyyy-MM" -> Monatsbeginn; fällt bei Fehlern auf den aktuellen Monat zurück. */
export function parseMonthParam(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const d = parse(`${value}-01`, "yyyy-MM-dd", new Date());
    if (isValid(d)) return d;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Aktuelle Zeit (außerhalb von Komponenten, wegen react-hooks/purity). */
export const nowDate = () => new Date();
