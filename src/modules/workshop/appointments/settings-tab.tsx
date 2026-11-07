import { Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Checkbox, ColorInput, Field, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import type { SettingsTabDef } from "@/modules/types";
import { APPOINTMENT_KINDS } from "./constants";
import { deleteAppointmentType, deleteBay, saveAppointmentType, saveBay } from "./actions";
import { getAppointmentSettings } from "./settings";
import { CalendarSettingsForm } from "./settings-form";

async function AppointmentsSettingsTab() {
  const settings = await getAppointmentSettings();
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <CalendarSettingsForm initial={{ dayStartHour: settings.dayStartHour, dayEndHour: settings.dayEndHour, slotMinutes: settings.slotMinutes }} />
      <BaysCards />
      <TypesCards />
    </div>
  );
}

async function BaysCards() {
  const { t } = await getI18n();
  const bays = await db.bay.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return (
    <>
      <Card title={t("appointments.settings.bays.title")} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{t("appointments.settings.bays.hint")}</p>
        <ul className="divide-y divide-line">
          {bays.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <form action={saveBay} className="flex flex-1 flex-wrap items-center gap-3">
                <input type="hidden" name="id" value={b.id} />
                <Input name="name" defaultValue={b.name} aria-label={t("appointments.settings.bays.name")} className="min-w-40 flex-1" required maxLength={60} />
                <Input name="sortOrder" type="number" min={0} defaultValue={b.sortOrder} aria-label={t("appointments.settings.sortOrder")} className="w-20" />
                <Checkbox name="active" defaultChecked={b.active} label={t("appointments.settings.active")} />
                <SubmitButton variant="secondary" size="sm">{t("common.save")}</SubmitButton>
              </form>
              <form action={deleteBay}>
                <input type="hidden" name="id" value={b.id} />
                <ConfirmSubmitButton message={t("appointments.settings.bays.confirmDelete")} target={b.name} label={t("common.delete")}>
                  <Trash2 className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("appointments.settings.bays.new")}>
        <form action={saveBay} className="flex flex-wrap items-end gap-3">
          <Field label={t("appointments.settings.bays.name")} htmlFor="new-bay" className="min-w-48 flex-1" required>
            <Input id="new-bay" name="name" required maxLength={60} placeholder={t("appointments.settings.bays.namePlaceholder")} />
          </Field>
          <SubmitButton>{t("common.add")}</SubmitButton>
        </form>
      </Card>
    </>
  );
}


async function TypesCards() {
  const { t, td } = await getI18n();
  const types = await db.appointmentType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const fields = (v?: (typeof types)[number]) => (
    <>
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <Input name="name" defaultValue={v?.name} aria-label={t("appointments.settings.types.name")} placeholder={t("appointments.settings.types.name")} className="min-w-40 flex-1" required maxLength={60} />
      <ColorInput name="color" defaultValue={v?.color ?? "#2459c9"} aria-label={t("appointments.settings.types.color")} />
      <Input name="defaultMinutes" type="number" min={5} max={720} step={5} defaultValue={v?.defaultMinutes ?? 60} aria-label={t("appointments.settings.types.minutes")} className="w-24" required />
      <Select name="kind" defaultValue={v?.kind ?? "general"} aria-label={t("appointments.settings.types.kind")} className="w-44">
        {APPOINTMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {td(`enums.appointmentKind.${k}`, k)}
          </option>
        ))}
      </Select>
    </>
  );
  return (
    <>
      <Card title={t("appointments.settings.types.title")} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{t("appointments.settings.types.hint")}</p>
        <ul className="divide-y divide-line">
          {types.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <form action={saveAppointmentType} className="flex flex-1 flex-wrap items-center gap-3">
                {fields(v)}
                <Checkbox name="active" defaultChecked={v.active} label={t("appointments.settings.active")} />
                <SubmitButton variant="secondary" size="sm">{t("common.save")}</SubmitButton>
              </form>
              <form action={deleteAppointmentType}>
                <input type="hidden" name="id" value={v.id} />
                <ConfirmSubmitButton message={t("appointments.settings.types.confirmDelete")} target={v.name} label={t("common.delete")}>
                  <Trash2 className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("appointments.settings.types.new")}>
        <form action={saveAppointmentType} className="flex flex-wrap items-center gap-3">
          {fields()}
          <SubmitButton>{t("common.add")}</SubmitButton>
        </form>
      </Card>
    </>
  );
}

export const settingsTabs: SettingsTabDef[] = [
  { id: "appointments", feature: "workshop.appointments", labelKey: "appointments.settings.tab", permission: "appointments.configure", order: 20, Component: AppointmentsSettingsTab },
];
