/** Arten von Backups (rein, ohne Dateizugriff – auch für Formulare und Einstellungen). */
export const BACKUP_KINDS = ["auto", "manual", "pre-update", "pre-restore", "pre-migration", "upload"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];
