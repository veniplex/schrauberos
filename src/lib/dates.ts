import { format, isValid, parse, startOfDay } from "date-fns";

// Termine werden in der Serverzeitzone (Umgebungsvariable TZ, z. B. Europe/Berlin) ein- und ausgegeben.

export const toDateInput = (d: Date) => format(d, "yyyy-MM-dd");
export const toTimeInput = (d: Date) => format(d, "HH:mm");

/** "2026-11-05" + "09:30" -> Date (lokal). null bei ungültiger Eingabe. */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const d = parse(`${date} ${time}`, "yyyy-MM-dd HH:mm", new Date());
  return isValid(d) ? d : null;
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
