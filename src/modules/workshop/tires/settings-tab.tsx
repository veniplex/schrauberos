import type { SettingsTabDef } from "@/modules/types";
import { getTireRules } from "./settings";
import { TireSettingsForm } from "./settings-form";

async function TiresSettingsTab() {
  return <TireSettingsForm initial={await getTireRules()} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "tires", feature: "workshop.tires", labelKey: "tires.settings.tab", permission: "settings.manage", order: 30, Component: TiresSettingsTab },
];
