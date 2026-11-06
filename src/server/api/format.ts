import { z } from "zod";
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

/** Gemeinsame Bausteine der Körper-Schemas (vorher in jeder `api.ts` kopiert). */
/** Freitext mit Höchstlänge: darf fehlen oder `null` sein (`null` löscht das Feld). */
export const text = (max: number) => z.string().max(max).nullable().optional();
/** Text im Ergebnis, der `null` sein kann. */
export const nullableString = z.string().nullable();
/** Verweis auf eine andere Zeile (Kennung), optional und löschbar. */
export const optionalRef = z.string().max(64).nullable().optional();
/** Verweis auf eine andere Zeile (Kennung), Pflicht. */
export const requiredRef = z.string().min(1).max(64);
/** Wert aus einer Liste erlaubter Werte, sonst `fallback` (Zustandswerte aus der Datenbank in das Enum der Beschreibung bringen). */
export const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);

/** Ganze Cent → Text für die Geld-Eingabe der Operationen („12.50“; die Operationen lesen das über `parseMoneyToCents`). */
export const centsText = (cents: number): string => (cents / 100).toFixed(2);
