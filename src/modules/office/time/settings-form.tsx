"use client";

import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveTimeSettings } from "./actions";
import type { TimeRules } from "./settings";

/** Sollzeit je Arbeitstag (Minuten). Die Arbeitstage der Woche pflegt die Mitarbeiterverwaltung je Person. */
export function TimeSettingsForm({ initial }: { initial: TimeRules }) {
  const { t } = useI18n();
  return (
    <Form action={saveTimeSettings} className="flex max-w-4xl flex-col gap-5">
      <Card title={t("time.settings.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("time.settings.hint")}</p>
        <Field label={t("time.settings.dailyTarget")} htmlFor="dailyTargetMinutes" name="dailyTargetMinutes" hint={t("time.settings.dailyTargetHint")} className="max-w-xs">
          <Input id="dailyTargetMinutes" name="dailyTargetMinutes" type="number" inputMode="numeric" min={60} max={720} step={5} defaultValue={initial.dailyTargetMinutes} />
        </Field>
      </Card>
      <FormActions />
    </Form>
  );
}
