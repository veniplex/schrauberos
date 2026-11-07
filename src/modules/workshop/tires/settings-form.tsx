"use client";

import { Field, Form, FormActions, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import type { TireRules } from "./domain";
import { saveTireSettings } from "./actions";

export function TireSettingsForm({ initial }: { initial: TireRules }) {
  const { t, td } = useI18n();
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1));

  return (
    <Form action={saveTireSettings} className="flex max-w-4xl flex-col gap-5">
      <Card title={t("tires.settings.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("tires.settings.hint")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("tires.settings.treadWarn")} htmlFor="treadWarnMm" name="treadWarnMm">
            <Input id="treadWarnMm" name="treadWarnMm" type="number" step="0.1" min={1} max={10} defaultValue={initial.treadWarnMm} />
          </Field>
          <Field label={t("tires.settings.treadReplace")} htmlFor="treadReplaceMm" name="treadReplaceMm">
            <Input id="treadReplaceMm" name="treadReplaceMm" type="number" step="0.1" min={1} max={10} defaultValue={initial.treadReplaceMm} />
          </Field>
          <Field label={t("tires.settings.ageWarn")} htmlFor="tireAgeWarnYears" name="tireAgeWarnYears">
            <Input id="tireAgeWarnYears" name="tireAgeWarnYears" type="number" min={1} max={20} defaultValue={initial.tireAgeWarnYears} />
          </Field>
          <Field label={t("tires.settings.ageReplace")} htmlFor="tireAgeReplaceYears" name="tireAgeReplaceYears">
            <Input id="tireAgeReplaceYears" name="tireAgeReplaceYears" type="number" min={1} max={25} defaultValue={initial.tireAgeReplaceYears} />
          </Field>
        </div>
      </Card>
      <Card title={t("tires.settings.seasonTitle")}>
        <p className="mb-4 text-sm text-ink-muted">{t("tires.settings.seasonHint")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-xl">
          <Field label={t("tires.settings.winterStart")} htmlFor="winterStartMonth" name="winterStartMonth">
            <Select id="winterStartMonth" name="winterStartMonth" defaultValue={String(initial.winterStartMonth)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {td(`tires.settings.months.${m}`, m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tires.settings.winterEnd")} htmlFor="winterEndMonth" name="winterEndMonth">
            <Select id="winterEndMonth" name="winterEndMonth" defaultValue={String(initial.winterEndMonth)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {td(`tires.settings.months.${m}`, m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <FormActions />
    </Form>
  );
}
