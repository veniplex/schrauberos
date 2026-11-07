import type { SettingsTabDef } from "@/modules/types";
import { PrivacySettingsForm } from "./privacy-settings-form";
import { getPrivacyConfig } from "./settings";

async function PrivacySettingsTab() {
  const config = await getPrivacyConfig();
  return <PrivacySettingsForm years={{ invoice: config.rules.invoiceYears, books: config.rules.booksYears }} confirmedAt={config.confirmedAt?.toISOString() ?? null} confirmedBy={config.confirmedByName} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "privacy", feature: "workshop.customers", labelKey: "privacy.settings.tab", permission: "settings.manage", order: 36, Component: PrivacySettingsTab },
];
