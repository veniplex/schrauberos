import { getWorkshop } from "@/server/workshop";
import type { SettingsTabDef } from "@/modules/types";
import { getAuditRetentionDays } from "@/server/audit-retention";
import { isBehindProxy } from "@/server/auth/network";
import { cspMode } from "@/lib/csp-mode";
import { connectionIsSecure } from "@/server/auth/connection";
import { authPolicy } from "@/server/auth/policy";
import { CspModeForm, HttpsNotice, SecurityForm } from "./security-form";
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
  const [behindProxy, secure, auditRetentionDays, policy] = await Promise.all([isBehindProxy(), connectionIsSecure(), getAuditRetentionDays(), authPolicy()]);
  return (
    <div className="flex flex-col gap-5">
      <HttpsNotice secure={secure} behindProxy={behindProxy} />
      <SecurityForm behindProxy={behindProxy} auditRetentionDays={auditRetentionDays} idleTimeoutHours={policy.idleTimeoutHours} requireTwoFactorAdmins={policy.requireTwoFactorForAdmins} />
      <CspModeForm reportOnly={cspMode() === "report-only"} />
    </div>
  );
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "workshop", feature: "admin.settings", labelKey: "settings.tabs.workshop", permission: "settings.manage", order: 10, Component: WorkshopSettingsTab },
  { id: "security", feature: "admin.settings", labelKey: "settings.tabs.security", permission: "settings.manage", order: 15, Component: SecuritySettingsTab },
];
