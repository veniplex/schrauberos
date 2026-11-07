import { isCalendarDay } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";

/**
 * Formate des Datenaustauschs – hier dokumentiert, in der Hilfe für Anwender beschrieben:
 *
 *  - **Trennzeichen** und **Dezimalzeichen** wählt der Export (`excel-de`: Semikolon und Komma, öffnet in deutschem Excel per Doppelklick; `international`: Komma und Punkt).
 *    Der Import erkennt das Trennzeichen selbst (Semikolon, Komma, Tabulator, senkrechter Strich) und liest Geld mit beiden Dezimalzeichen.
 *  - **Datum:** Export immer `JJJJ-MM-TT` (ISO 8601; eindeutig in jeder Sprache). Der Import versteht zusätzlich `TT.MM.JJJJ`.
 *  - **Geld:** ganze Cent intern, im Export als Dezimalzahl mit zwei Nachkommastellen ohne Tausendertrenner und ohne Währungszeichen (`1234,56`; negativ mit Minus). Import über
 *    `parseMoneyToCents` (versteht `1.234,56`, `1234.56`, `12,5 €`).
 *  - **Zeichensatz:** Export UTF-8 mit Byte-Order-Mark (Excel erkennt Umlaute sonst nicht). Der Import erkennt UTF-8 (mit/ohne BOM), UTF-16 (mit BOM) und fällt sonst auf Windows-1252 zurück.
 *  - **Zeilenende:** Export CRLF (RFC 4180); der Import liest CRLF, LF und CR.
 */
export type CsvFormat = { delimiter: ";" | "," | "\t"; decimal: "," | "." };

export const CSV_FORMATS = {
  "excel-de": { delimiter: ";", decimal: "," },
  international: { delimiter: ",", decimal: "." },
} as const satisfies Record<string, CsvFormat>;
export type CsvFormatId = keyof typeof CSV_FORMATS;
export const CSV_FORMAT_IDS = Object.keys(CSV_FORMATS) as CsvFormatId[];

export const isCsvFormatId = (value: unknown): value is CsvFormatId => typeof value === "string" && value in CSV_FORMATS;

/** Voreinstellung nach Sprache der Oberfläche: Deutsch → Excel-Format, sonst international. */
export const defaultFormatId = (locale: string): CsvFormatId => (locale === "de" ? "excel-de" : "international");

/** Cent → `1234,56` bzw. `1234.56` (nur Ziffern, Vorzeichen und Dezimalzeichen – kein Text, deshalb ohne Formelschutz zu schreiben). */
export function formatCents(cents: number, format: CsvFormat): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return (negative ? "-" : "") + text.replace(".", format.decimal);
}

/** Zahl mit Nachkommastellen (Profiltiefe) → Text mit dem Dezimalzeichen des Formats. */
export function formatDecimal(value: number, format: CsvFormat): string {
  return String(value).replace(".", format.decimal);
}

/** Kalendertag (lokale Mitternacht oder Mittag, wie die Anwendung ihn speichert) → `JJJJ-MM-TT`. */
export function formatDay(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  return `${y}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** `JJJJ-MM-TT` oder `TT.MM.JJJJ` (auch `T.M.JJJJ`) → `JJJJ-MM-TT`, sonst `null`; ungültige Tage (30. Februar) sind `null`. */
export function parseDay(text: string): string | null {
  const value = text.trim();
  let iso: string | null = null;
  const a = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const b = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (a) iso = `${a[1]}-${a[2].padStart(2, "0")}-${a[3].padStart(2, "0")}`;
  else if (b) iso = `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}`;
  return iso && isCalendarDay(iso) ? iso : null;
}

/** Geld → ganze Cent (`parseMoneyToCents`), `null` bei ungültiger Eingabe. */
export const parseCents = (text: string): number | null => parseMoneyToCents(text);

/** Ganze Zahl; Tausendertrenner (Punkt, Leerzeichen, Apostroph) sind erlaubt. */
export function parseInteger(text: string): number | null {
  const digits = text.trim().replace(/[.\s']/g, "");
  return /^-?\d{1,12}$/.test(digits) ? Number(digits) : null;
}

/** Dezimalzahl mit Komma oder Punkt (`4,5`, `4.5`); `null` bei ungültiger Eingabe. */
export function parseDecimal(text: string): number | null {
  const value = text.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}
