import "server-only";
import type { SetupCheckDef } from "@/modules/types";
import { getBackupSettings } from "@/server/backup/settings";
import { getOffsiteSettings } from "@/server/backup/offsite/settings";
import { recoveryKeyConfirmed } from "@/server/recovery-key";

/** Einrichtungsschritte der Datensicherung: automatisches Backup, Wiederherstellungsschlüssel gesichert (nur bestätigt, wenn erzeugt und als gesichert markiert), Off-Site-Sicherung. */
export const setupChecks: SetupCheckDef[] = [
  { id: "autoBackup", feature: "admin.backup", permission: "backup.manage", labelKey: "backup.checklist.auto.label", hintKey: "backup.checklist.auto.hint", href: "/admin/backup", order: 30, done: async () => (await getBackupSettings()).enabled },
  { id: "recoveryKey", feature: "admin.backup", permission: "backup.keys", labelKey: "backup.checklist.key.label", hintKey: "backup.checklist.key.hint", href: "/admin/backup/key", order: 31, done: async () => recoveryKeyConfirmed() },
  { id: "offsite", feature: "admin.backup", permission: "backup.manage", labelKey: "backup.checklist.offsite.label", hintKey: "backup.checklist.offsite.hint", href: "/admin/backup/offsite", order: 32, recommended: true, done: async () => (await getOffsiteSettings()).enabled },
];
