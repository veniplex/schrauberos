import { getWorkshop } from "@/server/workshop";
import type { SettingsTabDef } from "@/modules/types";
import { getAuditRetentionDays } from "@/server/audit-retention";
import { isBehindProxy } from "@/server/auth/network";
import { cspMode } from "@/lib/csp-mode";
import { formatIban, formatVatId } from "@/lib/bank-tax";
import { logoSrc } from "@/lib/logo";
import { centsToInput } from "@/lib/money";
import { getFullYear, getMonth } from "@/lib/zone";
import { connectionIsSecure } from "@/server/auth/connection";
import { authPolicy } from "@/server/auth/policy";
import { CspModeForm, HttpsNotice, SecurityForm } from "./security-form";
import { HolidaysSettingsTab } from "./holiday-tab";
import { WorkshopForm } from "./workshop-form";

async function WorkshopSettingsTab() {
  const w = await getWorkshop();
  const all = Intl.supportedValuesOf("timeZone");
  const timezones = all.includes(w.timezone) ? all : [w.timezone, ...all];
  const now = new Date();
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
        logoSrc: logoSrc(w),
        hours: w.hours,
        timezone: w.timezone,
        taxNumber: w.taxNumber ?? "",
        vatId: w.vatId ? formatVatId(w.vatId) : "",
        smallBusiness: w.smallBusiness,
        bankName: w.bankName ?? "",
        iban: w.iban ? formatIban(w.iban) : "",
        bic: w.bic ?? "",
        paymentTermDays: w.paymentTermDays,
        managingDirector: w.managingDirector ?? "",
        registerCourt: w.registerCourt ?? "",
        registerNumber: w.registerNumber ?? "",
        hourlyRate: centsToInput(w.hourlyRateCents),
        workUnitMinutes: w.workUnitMinutes,
        invoiceNumberFormat: w.invoiceNumberFormat,
      }}
      timezones={timezones}
      previewWhen={{ year: getFullYear(now), month: getMonth(now) + 1 }}
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
  { id: "holidays", feature: "admin.settings", labelKey: "settings.tabs.holidays", permission: "settings.manage", order: 12, Component: HolidaysSettingsTab },
  { id: "security", feature: "admin.settings", labelKey: "settings.tabs.security", permission: "settings.manage", order: 15, Component: SecuritySettingsTab },
];
