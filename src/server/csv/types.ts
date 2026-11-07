import type { AuditAction } from "@/lib/audit-actions";
import type { MessageKey, Translator } from "@/i18n/translate";
import type { FeatureId, Permission } from "@/modules/catalog";
import type { AppSession } from "@/server/auth/session";
import type { Operation } from "@/server/operations";
import type { CsvFormat } from "./format";
import type { ImportPlan } from "./import";
import type { ColumnSpec, ReadTable } from "./table";
import type { Cell } from "./writer";

/** Eingabe der Import-Operation: die Datei (nur im Speicher, nie auf der Platte) und die Optionen aus der Vorschau. */
export type ImportInput = { bytes: Uint8Array; allowDuplicates: boolean; skipErrors: boolean };
export type ImportResult = { created: number; skipped: number; errors: number };

/** Ein Import einer Funktion (Kunden, Fahrzeuge …), eingesammelt in `src/modules/exchange.ts`. Gebaut mit `defineImport`. */
export type ImportDef = {
  /** Adresse: `/api/exchange/<id>/import` */
  id: string;
  feature: FeatureId;
  permission: Permission;
  /** „Dubletten trotzdem anlegen“ wird angeboten (Fahrzeuge, Reifensätze); sonst werden Dubletten immer übersprungen */
  duplicateOverride: boolean;
  /** Die Spalten, die dieser Person gegenüber gelten (Spalten fremder Daten nur mit dem Recht dazu) */
  columns(session: AppSession): ColumnSpec[];
  /** Vorschau: dieselbe Auswertung wie beim Anwenden, aber nur lesend */
  preview(session: AppSession, table: ReadTable, options: { allowDuplicates: boolean }): Promise<ImportPlan<unknown>>;
  /** Anwenden: eine Transaktion, Audit mit Anzahl */
  operation: Operation<ImportInput, ImportResult>;
};

export type ExportOpened = {
  /** Spalten in der Reihenfolge der Zeilen; die Überschrift ist die Beschriftung in der Sprache der Person */
  columns: ReadonlyArray<{ labelKey: MessageKey }>;
  /** Anzahl der Zeilen (vorab gezählt – für Grenze und Audit) */
  count: number;
  /** für das Audit-Log, zum Beispiel der Zeitraum */
  target: string;
  rows: AsyncIterable<Cell[]>;
};

/** Ein Export einer Funktion, eingesammelt in `src/modules/exchange.ts`. */
export type ExportDef = {
  /** Adresse: `/api/exchange/<id>` */
  id: string;
  feature: FeatureId;
  permission: Permission;
  /** weitere Rechte, ohne die nichts ausgeliefert wird (Exportieren heißt: die Daten ansehen dürfen) */
  also: readonly Permission[];
  audit: AuditAction;
  /** Dateiname mit Endung */
  filename(query: URLSearchParams): string;
  open(context: { session: AppSession; query: URLSearchParams; format: CsvFormat; t: Translator["t"] }): Promise<ExportOpened | { error: MessageKey }>;
};

/* ───────────── Antwort der Import-Vorschau (JSON, Anzeige in `components/exchange/import-panel.tsx`) ───────────── */

export type PreviewRow = { line: number; status: "create" | "duplicate" | "error"; label: string; messages: string[]; forced: boolean };
export type PreviewResponse = {
  mode: "preview";
  digest: string;
  encoding: string;
  delimiter: string;
  columns: Array<{ header: string; label: string | null; note: string | null }>;
  missing: string[];
  counts: { rows: number; create: number; duplicate: number; error: number; forced: number };
  formulaLike: number;
  rows: PreviewRow[];
  truncated: boolean;
  /** Es gibt etwas anzulegen und keine Pflichtspalte fehlt (Zeilenfehler verhindern das Anwenden nur, solange „fehlerhafte Zeilen überspringen“ nicht gewählt ist) */
  canApply: boolean;
};
