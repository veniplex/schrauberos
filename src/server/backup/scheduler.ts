import "server-only";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
import { runApiCleanup } from "@/server/api/cleanup";
import { pruneAuditLog } from "@/server/audit-retention";
import { cleanupBackupTemp, createBackup, listBackups, pruneAutomaticBackups } from "./core";
import { getBackupSettings } from "./settings";

const CHECK_EVERY_MS = 10 * 60 * 1000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Legt eine automatische Sicherung an, wenn die Uhrzeit erreicht und heute noch keine erstellt wurde. */
export async function runBackupCheck(now = new Date()): Promise<string | null> {
  const settings = await getBackupSettings();
  if (!settings.enabled || now.getHours() < settings.hour) return null;
  if (listBackups().some((b) => b.kind === "auto" && sameDay(b.createdAt, now))) return null;
  const info = await createBackup("auto");
  pruneAutomaticBackups(settings.keep);
  await audit("backup.create", { actor: { id: null, name: "System" }, target: info.name });
  return info.name;
}

const globalForScheduler = globalThis as unknown as { __backupTimer?: NodeJS.Timeout; __lastAuditPrune?: number };

/**
 * Löscht Audit-Einträge außerhalb der Aufbewahrungsfrist – höchstens einmal am Tag. Der Zeitpunkt wird **erst nach erfolgreichem Lauf** gemerkt: Ein Fehler
 * (gesperrte Datenbank …) verschiebt die Bereinigung nicht um einen Tag, der nächste Takt versucht es erneut.
 */
export async function runAuditRetention(now = Date.now()): Promise<number> {
  if (globalForScheduler.__lastAuditPrune !== undefined && now - globalForScheduler.__lastAuditPrune < PRUNE_EVERY_MS) return 0;
  const removed = await pruneAuditLog(new Date(now));
  globalForScheduler.__lastAuditPrune = now;
  return removed;
}

/** Nur für Tests: vergisst, wann zuletzt bereinigt wurde. */
export function resetSchedulerForTest(): void {
  delete globalForScheduler.__lastAuditPrune;
}

/**
 * Zeitgeber der App (Backup-Zeitplan, Bereinigung des Audit-Logs, Aufräumen der API-Daten): prüft regelmäßig und kurz nach dem Start, falls die Uhrzeit verpasst wurde
 * (z. B. nach einem Neustart).
 */
export function startScheduler(): void {
  if (globalForScheduler.__backupTimer) return;
  cleanupBackupTemp();
  const tick = () => {
    runBackupCheck().catch((error) => logError("backup:auto", error));
    runAuditRetention().catch((error) => logError("audit:retention", error));
    runApiCleanup().catch((error) => logError("api:cleanup", error));
  };
  setTimeout(tick, 60_000).unref();
  globalForScheduler.__backupTimer = setInterval(tick, CHECK_EVERY_MS);
  globalForScheduler.__backupTimer.unref();
}
