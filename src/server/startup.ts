import "server-only";
import { readApplied } from "@/lib/updates/restore";
import { createBackup } from "@/server/backup/core";
import { startScheduler } from "@/server/backup/scheduler";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { databaseFile } from "@/server/db-client";
import { appliedMigrations, MigrationError, runMigrations } from "@/server/migrate";
import { ensureBaseData } from "@/server/seed/base";
import { ensureSetupToken } from "@/server/setup-token";
import { startupState, type StartupState } from "@/server/startup-state";

export { startupState, type StartupState };

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
 * Nach einer Wiederherstellung (der Launcher hat die Datenbank getauscht und noch nicht bestätigt: `restore/applied.json`) gelten **keine API-Tokens** mehr: Die
 * Sicherung kennt keine Widerrufe, die seitdem geschehen sind – ein inzwischen widerrufenes (etwa gestohlenes) Token wäre sonst wieder gültig. Alle Tokens werden beim ersten
 * Start widerrufen (und im Audit-Log festgehalten); neue Tokens sind schnell erzeugt. Läuft bei jedem Start bis zur Bestätigung (idempotent). Liefert die Anzahl.
 */
export async function revokeApiTokensAfterRestore(dataRoot?: string): Promise<number> {
  const applied = readApplied(dataRoot);
  if (!applied) return 0;
  return db.$transaction(async (tx) => {
    const { count } = await tx.apiToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    if (count > 0) await writeAudit(tx, "apiToken.restoreRevoked", { target: `${count} (Sicherung ${applied.from})`, actor: { id: null, name: "System" } });
    return count;
  });
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
    const revoked = await revokeApiTokensAfterRestore();
    if (revoked > 0) console.log(`[start] Nach der Wiederherstellung: ${revoked} API-Token(s) widerrufen.`);
    const workshop = await db.workshop.findUnique({ where: { id: "default" }, select: { timezone: true } });
    if (workshop && !applyTimezone(workshop.timezone)) console.error(`[start] Unbekannte Zeitzone ${workshop.timezone}`);

    // Frische Installation: Einrichtungs-Token erzeugen und ins Container-Log schreiben (nach der Einrichtung entfernt)
    ensureSetupToken((await db.user.count()) === 0, { logExisting: true });

    startScheduler();
    state.status = "ready";
  } catch (error) {
    if (error instanceof MigrationError && error.code === "foreignHistory") {
      // Kein Absturz (Neustart-Schleife), kein Eingriff in die fremde Datenbank: klar melden und stehen bleiben
      state.status = "reinstall";
      state.error = error.message;
      console.error(`[start] ${error.message}`);
      return;
    }
    state.status = "failed";
    state.error = error instanceof Error ? error.message : String(error);
    console.error("[start] Start fehlgeschlagen:", error);
    process.exit(1);
  }
}
