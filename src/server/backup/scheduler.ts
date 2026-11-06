import "server-only";
import { logError } from "@/lib/log-safe";
import { audit } from "@/server/audit";
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

/** Löscht Audit-Einträge außerhalb der Aufbewahrungsfrist – höchstens einmal am Tag. */
export async function runAuditRetention(now = Date.now()): Promise<number> {
  if (globalForScheduler.__lastAuditPrune !== undefined && now - globalForScheduler.__lastAuditPrune < PRUNE_EVERY_MS) return 0;
  globalForScheduler.__lastAuditPrune = now;
  return pruneAuditLog(new Date(now));
}

/** Prüft regelmäßig (und kurz nach dem Start, falls die Uhrzeit verpasst wurde, z. B. nach einem Neustart). */
export function startBackupScheduler(): void {
  if (globalForScheduler.__backupTimer) return;
  cleanupBackupTemp();
  const tick = () => {
    runBackupCheck().catch((error) => logError("backup:auto", error));
    runAuditRetention().catch((error) => logError("audit:retention", error));
  };
  setTimeout(tick, 60_000).unref();
  globalForScheduler.__backupTimer = setInterval(tick, CHECK_EVERY_MS);
  globalForScheduler.__backupTimer.unref();
}
