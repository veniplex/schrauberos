"use client";

import { Field, Form, FormActions, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveHolidayRegion, saveHolidayRules } from "./actions";

export type HolidayRegionGroup = { country: string; regions: string[] };
export type HolidayRuleRow = { id: string; key: string; day: string; optional: boolean; partial: boolean; mode: string; label: string; dateLabel: string };

/** Region der Feiertage: Land und Bundesland bzw. Kanton (leer = keine Feiertage berücksichtigen). */
export function HolidayRegionForm({ region, groups }: { region: string; groups: HolidayRegionGroup[] }) {
  const { t, td } = useI18n();
  return (
    <Form action={saveHolidayRegion}>
      <Card title={t("holidays.settings.regionTitle")}>
        <p className="mb-4 text-sm text-ink-muted">{t("holidays.settings.regionHint")}</p>
        <Field label={t("holidays.settings.region")} htmlFor="region" name="region" className="max-w-md">
          <Select id="region" name="region" defaultValue={region}>
            <option value="">{t("holidays.settings.regionNone")}</option>
            {groups.map((g) => (
              <optgroup key={g.country} label={td(`holidays.countries.${g.country}`, g.country)}>
                {g.regions.map((code) => (
                  <option key={code} value={code}>
                    {td(`holidays.regions.${code}`, code)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <FormActions />
      </Card>
    </Form>
  );
}

/** Die Tage der Region im laufenden Jahr: gelten, halber Tag oder gestrichen (Vorschläge: aus, gelten, halber Tag). */
export function HolidayRulesForm({ year, rows }: { year: number; rows: HolidayRuleRow[] }) {
  const { t } = useI18n();
  return (
    <Form action={saveHolidayRules}>
      <Card title={t("holidays.settings.rulesTitle", { year })} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{t("holidays.settings.rulesHint")}</p>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="tabular w-40 shrink-0 text-sm text-ink-muted">{r.dateLabel}</span>
              <span className="min-w-40 flex-1 text-sm font-medium">
                {r.label}
                {r.partial ? <span className="ml-2 text-xs font-normal text-ink-muted">{t("holidays.settings.partial")}</span> : null}
                {r.optional ? <span className="ml-2 text-xs font-normal text-ink-muted">{t("holidays.settings.optional")}</span> : null}
              </span>
              <Select name={`rule.${r.id}`} defaultValue={r.mode} aria-label={`${r.label}, ${r.dateLabel}`} className="w-48">
                {r.optional ? (
                  <>
                    <option value="">{t("holidays.settings.modes.inactive")}</option>
                    <option value="on">{t("holidays.settings.modes.on")}</option>
                    <option value="half">{t("holidays.settings.modes.half")}</option>
                  </>
                ) : (
                  <>
                    <option value="">{t("holidays.settings.modes.default")}</option>
                    <option value="half">{t("holidays.settings.modes.half")}</option>
                    <option value="off">{t("holidays.settings.modes.off")}</option>
                  </>
                )}
              </Select>
            </li>
          ))}
        </ul>
        <div className="px-5 pb-4">
          <FormActions />
        </div>
      </Card>
    </Form>
  );
}
