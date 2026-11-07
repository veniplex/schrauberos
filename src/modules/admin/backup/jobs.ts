import { audit } from "@/server/audit";
import { runAutoBackup, runBackupRetention } from "@/server/backup/auto";
import { offsiteWorkPending, runOffsite } from "@/server/backup/offsite/service";
import type { JobDef } from "@/server/jobs/types";

/**
 * Jobs der Backup-Funktion. Das automatische Backup wird alle 10 Minuten geprüft (Uhrzeit und „heute schon“ stehen in `runAutoBackup`); scheitert es,
 * wiederholt der Runner nach 15 min, 30 min, 1 h … höchstens alle 4 Stunden und zeigt den Fehler auf der Backup-Seite an, bis es gelingt.
 */
export const jobs: JobDef[] = [
  {
    id: "backup.auto",
    feature: "admin.backup",
    schedule: { every: 10 * 60_000 },
    retry: { baseDelayMs: 15 * 60_000, maxDelayMs: 4 * 60 * 60_000 },
    timeoutMs: 60 * 60_000,
    run: async ({ now, signal, manual }) => {
      const result = await runAutoBackup(now, { force: manual, signal });
      if (!result) return undefined;
      return result.pruneFailed ? `Backup angelegt: ${result.name}; Aufbewahrung fehlgeschlagen (läuft täglich erneut)` : `Backup angelegt: ${result.name}`;
    },
    // Im Audit-Log nur der erste Fehlschlag einer Serie (die Wiederholungen stehen in der Statusansicht) – auch eine Zeitüberschreitung gehört dazu
    onFailure: async ({ attempt }) => {
      if (attempt === 1) await audit("backup.createFailed", { actor: { id: null, name: "System" } });
    },
  },
  {
    // Off-Site: neue Sicherungen verschlüsselt zum Ziel (SFTP/WebDAV). Meistens gibt es nichts zu tun (`shouldRun` prüft nur lokal und einmal täglich das Ziel); scheitert ein Lauf,
    // wiederholt der Runner wie beim automatischen Backup (15 min, 30 min … höchstens 4 h) und die Backup-Seite zeigt den Fehler an, bis es gelingt.
    id: "backup.offsite",
    feature: "admin.backup",
    schedule: { every: 10 * 60_000 },
    retry: { baseDelayMs: 15 * 60_000, maxDelayMs: 4 * 60 * 60_000 },
    timeoutMs: 6 * 60 * 60_000,
    shouldRun: ({ now }) => offsiteWorkPending(now),
    run: async ({ now, signal }) => {
      const result = await runOffsite({ now, signal });
      if (!result || (result.uploaded.length === 0 && result.deleted.length === 0 && result.deleteFailed === 0)) return undefined;
      return `${result.uploaded.length} hochgeladen, ${result.deleted.length} am Ziel gelöscht${result.deleteFailed ? `, ${result.deleteFailed} nicht löschbar` : ""}; ${result.remoteCount} am Ziel`;
    },
    // Im Audit-Log nur der erste Fehlschlag einer Serie (die Wiederholungen stehen in der Statusansicht)
    onFailure: async ({ attempt }) => {
      if (attempt === 1) await audit("backup.offsiteFailed", { actor: { id: null, name: "System" } });
    },
  },
  {
    id: "backup.retention",
    feature: "admin.backup",
    schedule: { cron: "10 3 * * *" },
    run: async ({ now }) => `${await runBackupRetention(now)} gelöscht`,
  },
];
