import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BASELINE_NAME } from "../lib/migration-guard";

/**
 * Eigener Migrations-Läufer: wendet die SQL-Dateien aus `prisma/migrations` auf die SQLite-Datei an und führt dieselbe
 * Tabelle `_prisma_migrations` wie die Prisma-CLI (gleiche Prüfsummen) – lokale Entwicklung mit `prisma migrate dev`
 * und der Betrieb in Docker bleiben dadurch kompatibel. Im Container gibt es keine Prisma-CLI, die App migriert sich selbst.
 *
 * Bewusst tolerant gegenüber „unbekannten“ angewendeten Migrationen: Nach einem Rückfall auf eine ältere App-Version kennt
 * der Code ggf. nicht alle Migrationen der Datenbank (Migrationen sind abwärtskompatibel zu schreiben).
 */

export type MigrationFile = { name: string; sql: string; checksum: string };

export class MigrationError extends Error {
  constructor(
    readonly code: "changed" | "failed" | "foreignKeys" | "foreignHistory",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Meldung bei fremder Migrationshistorie (Datenbank einer anderen, nicht verträglichen Version, z. B. 0.1.0): Die App startet dann
 * nicht, sondern bleibt mit Status „reinstall“ stehen (siehe startup.ts) – kein Absturz in Dauerschleife, nichts wird verändert.
 */
export const REINSTALL_MESSAGE =
  "Neuinstallation nötig: Die Datenbank stammt aus einer nicht verträglichen Version von SchrauberOS (fremde Migrationshistorie). " +
  "Es wurden keine Daten verändert. Bitte mit einem neuen, leeren Volume starten (alte Daten werden nicht übernommen) – " +
  "Reinstallation required: the database comes from an incompatible SchrauberOS version. No data was changed. Please start with a new, empty volume.";

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

export const migrationsDir = () => path.join(process.cwd(), "prisma", "migrations");

export function listMigrations(dir = migrationsDir()): MigrationFile[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_[\w-]+$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

/** Namen der in der Datenbank angewendeten Migrationen (leer, wenn die Datei noch nicht existiert). */
export function appliedMigrations(dbFile: string): string[] {
  let db: Database.Database;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    return (db.prepare(`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all() as { name: string }[]).map((r) => r.name);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function hasUserTables(db: Database.Database): boolean {
  return (db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`).get() as { n: number }).n > 0;
}

const timestamp = () => new Date().toISOString().replace("T", " ").replace("Z", "");

/**
 * Wendet offene Migrationen an und liefert deren Namen. `beforeApply` läuft einmal vor der ersten Migration (z. B. für
 * eine Sicherungskopie), aber nur, wenn tatsächlich etwas anzuwenden ist.
 */
export async function runMigrations(dbFile: string, dir = migrationsDir(), beforeApply?: (pending: string[]) => Promise<void> | void): Promise<string[]> {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  const files = listMigrations(dir);
  const db = new Database(dbFile);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 10000");
    db.exec(CREATE_TABLE);

    const applied = new Map(
      (db.prepare(`SELECT migration_name AS name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all() as { name: string; checksum: string }[]).map((r) => [r.name, r.checksum]),
    );
    // Fremde Historie: Die Datenbank hat eine Historie, die nicht mit unserer Baseline beginnt (andere Prüfsumme/Namen, z. B. 0.1.0),
    // oder Tabellen ganz ohne Historie. Unbekannte NEUERE Migrationen bleiben erlaubt (Rückfall auf eine ältere Version).
    const baseline = files.find((f) => f.name === BASELINE_NAME);
    if (baseline) {
      if (applied.size > 0 ? applied.get(BASELINE_NAME) !== baseline.checksum : hasUserTables(db)) throw new MigrationError("foreignHistory", REINSTALL_MESSAGE);
    }
    for (const f of files) {
      const known = applied.get(f.name);
      if (known && known !== f.checksum) throw new MigrationError("changed", `Die bereits angewendete Migration ${f.name} wurde verändert.`);
    }
    const pending = files.filter((f) => !applied.has(f.name));
    if (pending.length === 0) return [];

    await beforeApply?.(pending.map((f) => f.name));

    const insert = db.prepare(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)`);
    for (const f of pending) {
      // Empfohlenes Vorgehen für SQLite-Tabellenumbauten: Fremdschlüssel aus, in einer Transaktion ausführen, prüfen, wieder an
      db.pragma("foreign_keys = OFF");
      try {
        db.exec("BEGIN");
        const started = timestamp();
        db.exec(f.sql);
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (violations.length) throw new MigrationError("foreignKeys", `Migration ${f.name} verletzt Fremdschlüssel.`);
        insert.run(randomUUID(), f.checksum, timestamp(), f.name, started);
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* keine offene Transaktion */
        }
        if (error instanceof MigrationError) throw error;
        throw new MigrationError("failed", `Migration ${f.name} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        db.pragma("foreign_keys = ON");
      }
    }
    return pending.map((f) => f.name);
  } finally {
    db.close();
  }
}
