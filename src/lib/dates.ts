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
