"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { ACCENT_PRESETS } from "@/lib/color";
import { WEEKDAYS } from "@/lib/constants";
import type { OpeningHours } from "@/lib/opening-hours";
import { useI18n } from "@/i18n/client";
import { saveWorkshop } from "./actions";

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
};

export function WorkshopForm({ initial }: { initial: WorkshopFormInitial }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveWorkshop, {});
  const [accent, setAccent] = useState(initial.accentColor);
  const [closed, setClosed] = useState(() => Object.fromEntries(WEEKDAYS.map((d) => [d, initial.hours[d] === null])));
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} encType="multipart/form-data" className="flex max-w-4xl flex-col gap-5">
      <Card title={t("settings.workshop.identity")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.workshop.name")} htmlFor="name" error={err.name} required>
            <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} maxLength={80} required />
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
          <Field label={t("customers.fields.email")} htmlFor="email" error={err.email}>
            <Input id="email" name="email" type="email" defaultValue={initial.email} invalid={!!err.email} />
          </Field>
          <Field label={t("settings.workshop.website")} htmlFor="website" className="sm:col-span-2">
            <Input id="website" name="website" defaultValue={initial.website} placeholder="https://" />
          </Field>
        </div>
      </Card>

      <Card title={t("settings.workshop.branding")}>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="field-label">{t("settings.workshop.logo")}</p>
            <div className="flex items-center gap-4">
              {initial.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Data-URL
                <img src={initial.logoDataUrl} alt="" className="size-14 rounded-md border border-line object-contain p-1" />
              ) : (
                <span className="grid size-14 place-items-center rounded-md border border-dashed border-line-strong text-xs text-ink-muted">–</span>
              )}
              <div className="min-w-0 flex-1">
                <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm" aria-label={t("settings.workshop.logo")} />
                {err.logo ? <p className="field-error">{err.logo}</p> : <p className="field-hint">{t("settings.workshop.logoHint")}</p>}
              </div>
            </div>
            {initial.logoDataUrl ? (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="removeLogo" className="size-4 accent-[var(--accent)]" /> {t("settings.workshop.removeLogo")}
              </label>
            ) : null}
          </div>
          <div>
            <p className="field-label">{t("settings.workshop.accent")}</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  aria-label={c}
                  aria-pressed={accent.toLowerCase() === c}
                  className="size-8 rounded-full border-2 border-surface outline outline-1 outline-line-strong aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ink"
                  style={{ background: c }}
                />
              ))}
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label={t("settings.workshop.accentCustom")} className="size-8 cursor-pointer rounded-md border border-line-strong bg-surface p-0.5" />
              <input type="hidden" name="accentColor" value={accent} />
            </div>
            {err.accentColor ? <p className="field-error">{err.accentColor}</p> : <p className="field-hint">{t("settings.workshop.accentHint")}</p>}
          </div>
        </div>
      </Card>

      <Card title={t("settings.workshop.hours")}>
        <ul className="flex flex-col gap-2">
          {WEEKDAYS.map((day) => (
            <li key={day} className="grid grid-cols-[6rem_1fr] items-center gap-3 sm:grid-cols-[8rem_auto_auto_1fr]">
              <span className="text-sm font-medium">{t(`enums.weekday.${day}`)}</span>
              <label className="flex items-center gap-2 text-sm sm:order-4">
                <input
                  type="checkbox"
                  name={`hours.${day}.closed`}
                  checked={closed[day]}
                  onChange={(e) => setClosed((c) => ({ ...c, [day]: e.target.checked }))}
                  className="size-4 accent-[var(--accent)]"
                />
                {t("settings.workshop.closed")}
              </label>
              <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:contents">
                <Input type="time" name={`hours.${day}.from`} defaultValue={initial.hours[day]?.[0] ?? "07:30"} disabled={closed[day]} aria-label={`${t(`enums.weekday.${day}`)} – ${t("settings.workshop.from")}`} className="w-28" />
                <span className="text-ink-muted sm:hidden">–</span>
                <Input type="time" name={`hours.${day}.to`} defaultValue={initial.hours[day]?.[1] ?? "17:00"} disabled={closed[day]} aria-label={`${t(`enums.weekday.${day}`)} – ${t("settings.workshop.to")}`} className="w-28" />
              </div>
              {err[`hours.${day}`] ? <p className="field-error col-span-full">{err[`hours.${day}`]}</p> : null}
            </li>
          ))}
        </ul>
      </Card>

      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
