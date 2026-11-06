import { getWorkshop } from "@/server/workshop";
import type { SettingsTabDef } from "@/modules/types";
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

export const settingsTabs: SettingsTabDef[] = [
  { id: "workshop", feature: "admin.settings", labelKey: "settings.tabs.workshop", permission: "settings.manage", order: 10, Component: WorkshopSettingsTab },
];
