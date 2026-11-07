import { CSV_LIMITS } from "./limits";

export type CsvErrorCode = "binary" | "empty" | "unterminatedQuote" | "tooManyRows" | "tooManyColumns" | "fieldTooLong" | "tooLarge" | "noHeader";

/** Dateifehler beim Lesen: `line` ist die (1-basierte) Zeile, in der das Problem liegt. */
export class CsvError extends Error {
  constructor(
    readonly code: CsvErrorCode,
    readonly line: number,
  ) {
    super(code);
  }
}

export type ParseOptions = {
  /** Trennzeichen; ohne Angabe wird es aus der ersten Zeile erkannt (`detectDelimiter`) */
  delimiter?: string;
  /** Höchstzahl Datensätze (nicht leere Zeilen, mit Kopfzeile) */
  maxRows?: number;
  maxColumns?: number;
  /** Höchstzahl Zeichen je Feld */
  maxFieldChars?: number;
};

export type ParsedCsv = {
  delimiter: string;
  /** nicht leere Datensätze; `rows[i]` beginnt in Zeile `lines[i]` der Datei */
  rows: string[][];
  lines: number[];
};

const DELIMITERS = [";", ",", "\t", "|"] as const;

/**
 * Trennzeichen aus der ersten Zeile (außerhalb von Anführungszeichen): das häufigste von `;` `,` Tabulator `|`. Gleichstand oder keines → Semikolon (der deutsche Standard von Excel).
 * Nur die Kopfzeile zählt – Datenzeilen enthalten Kommas in Dezimalzahlen und Adressen.
 */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  const end = Math.min(text.length, 64 * 1024);
  for (let i = 0; i < end; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (Array.from(counts.values()).some((n) => n > 0)) break; // erste nicht leere Zeile ist zu Ende
    } else if (!quoted && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = ";";
  let max = 0;
  for (const d of DELIMITERS) {
    const n = counts.get(d) ?? 0;
    if (n > max) {
      max = n;
      best = d;
    }
  }
  return best;
}

/**
 * RFC-4180-Leser mit den Gepflogenheiten von Excel:
 *  - Felder in Anführungszeichen dürfen Trennzeichen, Zeilenumbrüche und doppelte Anführungszeichen (`""`) enthalten;
 *  - ein Anführungszeichen mitten in einem Feld ohne Anführung bleibt Text (Zoll-Angaben wie `16"`);
 *  - Text nach dem schließenden Anführungszeichen wird angehängt (Excel schreibt das nie, Handarbeit schon);
 *  - Zeilenende CRLF, LF oder einzelnes CR; ein Zeilenende am Dateiende erzeugt keinen leeren Datensatz;
 *  - ganz leere Zeilen werden übersprungen (ihre Nummer zählt trotzdem mit);
 *  - Grenzen (`CSV_LIMITS`): Datensätze, Spalten, Zeichen je Feld → `CsvError`. Ein nicht geschlossenes Anführungszeichen ist ein Fehler (`unterminatedQuote`), kein stilles Verschlucken der Rest-Datei.
 * Die Byte-Order-Mark muss vorher entfernt sein (`decodeCsv`).
 */
export function parseCsv(text: string, options: ParseOptions = {}): ParsedCsv {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const maxRows = options.maxRows ?? CSV_LIMITS.importRows + 1;
  const maxColumns = options.maxColumns ?? CSV_LIMITS.columns;
  const maxField = options.maxFieldChars ?? CSV_LIMITS.fieldChars;
  const rows: string[][] = [];
  const lines: number[] = [];

  let row: string[] = [];
  let field = "";
  let line = 1;
  let rowLine = 1;
  let sawContent = false; // der Datensatz hat überhaupt etwas (Trennzeichen oder Zeichen)
  let i = 0;
  const n = text.length;

  const pushField = () => {
    if (field.length > maxField) throw new CsvError("fieldTooLong", rowLine);
    row.push(field);
    if (row.length > maxColumns) throw new CsvError("tooManyColumns", rowLine);
    field = "";
  };
  const endRow = () => {
    pushField();
    if (sawContent || row.length > 1 || row[0] !== "") {
      if (rows.length >= maxRows) throw new CsvError("tooManyRows", rowLine);
      rows.push(row);
      lines.push(rowLine);
    }
    row = [];
    sawContent = false;
  };

  while (i < n) {
    const c = text[i];
    if (c === '"' && field === "") {
      // Feld in Anführungszeichen
      sawContent = true;
      const startLine = line;
      i++;
      for (;;) {
        if (i >= n) throw new CsvError("unterminatedQuote", startLine);
        const d = text[i];
        if (d === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          if (d === "\n") line++;
          else if (d === "\r" && text[i + 1] !== "\n") line++;
          field += d;
          i++;
          if (field.length > maxField) throw new CsvError("fieldTooLong", rowLine);
        }
      }
      continue;
    }
    if (c === delimiter) {
      sawContent = true;
      pushField();
      i++;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      i++;
      line++;
      rowLine = line;
    } else {
      field += c;
      sawContent = true;
      i++;
      if (field.length > maxField) throw new CsvError("fieldTooLong", rowLine);
    }
  }
  if (sawContent || field !== "" || row.length > 0) endRow();
  return { delimiter, rows, lines };
}
