import "server-only";
import { getSetting, setSetting } from "@/server/settings";

/** Zeitplan der automatischen Backups. Standard: täglich um 02:00 Uhr, die letzten 14 behalten. */
export type BackupSettings = { enabled: boolean; hour: number; keep: number };

export const BACKUP_DEFAULTS: BackupSettings = { enabled: true, hour: 2, keep: 14 };

const num = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null ? NaN : Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export async function getBackupSettings(): Promise<BackupSettings> {
  const [enabled, hour, keep] = await Promise.all([getSetting("backup.enabled"), getSetting("backup.hour"), getSetting("backup.keep")]);
  return {
    enabled: enabled === null ? BACKUP_DEFAULTS.enabled : enabled === "true",
    hour: num(hour, BACKUP_DEFAULTS.hour, 0, 23),
    keep: num(keep, BACKUP_DEFAULTS.keep, 1, 365),
  };
}

export async function saveBackupSettings(s: BackupSettings): Promise<void> {
  await Promise.all([setSetting("backup.enabled", String(s.enabled)), setSetting("backup.hour", String(s.hour)), setSetting("backup.keep", String(s.keep))]);
}
