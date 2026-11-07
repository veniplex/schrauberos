"use client";

import { Field, Form, FormActions, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveEmployeeSettings } from "./actions";
import type { EmployeeRules } from "./settings";

export function EmployeeSettingsForm({ initial }: { initial: EmployeeRules }) {
  const { t, td } = useI18n();
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1));
  return (
    <Form action={saveEmployeeSettings} className="flex max-w-4xl flex-col gap-5">
      <Card title={t("employees.settings.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("employees.settings.hint")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-xl">
          <Field label={t("employees.settings.carryDay")} htmlFor="vacationCarryDay" name="vacationCarryDay">
            <Input id="vacationCarryDay" name="vacationCarryDay" type="number" min={1} max={31} defaultValue={initial.vacationCarryDay} />
          </Field>
          <Field label={t("employees.settings.carryMonth")} htmlFor="vacationCarryMonth" name="vacationCarryMonth">
            <Select id="vacationCarryMonth" name="vacationCarryMonth" defaultValue={String(initial.vacationCarryMonth)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {td(`employees.settings.months.${m}`, m)}
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
