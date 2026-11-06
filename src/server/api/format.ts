import { toDateInput } from "@/lib/dates";
import { dateText } from "@/lib/zod-fields";

/** Darstellung von Werten in der API: Zeitpunkte als ISO 8601 (UTC), Kalendertage als `JJJJ-MM-TT` (Zeitzone der Werkstatt), Geld als ganze Cent. */
export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const dayOrNull = (d: Date | null | undefined): string | null => (d ? toDateInput(d) : null);
export const day = (d: Date): string => toDateInput(d);

/** Kalendertag `JJJJ-MM-TT` (Eingabe): ein echter Tag – `2026-13-45` und `2026-02-30` sind 422, nicht 500 und nicht still der 2. März. */
export const dateOnly = dateText();
export const optionalDate = dateOnly.nullable().optional();

/** Ganze Cent → Text für die Geld-Eingabe der Operationen („12.50“; die Operationen lesen das über `parseMoneyToCents`). */
export const centsText = (cents: number): string => (cents / 100).toFixed(2);
