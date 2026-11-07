import type { MessageKey, Vars } from "@/i18n/translate";
import type { ColumnSpec, ReadTable } from "./table";

/**
 * Die Auswertung eines Imports – dieselbe Rechnung für die **Vorschau** (lesend) und für die **Anwendung** (in der Transaktion), damit beide dasselbe zeigen und tun.
 * Reine Logik über einem frei wählbaren Datenbank-Client: Die Funktion kennt weder Prisma noch Next.js und lässt sich mit einem Attrappen-Client testen.
 *
 * Entscheidung (konservativ, dokumentiert in README und Hilfe): Ein Import **legt nur neue Datensätze an**. Bestehende werden nie geändert (kein Überschreiben, keine
 * Versionskonflikte, keine Rechteausweitung durch einen Umweg); Dubletten werden übersprungen – bei Fahrzeugen und Reifensätzen kann man sie bewusst trotzdem anlegen
 * (wie die Warnung mit Bestätigung in der Oberfläche).
 */
/** Meldung zu einer Zeile; `column` nennt die Spalte, auf die sie sich bezieht (die Anzeige stellt ihre Beschriftung voran). */
export type RowMessage = { key: MessageKey; params?: Vars; column?: string };

/** Ergebnis der Prüfung einer Zeile gegen die Datenbank. */
export type RowCheck = { kind: "error"; message: RowMessage } | { kind: "duplicate"; message: RowMessage };

export type ParseResult<T> = { ok: true; data: T } | { ok: false; messages: RowMessage[] };

export type ImportSpec<T, C> = {
  /** Spalten, die diese Auswertung kennt (kann vom Nutzer abhängen: Spalten fremder Daten nur mit dem Recht dazu) */
  columns: readonly ColumnSpec[];
  /** Eine Zeile prüfen und in die Form der Datenbank bringen. Rein (keine Datenbank). */
  parse(values: Record<string, string>): ParseResult<T>;
  /** Alle gültigen Zeilen gegen die Datenbank prüfen (Verweise, Dubletten). Ein Aufruf für die ganze Datei; Zeilen ohne Eintrag sind in Ordnung. */
  check(client: C, rows: ReadonlyArray<{ index: number; data: T }>): Promise<Map<number, RowCheck>>;
  /** Schlüssel, an denen sich Dubletten **innerhalb der Datei** erkennen lassen (gleicher Schlüssel = Dublette der früheren Zeile) */
  fileKeys?(data: T): string[];
  /** Kurze Bezeichnung der Zeile für die Vorschau („Meier, Anna“, „B-AB 1234“) */
  label(data: T): string;
};

export type PlannedRow<T> = {
  line: number;
  status: "create" | "duplicate" | "error";
  label: string;
  /** nur bei `create` */
  data?: T;
  messages: RowMessage[];
  /** Dublette, die trotzdem angelegt wird (Auswahl „Dubletten trotzdem anlegen“) */
  forced?: boolean;
};

export type ImportCounts = { rows: number; create: number; duplicate: number; error: number; forced: number };

export type ImportPlan<T> = {
  table: Omit<ReadTable, "records">;
  rows: PlannedRow<T>[];
  counts: ImportCounts;
};

const IN_FILE: RowMessage = { key: "exchange.row.duplicateInFile" };

export async function evaluateImport<T, C>(spec: ImportSpec<T, C>, client: C, table: ReadTable, options: { allowDuplicates: boolean }): Promise<ImportPlan<T>> {
  const rows: PlannedRow<T>[] = new Array(table.records.length);
  const valid: Array<{ index: number; data: T }> = [];
  table.records.forEach((record, index) => {
    const parsed = spec.parse(record.values);
    if (parsed.ok) {
      valid.push({ index, data: parsed.data });
      rows[index] = { line: record.line, status: "create", label: spec.label(parsed.data), data: parsed.data, messages: [] };
    } else {
      rows[index] = { line: record.line, status: "error", label: Object.values(record.values).slice(0, 2).join(" · "), messages: parsed.messages };
    }
  });

  const checks = valid.length > 0 ? await spec.check(client, valid) : new Map<number, RowCheck>();
  const seen = new Set<string>();
  for (const { index, data } of valid) {
    const row = rows[index];
    const check = checks.get(index);
    const dup = check?.kind === "duplicate" ? check.message : spec.fileKeys?.(data).some((k) => seen.has(k)) ? IN_FILE : null;
    if (check?.kind === "error") {
      Object.assign(row, { status: "error", messages: [check.message], data: undefined });
      continue;
    }
    if (dup) {
      row.messages = [dup];
      if (options.allowDuplicates) row.forced = true;
      else {
        row.status = "duplicate";
        row.data = undefined;
        continue;
      }
    }
    for (const key of spec.fileKeys?.(data) ?? []) seen.add(key);
  }

  const { records: _records, ...rest } = table;
  void _records;
  const counts: ImportCounts = { rows: rows.length, create: 0, duplicate: 0, error: 0, forced: 0 };
  for (const row of rows) {
    counts[row.status]++;
    if (row.forced) counts.forced++;
  }
  return { table: rest, rows, counts };
}
