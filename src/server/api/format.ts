import { toDateInput } from "@/lib/dates";

/** Darstellung von Werten in der API: Zeitpunkte als ISO 8601 (UTC), Kalendertage als `JJJJ-MM-TT` (Zeitzone der Werkstatt), Geld als ganze Cent. */
export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const dayOrNull = (d: Date | null | undefined): string | null => (d ? toDateInput(d) : null);
