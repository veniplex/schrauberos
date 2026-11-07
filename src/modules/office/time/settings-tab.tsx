import type { SettingsTabDef } from "@/modules/types";
import { getTimeRules } from "./settings";
import { TimeSettingsForm } from "./settings-form";

async function TimeSettingsTab() {
  return <TimeSettingsForm initial={await getTimeRules()} />;
}

export const settingsTabs: SettingsTabDef[] = [{ id: "time", feature: "office.time", labelKey: "time.settings.tab", permission: "settings.manage", order: 36, Component: TimeSettingsTab }];
