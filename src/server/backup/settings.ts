import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getSetting, setSetting } from "@/server/settings";
import { BACKUP_KINDS, type BackupKind } from "./kinds";

/**
 * Einstellungen der Backups: Zeitplan der automatischen Sicherung (Standard täglich ab 02:00 Uhr) und **Aufbewahrung je Art**.
 * Je Art gilt: höchstens die neuesten `keep` Backups behalten UND keines, das älter als `days` Tage ist; 0 = unbegrenzt. Das neueste Backup überhaupt wird
 * nie automatisch gelöscht. Hintergrund: Backups enthalten personenbezogene Daten – wie lange sie bleiben, soll die Werkstatt bewusst festlegen (DSGVO: Speicherbegrenzung).
 */
export type KindRetention = { keep: number; days: number };
export type BackupRetention = Record<BackupKind, KindRetention>;
export type BackupSettings = { enabled: boolean; hour: number; retention: BackupRetention };

/** Standard: automatische 14 Stück; Sicherungen vor Update, Wiederherstellung und Datenbank-Änderung die letzten 5; Manuelles und Hochgeladenes bleibt (0 = unbegrenzt). */
export const RETENTION_DEFAULTS: BackupRetention = {
  auto: { keep: 14, days: 0 },
  manual: { keep: 0, days: 0 },
  upload: { keep: 0, days: 0 },
  "pre-update": { keep: 5, days: 0 },
  "pre-restore": { keep: 5, days: 0 },
  "pre-migration": { keep: 5, days: 0 },
};

export const RETENTION_MAX_KEEP = 365;
export const RETENTION_MAX_DAYS = 3650;

export const BACKUP_DEFAULTS: BackupSettings = { enabled: true, hour: 2, retention: RETENTION_DEFAULTS };

const num = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null ? NaN : Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const retentionKey = (kind: BackupKind, field: keyof KindRetention) => `backup.retention.${kind}.${field}`;

export async function getBackupSettings(): Promise<BackupSettings> {
  const [enabled, hour] = await Promise.all([getSetting("backup.enabled"), getSetting("backup.hour")]);
  const retention = {} as BackupRetention;
  for (const kind of BACKUP_KINDS) {
    const [keep, days] = await Promise.all([getSetting(retentionKey(kind, "keep")), getSetting(retentionKey(kind, "days"))]);
    retention[kind] = {
      keep: num(keep, RETENTION_DEFAULTS[kind].keep, 0, RETENTION_MAX_KEEP),
      days: num(days, RETENTION_DEFAULTS[kind].days, 0, RETENTION_MAX_DAYS),
    };
  }
  return { enabled: enabled === null ? BACKUP_DEFAULTS.enabled : enabled === "true", hour: num(hour, BACKUP_DEFAULTS.hour, 0, 23), retention };
}

export async function saveBackupSettings(s: BackupSettings, client?: Pick<PrismaClient | Prisma.TransactionClient, "appSetting">): Promise<void> {
  await setSetting("backup.enabled", String(s.enabled), client);
  await setSetting("backup.hour", String(s.hour), client);
  for (const kind of BACKUP_KINDS) {
    await setSetting(retentionKey(kind, "keep"), String(s.retention[kind].keep), client);
    await setSetting(retentionKey(kind, "days"), String(s.retention[kind].days), client);
  }
}
