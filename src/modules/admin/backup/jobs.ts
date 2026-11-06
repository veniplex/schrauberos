import { audit } from "@/server/audit";
import { runAutoBackup, runBackupRetention } from "@/server/backup/auto";
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
    run: async ({ now, attempt }) => {
      try {
        const name = await runAutoBackup(now);
        return name ? `Backup angelegt: ${name}` : undefined;
      } catch (error) {
        // Im Audit-Log nur der erste Fehlschlag einer Serie (die Wiederholungen stehen in der Statusansicht)
        if (attempt === 1) await audit("backup.createFailed", { actor: { id: null, name: "System" } });
        throw error;
      }
    },
  },
  {
    id: "backup.retention",
    feature: "admin.backup",
    schedule: { cron: "10 3 * * *" },
    run: async ({ now }) => `${await runBackupRetention(now)} gelöscht`,
  },
];
