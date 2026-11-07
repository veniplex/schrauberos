import { Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { versionOf } from "@/lib/concurrency";
import { COUNTRIES, regionsOf, statutoryDays, ymd } from "@/lib/holidays";
import { getFullYear } from "@/lib/zone";
import { db } from "@/server/db";
import { readHolidayConfig } from "@/server/holidays";
import { deleteHolidayCustom, saveHolidayCustom } from "./actions";
import { HolidayRegionForm, HolidayRulesForm } from "./holiday-forms";

/** Reiter „Feiertage“ (Verwaltung → Einstellungen): Region, Änderungen an den gesetzlichen Tagen, eigene Tage. */
export async function HolidaysSettingsTab() {
  const { t, td, date } = await getI18n();
  const config = await readHolidayConfig();
  const year = getFullYear(new Date());
  const dayLabel = (day: string) => date(`${day}T12:00:00Z`, { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
  const rows = statutoryDays(year, config.region, config.rules).map((s) => ({
    id: s.id,
    key: s.key,
    day: s.day,
    optional: s.optional,
    partial: s.partial,
    mode: s.mode ?? "",
    label: td(`holidays.names.${s.key}`, s.key),
    dateLabel: dayLabel(s.day),
  }));
  const customRows = await db.holidayDay.findMany({ where: { kind: "custom" }, orderBy: [{ month: "asc" }, { day: "asc" }] });

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <HolidayRegionForm region={config.region} groups={COUNTRIES.map((country) => ({ country, regions: regionsOf(country) }))} />
      {config.region ? <HolidayRulesForm year={year} rows={rows} /> : null}

      <Card title={t("holidays.settings.customTitle")} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{t("holidays.settings.customHint")}</p>
        {customRows.length === 0 ? <p className="px-5 py-4 text-sm text-ink-muted">{t("holidays.settings.customEmpty")}</p> : null}
        <ul className="divide-y divide-line">
          {customRows.map((c) => {
            const value = ymd(c.year ?? year, c.month ?? 1, c.day ?? 1);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <form action={saveHolidayCustom} className="flex flex-1 flex-wrap items-center gap-3">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="version" value={versionOf(c)} />
                  <Input name="name" defaultValue={c.name ?? ""} aria-label={t("holidays.settings.name")} className="min-w-40 flex-1" required maxLength={80} />
                  <Input name="date" type="date" defaultValue={value} aria-label={t("holidays.settings.date")} className="w-44" required />
                  <Checkbox name="yearly" defaultChecked={c.year === null} label={t("holidays.settings.yearly")} />
                  <Checkbox name="half" defaultChecked={c.half} label={t("holidays.settings.halfDay")} />
                  <SubmitButton variant="secondary" size="sm">
                    {t("common.save")}
                  </SubmitButton>
                </form>
                <form action={deleteHolidayCustom}>
                  <input type="hidden" name="id" value={c.id} />
                  <ConfirmSubmitButton message={t("holidays.settings.confirmDelete")} target={c.name ?? ""} label={t("common.delete")}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </ConfirmSubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title={t("holidays.settings.customNew")}>
        <form action={saveHolidayCustom} className="flex flex-wrap items-end gap-3">
          <Field label={t("holidays.settings.name")} htmlFor="holiday-new-name" className="min-w-48 flex-1" required>
            <Input id="holiday-new-name" name="name" required maxLength={80} placeholder={t("holidays.settings.namePlaceholder")} />
          </Field>
          <Field label={t("holidays.settings.date")} htmlFor="holiday-new-date" required>
            <Input id="holiday-new-date" name="date" type="date" required />
          </Field>
          <Checkbox name="yearly" label={t("holidays.settings.yearly")} />
          <Checkbox name="half" label={t("holidays.settings.halfDay")} />
          <SubmitButton>{t("common.add")}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
