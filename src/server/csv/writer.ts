import { formatCents, formatDecimal, type CsvFormat } from "./format";

/** Ein vom Programm erzeugter Wert (Zahl, Datum, Betrag), der **nicht** vom Formelschutz angefasst wird – ein Minuszeichen gehört bei `-12,50` zur Zahl. */
export type Raw = { readonly raw: string };
export const raw = (text: string): Raw => ({ raw: text });

/** Zelle eines Exports: Text (vom Nutzer erfasst → Formelschutz), `Raw` (vom Programm erzeugt) oder leer. */
export type Cell = string | Raw | null | undefined;

export const moneyCell = (cents: number | null | undefined, format: CsvFormat): Cell => (cents == null ? null : raw(formatCents(cents, format)));
export const intCell = (value: number | null | undefined): Cell => (value == null ? null : raw(String(Math.trunc(value))));
export const decimalCell = (value: number | null | undefined, format: CsvFormat): Cell => (value == null ? null : raw(formatDecimal(value, format)));

/**
 * Schutz vor **Formel-Injektion** (CSV-Injection): Excel, LibreOffice und Google Tabellen führen Zellen aus, die mit `=`, `+`, `-`, `@`, Tabulator oder Wagenrücklauf beginnen
 * (`=HYPERLINK(...)`, `=cmd|' /C calc'!A0`). Ein Name oder eine Notiz, die ein Kunde oder ein Lieferant erfasst hat, darf so nicht zur Formel werden: Ein vorangestelltes
 * einfaches Anführungszeichen macht die Zelle zu Text (auch ein Text, der selbst mit `'=` beginnt, bekommt eines, damit die Rücknahme eindeutig bleibt). Der Import nimmt genau dieses Zeichen wieder weg (`undoFormulaGuard`), damit ein Export-Import-Kreislauf die Werte nicht verändert.
 */
export const FORMULA_START = /^'*[=+\-@\t\r]/;
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Gegenstück zu `neutralizeFormula` beim Import: nimmt ein davor gesetztes `'` weg, wenn dahinter ein Formelzeichen folgt. Alles andere bleibt, wie es ist. */
export function undoFormulaGuard(text: string): string {
  return text.startsWith("'") && FORMULA_START.test(text) ? text.slice(1) : text;
}

/** Ein Feld für das Trennzeichen schreiben: bei Bedarf in Anführungszeichen (Trennzeichen, Anführungszeichen, Zeilenumbruch, führendes/abschließendes Leerzeichen). */
export function csvField(cell: Cell, delimiter: string): string {
  if (cell == null) return "";
  const text = typeof cell === "string" ? neutralizeFormula(cell) : cell.raw;
  return /["\r\n]/.test(text) || text.includes(delimiter) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: readonly Cell[], delimiter: string): string {
  return cells.map((cell) => csvField(cell, delimiter)).join(delimiter);
}

export const CSV_BOM = "﻿";
export const CSV_EOL = "\r\n";

/**
 * Schreibt die Datei in Stücken (Strom): zuerst Byte-Order-Mark (falls gewünscht) und Kopfzeile, dann die Zeilen in Gruppen von `chunkLines` – ein Export von 100 000 Zeilen liegt nie
 * ganz im Speicher. `rows` darf ein asynchroner Iterator sein (Seite für Seite aus der Datenbank).
 */
export async function* csvChunks(
  header: readonly string[],
  rows: AsyncIterable<readonly Cell[]> | Iterable<readonly Cell[]>,
  format: CsvFormat,
  options: { bom?: boolean; chunkLines?: number } = {},
): AsyncGenerator<string> {
  const { delimiter } = format;
  yield (options.bom === false ? "" : CSV_BOM) + csvLine(header, delimiter) + CSV_EOL;
  const per = options.chunkLines ?? 200;
  let buffer = "";
  let lines = 0;
  for await (const row of rows) {
    buffer += csvLine(row, delimiter) + CSV_EOL;
    if (++lines >= per) {
      yield buffer;
      buffer = "";
      lines = 0;
    }
  }
  if (buffer) yield buffer;
}
