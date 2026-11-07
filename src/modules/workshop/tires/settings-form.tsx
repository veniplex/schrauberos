"use client";

import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import type { TireRules } from "./domain";
import { saveTireSettings } from "./actions";

export function TireSettingsForm({ initial }: { initial: TireRules }) {
  const { t } = useI18n();

  return (
    <Form action={saveTireSettings} className="flex max-w-4xl flex-col gap-5">
      <Card title={t("tires.settings.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("tires.settings.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      <FormActions />
    </Form>
  );
}
