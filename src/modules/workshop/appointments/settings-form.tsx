"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, Select, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveAppointmentSettings } from "./actions";

export function CalendarSettingsForm({ initial }: { initial: { dayStartHour: number; dayEndHour: number; slotMinutes: number } }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveAppointmentSettings, {});
  const err = state.fieldErrors ?? {};

  return (
    <form action={action}>
      <Card title={t("appointments.settings.calendar")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("appointments.settings.dayStart")} htmlFor="dayStartHour" error={err.dayStartHour}>
            <Input id="dayStartHour" name="dayStartHour" type="number" min={0} max={23} defaultValue={initial.dayStartHour} />
          </Field>
          <Field label={t("appointments.settings.dayEnd")} htmlFor="dayEndHour" error={err.dayEndHour}>
            <Input id="dayEndHour" name="dayEndHour" type="number" min={1} max={24} defaultValue={initial.dayEndHour} invalid={!!err.dayEndHour} />
          </Field>
          <Field label={t("appointments.settings.slot")} htmlFor="slotMinutes">
            <Select id="slotMinutes" name="slotMinutes" defaultValue={String(initial.slotMinutes)}>
              {[10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <FormMessage state={state} />
        <div className="mt-4 flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
