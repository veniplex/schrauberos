"use client";

import { useState } from "react";
import { Checkbox, ColorPicker, Field, FileInput, Form, FormActions, FormFieldError, Input, Select } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { ACCENT_PRESETS, ACCENT_PRESET_NAMES, isHexColor } from "@/lib/color";
import { accentTextContrast } from "@/lib/color-contrast";
import { WEEKDAYS } from "@/lib/constants";
import { previewInvoiceNumbers } from "@/lib/invoice-number-format";
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
  logoSrc: string | null;
  hours: OpeningHours;
  timezone: string;
  // Rechnungsangaben (P4b-7)
  taxNumber: string;
  vatId: string;
  smallBusiness: boolean;
  bankName: string;
  iban: string;
  bic: string;
  paymentTermDays: number;
  managingDirector: string;
  registerCourt: string;
  registerNumber: string;
  /** Stundenverrechnungssatz als Eingabetext ("95,00") */
  hourlyRate: string;
  workUnitMinutes: number;
  invoiceNumberFormat: string;
};

export function WorkshopForm({
  initial,
  timezones,
  previewWhen,
}: {
  initial: WorkshopFormInitial;
  timezones: string[];
  /** Jahr und Monat für die Vorschau der Rechnungsnummer (vom Server, ohne Uhr im Bauteil) */
  previewWhen: { year: number; month: number };
}) {
  const { t } = useI18n();
  const [numberFormat, setNumberFormat] = useState(initial.invoiceNumberFormat);
  const numberPreview = previewInvoiceNumbers(numberFormat, previewWhen);
  const [accent, setAccent] = useState(initial.accentColor);
  // Eine frei gewählte Farbe kann als Textfarbe (Links, Reiter) zu blass sein: warnen, wenn der Kontrast unter 4,5 : 1 fällt
  const contrast = isHexColor(accent) ? accentTextContrast(accent) : null;
  const lowContrast = contrast !== null && Math.min(contrast.light, contrast.dark) < 4.5;
  const [closed, setClosed] = useState(() => Object.fromEntries(WEEKDAYS.map((d) => [d, initial.hours[d] === null])));

  return (
    <Form action={saveWorkshop} encType="multipart/form-data" className="flex max-w-4xl flex-col gap-5">
      <Card title={t("settings.workshop.identity")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <Input id="zip" name="zip" defaultValue={initial.zip} inputMode="numeric" autoComplete="off" />
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

      <Card title={t("settings.workshop.billing.title")}>
        <p className="mb-4 text-sm text-ink-muted">{t("settings.workshop.billing.hint")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("settings.workshop.billing.taxNumber")} htmlFor="taxNumber" name="taxNumber" hint={t("settings.workshop.billing.taxNumberHint")}>
            <Input id="taxNumber" name="taxNumber" defaultValue={initial.taxNumber} maxLength={30} autoComplete="off" />
          </Field>
          <Field label={t("settings.workshop.billing.vatId")} htmlFor="vatId" name="vatId" hint={t("settings.workshop.billing.vatIdHint")}>
            <Input id="vatId" name="vatId" defaultValue={initial.vatId} maxLength={30} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="DE123456789" />
          </Field>
          <Field label={t("settings.workshop.billing.smallBusiness")} name="smallBusiness" hint={t("settings.workshop.billing.smallBusinessHint")} group className="sm:col-span-2">
            <Checkbox name="smallBusiness" defaultChecked={initial.smallBusiness} label={t("settings.workshop.billing.smallBusinessLabel")} />
          </Field>
          <Field label={t("settings.workshop.billing.managingDirector")} htmlFor="managingDirector">
            <Input id="managingDirector" name="managingDirector" defaultValue={initial.managingDirector} maxLength={120} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("settings.workshop.billing.registerCourt")} htmlFor="registerCourt">
              <Input id="registerCourt" name="registerCourt" defaultValue={initial.registerCourt} maxLength={120} placeholder={t("settings.workshop.billing.registerCourtPlaceholder")} />
            </Field>
            <Field label={t("settings.workshop.billing.registerNumber")} htmlFor="registerNumber">
              <Input id="registerNumber" name="registerNumber" defaultValue={initial.registerNumber} maxLength={60} placeholder="HRB 12345" />
            </Field>
          </div>
          <Field label={t("settings.workshop.billing.bankName")} htmlFor="bankName">
            <Input id="bankName" name="bankName" defaultValue={initial.bankName} maxLength={80} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label={t("settings.workshop.billing.iban")} htmlFor="iban" name="iban">
              <Input id="iban" name="iban" defaultValue={initial.iban} maxLength={42} className="font-mono" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="DE89 3704 0044 0532 0130 00" />
            </Field>
            <Field label={t("settings.workshop.billing.bic")} htmlFor="bic" name="bic" hint={t("settings.workshop.billing.bicHint")}>
              <Input id="bic" name="bic" defaultValue={initial.bic} maxLength={14} className="font-mono" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </Field>
          </div>
          <Field label={t("settings.workshop.billing.paymentTermDays")} htmlFor="paymentTermDays" name="paymentTermDays" hint={t("settings.workshop.billing.paymentTermDaysHint")}>
            <Input id="paymentTermDays" name="paymentTermDays" type="number" inputMode="numeric" min={0} max={365} defaultValue={initial.paymentTermDays} />
          </Field>
          <Field label={t("settings.workshop.billing.hourlyRate")} htmlFor="hourlyRate" name="hourlyRate" hint={t("settings.workshop.billing.hourlyRateHint")}>
            <Input id="hourlyRate" name="hourlyRate" inputMode="decimal" defaultValue={initial.hourlyRate} autoComplete="off" placeholder="95,00" />
          </Field>
          <Field label={t("settings.workshop.billing.workUnitMinutes")} htmlFor="workUnitMinutes" name="workUnitMinutes" hint={t("settings.workshop.billing.workUnitMinutesHint")}>
            <Input id="workUnitMinutes" name="workUnitMinutes" type="number" inputMode="numeric" min={1} max={60} defaultValue={initial.workUnitMinutes} />
          </Field>
          <Field
            label={t("settings.workshop.billing.numberFormat")}
            htmlFor="invoiceNumberFormat"
            name="invoiceNumberFormat"
            hint={numberPreview.length > 0 ? t("settings.workshop.billing.numberFormatPreview", { examples: numberPreview.join(", ") }) : t("settings.workshop.billing.numberFormatHint")}
          >
            <Input id="invoiceNumberFormat" name="invoiceNumberFormat" value={numberFormat} onChange={(e) => setNumberFormat(e.target.value)} maxLength={60} className="font-mono" autoComplete="off" autoCorrect="off" spellCheck={false} />
          </Field>
          <p className="text-sm text-ink-muted sm:col-span-2">{t("settings.workshop.billing.numberFormatHelp")}</p>
        </div>
      </Card>

      <Card title={t("settings.workshop.branding")}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label={t("settings.workshop.logo")} name="logo" hint={t("settings.workshop.logoHint")}>
            <div className="flex items-center gap-4">
              {initial.logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- Logo aus dem Werkstatt-Profil (/api/logo)
                <img src={initial.logoSrc} alt="" className="size-14 rounded-md border border-line object-contain p-1" />
              ) : (
                <span className="grid size-14 place-items-center rounded-md border border-dashed border-line-strong text-xs text-ink-muted">–</span>
              )}
              <div className="min-w-0 flex-1">
                <FileInput name="logo" accept="image/png,image/jpeg,image/webp" maxBytes={MAX_LOGO_BYTES} />
              </div>
            </div>
            {initial.logoSrc ? (
              <Checkbox name="removeLogo" label={t("settings.workshop.removeLogo")} className="mt-3" />
            ) : null}
          </Field>
          <Field label={t("settings.workshop.accent")} name="accentColor" hint={t("settings.workshop.accentHint")} group>
            <ColorPicker name="accentColor" value={accent} presets={ACCENT_PRESETS.map((value, i) => ({ value, label: t(`settings.workshop.accentNames.${ACCENT_PRESET_NAMES[i]}`) }))} onChange={setAccent} customLabel={t("settings.workshop.accentCustom")} />
          </Field>
          {lowContrast ? <Alert tone="warning">{t("settings.workshop.accentLowContrast")}</Alert> : null}
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
                aria-label={`${t(`enums.weekday.${day}`)} ${t("settings.workshop.closed").toLowerCase()}`}
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
