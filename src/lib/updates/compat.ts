/**
 * Kompatibilitätsschranke für den Rückfall (Sicherheitsgutachten F2): Fällt der Starter von einer **bewährten** Version auf eine ältere (die Vorversion oder die im Image
 * eingebaute) zurück, kann die Datenbank schon Migrationen kennen, die der ältere Code nicht kennt. „Nur additiv“ garantiert Verträglichkeit zur **Vorversion** (die
 * Rücknahme eines frischen, noch unbestätigten Updates ist so gebaut), nicht zu einem Stand, der Monate zurückliegt. Dann startet der Launcher die App **nicht**, statt
 * still auf einem Schema weiterzulaufen, das sie nicht versteht: gesteuert stoppen, klare Meldung im Log („Image aktualisieren“).
 *
 * Reine Funktionen; das Lesen der Datenbank (`better-sqlite3`) kommt als Funktion von außen, damit der Launcher es lazy und mit Rückfall nutzen kann.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

const MIGRATION_NAME = /^\d{14}_[\w-]+$/;

/** Namen der Migrationen, die ein Paket (oder die eingebaute App) mitbringt: Ordner unter `prisma/migrations`. */
export function knownMigrations(appDir: string): string[] {
  try {
    return readdirSync(path.join(appDir, "prisma", "migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && MIGRATION_NAME.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Angewendete Migrationen, die `known` nicht enthält. */
export const unknownMigrations = (applied: readonly string[], known: readonly string[]): string[] => {
  const set = new Set(known);
  return applied.filter((name) => !set.has(name));
};

export type BarrierInput = {
  /** In der Datenbank angewendete Migrationen; `null`, wenn sie nicht lesbar waren (dann kein Urteil: die Schranke ist kein Grund, einen Start zu verhindern, den die App selbst prüft) */
  applied: readonly string[] | null;
  /** Migrationen des Pakets, auf das zurückgefallen wird */
  known: readonly string[];
  /** Die Version, von der zurückgefallen wird, war bereits als gesund bestätigt (nicht mehr `pending`) */
  fromConfirmed: boolean;
};

/**
 * Die unbekannten Migrationen, wenn der Rückfall blockiert werden muss (sonst leer): nur beim Rückfall von einer **bestätigten** Version – eine frische, noch nicht
 * bestätigte (`pending`) ist nie lange gelaufen, ihre Migrationen sind nach der Regel „additiv, zur Vorversion kompatibel“ zu schreiben, ihre Rücknahme ist der vorgesehene Weg.
 */
export function blockedMigrations({ applied, known, fromConfirmed }: BarrierInput): string[] {
  if (!applied || !fromConfirmed) return [];
  return unknownMigrations(applied, known);
}

type Row = { name: string };
export interface MigrationDb {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

/** Liest die angewendeten Migrationen **nur lesend** aus der SQLite-Datei; `null`, wenn es die Datei nicht gibt oder sie nicht lesbar ist. */
export function readAppliedMigrations(dbFile: string, open: (file: string) => MigrationDb): string[] | null {
  let db: MigrationDb;
  try {
    db = open(dbFile);
  } catch {
    return null;
  }
  try {
    return (db.prepare(`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all() as Row[]).map((r) => r.name);
  } catch {
    return null;
  } finally {
    db.close();
  }
}
