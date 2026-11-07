"use client";

import { Field, Form, FormActions, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveAppointmentSettings } from "./actions";

export function CalendarSettingsForm({ initial }: { initial: { dayStartHour: number; dayEndHour: number; slotMinutes: number } }) {
  const { t } = useI18n();

  return (
    <Form action={saveAppointmentSettings}>
      <Card title={t("appointments.settings.calendar")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("appointments.settings.dayStart")} htmlFor="dayStartHour" name="dayStartHour">
            <Input id="dayStartHour" name="dayStartHour" type="number" min={0} max={23} defaultValue={initial.dayStartHour} />
          </Field>
          <Field label={t("appointments.settings.dayEnd")} htmlFor="dayEndHour" name="dayEndHour">
            <Input id="dayEndHour" name="dayEndHour" type="number" min={1} max={24} defaultValue={initial.dayEndHour} />
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
        <FormActions />
      </Card>
    </Form>
  );
}
