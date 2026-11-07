"use client";

import { useState } from "react";
import { Checkbox, ColorPicker, Field, FileInput, Form, FormActions, FormFieldError, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { ACCENT_PRESETS } from "@/lib/color";
import { WEEKDAYS } from "@/lib/constants";
import type { OpeningHours } from "@/lib/opening-hours";
import { useI18n } from "@/i18n/client";
import { saveWorkshop } from "./actions";
import { MAX_LOGO_BYTES } from "./limits";

export type WorkshopFormInitial = {
  name: string;
  tagline: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  accentColor: string;
  logoDataUrl: string | null;
  hours: OpeningHours;
  timezone: string;
};

export function WorkshopForm({ initial, timezones }: { initial: WorkshopFormInitial; timezones: string[] }) {
  const { t } = useI18n();
  const [accent, setAccent] = useState(initial.accentColor);
  const [closed, setClosed] = useState(() => Object.fromEntries(WEEKDAYS.map((d) => [d, initial.hours[d] === null])));

  return (
    <Form action={saveWorkshop} encType="multipart/form-data" className="flex max-w-4xl flex-col gap-5">
      <Card title={t("settings.workshop.identity")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.workshop.name")} htmlFor="name" name="name" required>
            <Input id="name" name="name" defaultValue={initial.name} maxLength={80} required />
          </Field>
          <Field label={t("settings.workshop.tagline")} htmlFor="tagline">
            <Input id="tagline" name="tagline" defaultValue={initial.tagline} maxLength={120} />
          </Field>
          <Field label={t("customers.fields.street")} htmlFor="street">
            <Input id="street" name="street" defaultValue={initial.street} />
          </Field>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <Field label={t("customers.fields.zip")} htmlFor="zip">
              <Input id="zip" name="zip" defaultValue={initial.zip} />
            </Field>
            <Field label={t("customers.fields.city")} htmlFor="city">
              <Input id="city" name="city" defaultValue={initial.city} />
            </Field>
          </div>
          <Field label={t("customers.fields.phone")} htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} />
          </Field>
          <Field label={t("customers.fields.email")} htmlFor="email" name="email">
            <Input id="email" name="email" type="email" defaultValue={initial.email} />
          </Field>
          <Field label={t("settings.workshop.website")} htmlFor="website" className="sm:col-span-2">
            <Input id="website" name="website" defaultValue={initial.website} placeholder="https://" />
          </Field>
        </div>
      </Card>

      <Card title={t("settings.workshop.branding")}>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label={t("settings.workshop.logo")} name="logo" hint={t("settings.workshop.logoHint")}>
            <div className="flex items-center gap-4">
              {initial.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Data-URL
                <img src={initial.logoDataUrl} alt="" className="size-14 rounded-md border border-line object-contain p-1" />
              ) : (
                <span className="grid size-14 place-items-center rounded-md border border-dashed border-line-strong text-xs text-ink-muted">–</span>
              )}
              <div className="min-w-0 flex-1">
                <FileInput name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" maxBytes={MAX_LOGO_BYTES} />
              </div>
            </div>
            {initial.logoDataUrl ? (
              <Checkbox name="removeLogo" label={t("settings.workshop.removeLogo")} className="mt-3" />
            ) : null}
          </Field>
          <Field label={t("settings.workshop.accent")} name="accentColor" hint={t("settings.workshop.accentHint")} group>
            <ColorPicker name="accentColor" value={accent} presets={ACCENT_PRESETS} onChange={setAccent} customLabel={t("settings.workshop.accentCustom")} />
          </Field>
        </div>
      </Card>

      <Card title={t("settings.workshop.timezoneTitle")}>
        <Field label={t("settings.workshop.timezone")} htmlFor="timezone" name="timezone" hint={t("settings.workshop.timezoneHint")}>
          <Select id="timezone" name="timezone" defaultValue={initial.timezone}>
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card title={t("settings.workshop.hours")}>
        <ul className="flex flex-col gap-2">
          {WEEKDAYS.map((day) => (
            <li key={day} className="grid grid-cols-[6rem_1fr] items-center gap-3 sm:grid-cols-[8rem_auto_auto_1fr]">
              <span className="text-sm font-medium">{t(`enums.weekday.${day}`)}</span>
              <Checkbox
                name={`hours.${day}.closed`}
                checked={closed[day]}
                onChange={(e) => setClosed((c) => ({ ...c, [day]: e.target.checked }))}
                label={t("settings.workshop.closed")}
                className="sm:order-4"
              />
              <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:contents">
                <Input type="time" name={`hours.${day}.from`} defaultValue={initial.hours[day]?.[0] ?? "07:30"} disabled={closed[day]} aria-label={`${t(`enums.weekday.${day}`)} – ${t("settings.workshop.from")}`} className="w-28" />
                <span className="text-ink-muted sm:hidden">–</span>
                <Input type="time" name={`hours.${day}.to`} defaultValue={initial.hours[day]?.[1] ?? "17:00"} disabled={closed[day]} aria-label={`${t(`enums.weekday.${day}`)} – ${t("settings.workshop.to")}`} className="w-28" />
              </div>
              <FormFieldError name={`hours.${day}`} className="col-span-full" />
            </li>
          ))}
        </ul>
      </Card>

      <FormActions />
    </Form>
  );
}
