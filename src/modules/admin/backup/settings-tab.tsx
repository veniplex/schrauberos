import { getBackupSettings } from "@/server/backup/settings";
import type { SettingsTabDef } from "@/modules/types";
import { BackupPlanForm } from "./plan-form";

async function BackupSettingsTab() {
  return <BackupPlanForm initial={await getBackupSettings()} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "backup", feature: "admin.backup", labelKey: "backup.settings.tab", permission: "settings.manage", order: 40, Component: BackupSettingsTab },
];
