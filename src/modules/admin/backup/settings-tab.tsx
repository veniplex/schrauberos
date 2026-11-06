import { getBackupSettings, RETENTION_MAX_DAYS, RETENTION_MAX_KEEP } from "@/server/backup/settings";
import type { SettingsTabDef } from "@/modules/types";
import { BackupPlanForm } from "./plan-form";

async function BackupSettingsTab() {
  return <BackupPlanForm initial={await getBackupSettings()} limits={{ keep: RETENTION_MAX_KEEP, days: RETENTION_MAX_DAYS }} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "backup", feature: "admin.backup", labelKey: "backup.settings.tab", permission: "settings.manage", order: 40, Component: BackupSettingsTab },
];
