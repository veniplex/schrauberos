import "server-only";
import { createBackup } from "@/server/backup/core";
import { startBackupScheduler } from "@/server/backup/scheduler";
import { db } from "@/server/db";
import { databaseFile } from "@/server/db-client";
import { appliedMigrations, runMigrations } from "@/server/migrate";
import { ensureBaseData } from "@/server/seed/base";
import { ensureSetupToken } from "@/server/setup-token";

/** Zustand des App-Starts; /api/health meldet erst „ok“, wenn die Datenbank bereit ist. */
export type StartupState = { status: "starting" | "ready" | "failed"; error?: string };

const globalForStartup = globalThis as unknown as { __startup?: StartupState };
export const startupState = (): StartupState => (globalForStartup.__startup ??= { status: "starting" });

/** Ist das ein gültiger Zeitzonen-Name? Ändert nichts. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wendet die Zeitzone der Werkstatt auf den Prozess an (Termine u. a. rechnen in lokaler Zeit). Aktionen prüfen vorher mit
 * `isValidTimezone` und rufen dies erst auf, wenn gespeichert ist – ein abgebrochener Vorgang ändert die Zeitzone nie.
 */
export function applyTimezone(timezone: string): boolean {
  if (!isValidTimezone(timezone)) return false;
  process.env.TZ = timezone;
  return true;
}

/**
 * Bereitet die Datenbank vor: Sicherungskopie vor Migrationen, Migrationen, Basisdaten, Zeitzone, Zeitplan der Backups.
 * Scheitert etwas, beendet sich der Prozess – der Launcher erkennt das und fällt bei einem frischen Update zurück.
 */
export async function startApp(): Promise<void> {
  const state = startupState();
  try {
    const file = databaseFile();
    // Nur eine bestehende Datenbank wird vor Migrationen gesichert (eine frische hat nichts zu verlieren)
    const hadData = appliedMigrations(file).length > 0;
    const applied = await runMigrations(file, undefined, async () => {
      if (hadData) await createBackup("pre-migration", file).catch((error) => console.error("[start] Sicherung vor Migration fehlgeschlagen:", error));
    });
    if (applied.length) console.log(`[start] Migrationen angewendet: ${applied.join(", ")}`);

    // Dauerhafte Einstellungen für SQLite: Write-Ahead-Log (bleibt in der Datei) und volle Synchronisation
    await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await db.$executeRawUnsafe("PRAGMA synchronous = FULL");

    await ensureBaseData(db);
    const workshop = await db.workshop.findUnique({ where: { id: "default" }, select: { timezone: true } });
    if (workshop && !applyTimezone(workshop.timezone)) console.error(`[start] Unbekannte Zeitzone ${workshop.timezone}`);

    // Frische Installation: Einrichtungs-Token erzeugen und ins Container-Log schreiben (nach der Einrichtung entfernt)
    ensureSetupToken((await db.user.count()) === 0, { logExisting: true });

    startBackupScheduler();
    state.status = "ready";
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof Error ? error.message : String(error);
    console.error("[start] Start fehlgeschlagen:", error);
    process.exit(1);
  }
}
