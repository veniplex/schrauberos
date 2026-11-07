import { addDays, dayKey, noon, startOfDay } from "@/lib/zone";

/**
 * Tagesrechnung der Demo-Daten (nur für Seeds): „heute plus N Tage“ und das Mittagsdatum eines Tages (so speichert die Anwendung Kalendertage, siehe `noon()` in `dates.ts`).
 * Tage zählen in der Zeitzone der Werkstatt. Reine Hilfsfunktionen ohne Server-Bezug, damit das Seed-Skript sie laden kann.
 */
export const atDay = (offsetDays: number) => addDays(startOfDay(new Date()), offsetDays);
export const noonOf = (d: Date) => noon(dayKey(d));
