import type { MessageKey } from "@/i18n/translate";
import { decodeCsv, type CsvEncoding } from "./decode";
import { CSV_LIMITS } from "./limits";
import { CsvError, parseCsv } from "./reader";
import { undoFormulaGuard } from "./writer";

/** Eine Spalte, die ein Import kennt. `names`: alle Schreibweisen der Überschrift (Beschriftungen beider Sprachen, der technische Schlüssel, übliche Kürzel). */
export type ColumnSpec = {
  key: string;
  /** Beschriftung (Export-Überschrift, Anzeige in der Vorschau) */
  labelKey: MessageKey;
  names: readonly string[];
  required?: boolean;
  /** Zeilenumbrüche im Feld bleiben erhalten (Notizen); sonst werden sie zu Leerzeichen */
  multiline?: boolean;
};

/** Überschrift vergleichbar machen: Kleinbuchstaben, Umlaute und Akzente ohne Zeichen, `ß` → `ss`, nur Buchstaben und Ziffern („E-Mail“, „E-mail“ und „email“ sind dieselbe Spalte). */
export function normalizeHeader(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export type HeaderInfo = {
  /** Überschrift wie in der Datei */
  header: string;
  /** zugeordnete Spalte oder `null` (nicht übernommen) */
  key: string | null;
  /** Warum nicht übernommen: unbekannte Spalte oder dieselbe Spalte steht schon weiter links */
  reason?: "unknown" | "duplicate";
};

export type TableRecord = {
  /** Zeile in der Datei (1-basiert, Kopfzeile = erste nicht leere Zeile) */
  line: number;
  values: Record<string, string>;
};

export type ReadTable = {
  encoding: CsvEncoding;
  delimiter: string;
  headers: HeaderInfo[];
  /** Pflichtspalten, die in der Datei fehlen */
  missing: string[];
  records: TableRecord[];
  /** Zellen, die wie eine Formel beginnen (`=`, `@`, `+Text` …) – sie werden als Text übernommen, die Vorschau weist darauf hin */
  formulaLike: number;
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FORMULA_LIKE = /^\s*(?:[=@]|[+\-](?![\d.,\s€]))/;

/** Wert einer Zelle bereinigen: Schutz-Anführungszeichen des Exports entfernen, Steuerzeichen entfernen, Zeilenumbrüche je nach Spalte, Leerraum kürzen. */
export function cleanValue(rawValue: string, multiline: boolean): string {
  let value = undoFormulaGuard(rawValue).replace(CONTROL, "");
  value = multiline ? value.replace(/\r\n?/g, "\n").replace(/\t/g, " ") : value.replace(/\s*[\r\n]+\s*/g, " ").replace(/\t/g, " ");
  return value.trim();
}

/**
 * Datei → Tabelle: Zeichensatz erkennen, lesen, Überschriften den Spalten zuordnen, Zellen bereinigen. Reine Funktion (keine Datenbank). Wirft `CsvError` bei Dateifehlern
 * (zu groß, leer, binär, nicht geschlossenes Anführungszeichen, Grenzen aus `CSV_LIMITS`, keine bekannte Spalte). Fehlende Pflichtspalten stehen in `missing`; ob das ein Fehler ist,
 * entscheidet der Aufrufer (die Vorschau zeigt sie an).
 */
export function readTable(bytes: Uint8Array, specs: readonly ColumnSpec[]): ReadTable {
  if (bytes.length > CSV_LIMITS.importBytes) throw new CsvError("tooLarge", 1);
  if (bytes.length === 0) throw new CsvError("empty", 1);
  const { text, encoding } = decodeCsv(bytes);
  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) throw new CsvError("empty", 1);

  const byName = new Map<string, ColumnSpec>();
  for (const spec of specs) for (const name of [spec.key, ...spec.names]) byName.set(normalizeHeader(name), spec);

  const used = new Set<string>();
  const headers: HeaderInfo[] = parsed.rows[0].map((header) => {
    const spec = byName.get(normalizeHeader(header));
    if (!spec) return { header, key: null, reason: "unknown" as const };
    if (used.has(spec.key)) return { header, key: null, reason: "duplicate" as const };
    used.add(spec.key);
    return { header, key: spec.key };
  });
  if (used.size === 0) throw new CsvError("noHeader", parsed.lines[0]);

  const missing = specs.filter((s) => s.required && !used.has(s.key)).map((s) => s.key);
  const multiline = new Map(specs.map((s) => [s.key, !!s.multiline]));
  let formulaLike = 0;
  const records: TableRecord[] = [];
  for (let r = 1; r < parsed.rows.length; r++) {
    const cells = parsed.rows[r];
    const values: Record<string, string> = {};
    headers.forEach((info, c) => {
      if (!info.key || c >= cells.length) return;
      if (FORMULA_LIKE.test(cells[c])) formulaLike++;
      const value = cleanValue(cells[c], multiline.get(info.key) ?? false);
      if (value !== "") values[info.key] = value;
    });
    if (Object.keys(values).length > 0) records.push({ line: parsed.lines[r], values });
  }
  return { encoding, delimiter: parsed.delimiter, headers, missing, records, formulaLike };
}
