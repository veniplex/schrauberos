import { getWorkshop } from "@/server/workshop";
import type { SettingsTabDef } from "@/modules/types";
import { isBehindProxy } from "@/server/auth/network";
import { SecurityForm } from "./security-form";
import { WorkshopForm } from "./workshop-form";

async function WorkshopSettingsTab() {
  const w = await getWorkshop();
  const all = Intl.supportedValuesOf("timeZone");
  const timezones = all.includes(w.timezone) ? all : [w.timezone, ...all];
  return (
    <WorkshopForm
      initial={{
        name: w.name,
        tagline: w.tagline ?? "",
        street: w.street ?? "",
        zip: w.zip ?? "",
        city: w.city ?? "",
        phone: w.phone ?? "",
        email: w.email ?? "",
        website: w.website ?? "",
        accentColor: w.accentColor,
        logoDataUrl: w.logoDataUrl,
        hours: w.hours,
        timezone: w.timezone,
      }}
      timezones={timezones}
    />
  );
}

async function SecuritySettingsTab() {
  return <SecurityForm behindProxy={await isBehindProxy()} />;
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "workshop", feature: "admin.settings", labelKey: "settings.tabs.workshop", permission: "settings.manage", order: 10, Component: WorkshopSettingsTab },
  { id: "security", feature: "admin.settings", labelKey: "settings.tabs.security", permission: "settings.manage", order: 15, Component: SecuritySettingsTab },
];
