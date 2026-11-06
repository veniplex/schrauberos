import { hasSecret } from "@/server/settings";
import type { SettingsTabDef } from "@/modules/types";
import { UPDATE_TOKEN_KEY } from "./config";
import { UpdateTokenForm } from "./token-form";

async function UpdatesSettingsTab() {
  return <UpdateTokenForm configured={await hasSecret(UPDATE_TOKEN_KEY)} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "updates", feature: "admin.updates", labelKey: "updates.settings.tab", permission: "settings.manage", order: 50, Component: UpdatesSettingsTab },
];
