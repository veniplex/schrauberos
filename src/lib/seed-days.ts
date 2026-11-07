import { addDays, startOfDay } from "date-fns";

/**
 * Tagesrechnung der Demo-Daten (nur für Seeds): „heute plus N Tage“ und das Mittagsdatum eines Tages (so speichert die Anwendung Kalendertage, siehe `noon()` in `dates.ts`).
 * Reine Hilfsfunktionen ohne Server-Bezug, damit das Seed-Skript sie laden kann.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const atDay = (offsetDays: number) => addDays(startOfDay(new Date()), offsetDays);
export const noonOf = (d: Date) => new Date(`${iso(d)}T12:00:00`);
