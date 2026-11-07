import "server-only";
import { z } from "zod";
import type { AuditAction } from "@/lib/audit-actions";
import type { Permission } from "@/modules/catalog";
import type { FeatureId } from "@/modules/catalog";
import type { AppSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { defineOperation, fail, type Tx } from "@/server/operations";
import { evaluateImport, type ImportSpec } from "./import";
import { CSV_LIMITS } from "./limits";
import { CsvError, type CsvErrorCode } from "./reader";
import { readTable, type ColumnSpec } from "./table";
import type { ImportDef, ImportInput, ImportResult } from "./types";

/** Meldungsschlüssel eines Dateifehlers (`exchange.errors.file.<code>`). */
export const fileErrorKey = (code: CsvErrorCode) => `exchange.errors.file.${code}` as const;
/** Platzhalter der Dateifehler: die Zeile und die Grenzen (aus `CSV_LIMITS`, damit Text und Wirklichkeit übereinstimmen). */
export const fileErrorParams = (line = 1) => ({ line, rows: CSV_LIMITS.importRows, columns: CSV_LIMITS.columns, chars: CSV_LIMITS.fieldChars, size: `${CSV_LIMITS.importBytes / 1024 / 1024} MB` });

export type ImportDefinition<T> = {
  id: string;
  feature: FeatureId;
  permission: Permission;
  /** Name der Operation, z. B. `customers.import` */
  operationName: string;
  audit: AuditAction;
  duplicateOverride?: boolean;
  columns(session: AppSession): readonly ColumnSpec[];
  parse: ImportSpec<T, Tx>["parse"];
  check: ImportSpec<T, Tx>["check"];
  fileKeys?: ImportSpec<T, Tx>["fileKeys"];
  label: ImportSpec<T, Tx>["label"];
  /** Legt die neuen Datensätze an (innerhalb der Transaktion des Imports) */
  create(tx: Tx, rows: T[], session: AppSession): Promise<void>;
};

const inputSchema = z.object({
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  allowDuplicates: z.boolean(),
  skipErrors: z.boolean(),
});

/**
 * Baut aus der Beschreibung eines Imports die Vorschau und die Operation. Die Operation läuft im Aktions-Rahmen (Recht, **eine Transaktion**, Audit mit Anzahl – keine Änderung
 * ohne Eintrag): Alle Zeilen oder keine; ein Fehler in der Mitte rollt alles zurück. Die Datei wird in `prepare` gelesen (reine Rechnung, außerhalb der Transaktion), die Prüfung
 * gegen die Datenbank und das Anlegen laufen in der Transaktion – zwei gleichzeitige Importe derselben Datei sehen sich also (der zweite überspringt alles als Dubletten).
 */
export function defineImport<T>(def: ImportDefinition<T>): ImportDef {
  const spec = (session: AppSession): ImportSpec<T, Tx> => ({ columns: def.columns(session), parse: def.parse, check: def.check, fileKeys: def.fileKeys, label: def.label });

  const operation = defineOperation({
    name: def.operationName,
    permission: def.permission,
    input: inputSchema,
    audit: def.audit,
    prepare: async ({ input, principal }) => {
      try {
        return readTable(input.bytes, def.columns(principal));
      } catch (error) {
        if (error instanceof CsvError) fail("invalid", fileErrorKey(error.code), fileErrorParams(error.line));
        throw error;
      }
    },
    run: async ({ input, principal, prepared, tx, audit }): Promise<ImportResult> => {
      if (prepared.missing.length > 0) fail("invalid", "exchange.errors.missingColumns");
      const plan = await evaluateImport(spec(principal), tx, prepared, { allowDuplicates: input.allowDuplicates });
      if (plan.counts.error > 0 && !input.skipErrors) fail("invalid", "exchange.errors.rowErrors", { count: plan.counts.error });
      const rows = plan.rows.flatMap((row) => (row.status === "create" && row.data !== undefined ? [row.data] : []));
      if (rows.length === 0) fail("invalid", "exchange.errors.nothingToImport");
      await def.create(tx, rows, principal);
      audit({ target: `${rows.length} neu, ${plan.counts.duplicate} übersprungen, ${plan.counts.error} fehlerhaft` });
      return { created: rows.length, skipped: plan.counts.duplicate, errors: plan.counts.error };
    },
  });

  return {
    id: def.id,
    feature: def.feature,
    permission: def.permission,
    duplicateOverride: def.duplicateOverride ?? false,
    columns: (session) => [...def.columns(session)],
    preview: (session, table, options) => evaluateImport(spec(session), db, table, options),
    operation: operation as unknown as ImportDef["operation"],
  };
}

export type { ImportInput };
