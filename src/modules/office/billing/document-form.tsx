"use client";

import type { ReactNode } from "react";
import { Checkbox, Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { LineItemEditor, type LineItemInitial } from "@/components/ui/line-item-editor";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { useI18n } from "@/i18n/client";
import { saveDraft } from "./actions";
import { ITEM_KINDS, PAYMENT_METHODS } from "./constants";

export type DocumentFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  docType: string;
  customer: SearchOption | null;
  partyName: string;
  partyStreet: string;
  partyZip: string;
  partyCity: string;
  buyerEmail: string;
  introText: string;
  footerText: string;
  serviceFrom: string;
  serviceTo: string;
  validUntil: string;
  paymentDays: string;
  paymentMethod: string;
  buyerReference: string;
  taxNote: string;
  mileageKm: string;
  items: readonly LineItemInitial[];
};

/** Abschlagsrechnung, die eine Schlussrechnung anrechnen kann. */
export type DeductionCandidate = { id: string; label: string; checked: boolean };

/**
 * Formular eines Entwurfs (Angebot, Rechnung, Abschlags- oder Schlussrechnung): Empfänger, Daten je Belegart, Fahrzeug, Texte und die Positionen im Positionen-Editor
 * (rechnet im Browser nach derselben Regel wie der Server; der Server glaubt nur die Eingaben). `exempt`: Kleinunternehmer – der Editor rechnet ohne Steuer. `tools` ist der Platz für Werkzeuge anderer
 * Funktionen (Artikel einfügen). Leere Empfängerfelder werden beim Speichern aus dem gewählten Kunden übernommen.
 */
export function DocumentForm({
  initial,
  exempt,
  canPickCustomer,
  vehicleField,
  candidates,
  tools,
  cancelHref,
}: {
  initial: DocumentFormInitial;
  exempt: boolean;
  canPickCustomer: boolean;
  /** Auswahlfeld für das Fahrzeug (`VehiclePicker`), vom Server gerendert und hier nur eingesetzt – ein Client-Baustein darf `vehicles/public` nicht importieren (zieht Server-Code ins Bündel); `null` = keine Fahrzeugfunktion */
  vehicleField: ReactNode | null;
  candidates: readonly DeductionCandidate[];
  tools?: ReactNode;
  cancelHref: string;
}) {
  const { t, td } = useI18n();
  const invoiceLike = initial.docType === "invoice" || initial.docType === "partial" || initial.docType === "final";
  const kinds = ITEM_KINDS.map((value) => ({ value, label: td(`billing.kinds.${value}`, value) }));

  return (
    <Form action={saveDraft} draftKey={`billing:${initial.id ?? `new-${initial.docType}`}`} className="flex flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : (
        <input type="hidden" name="docType" value={initial.docType} />
      )}

      <Card title={t("billing.sections.recipient")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {canPickCustomer ? (
            <Field label={t("billing.fields.customer")} name="customerId" hint={t("billing.fields.customerHint")} className="sm:col-span-2">
              <SearchCombobox endpoint="/api/customers/search" name="customerId" initial={initial.customer} placeholder={t("customers.searchPlaceholder")} />
            </Field>
          ) : null}
          <Field label={t("billing.fields.partyName")} htmlFor="partyName" name="partyName" className="sm:col-span-2">
            <Input id="partyName" name="partyName" defaultValue={initial.partyName} maxLength={120} autoComplete="off" />
          </Field>
          <Field label={t("billing.fields.partyStreet")} htmlFor="partyStreet" name="partyStreet" className="sm:col-span-2">
            <Input id="partyStreet" name="partyStreet" defaultValue={initial.partyStreet} maxLength={120} autoComplete="off" />
          </Field>
          <Field label={t("billing.fields.partyZip")} htmlFor="partyZip" name="partyZip">
            <Input id="partyZip" name="partyZip" defaultValue={initial.partyZip} maxLength={20} autoComplete="off" inputMode="numeric" />
          </Field>
          <Field label={t("billing.fields.partyCity")} htmlFor="partyCity" name="partyCity">
            <Input id="partyCity" name="partyCity" defaultValue={initial.partyCity} maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("billing.fields.buyerEmail")} htmlFor="buyerEmail" name="buyerEmail" hint={t("billing.fields.buyerEmailHint")} className="sm:col-span-2">
            <Input id="buyerEmail" name="buyerEmail" type="email" defaultValue={initial.buyerEmail} maxLength={254} autoComplete="off" />
          </Field>
        </div>
      </Card>

      {vehicleField ? (
        <Card title={t("billing.sections.vehicle")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("billing.fields.vehicle")} name="vehicleId" hint={t("billing.fields.vehicleHint")}>
              {vehicleField}
            </Field>
            <Field label={t("billing.fields.mileage")} htmlFor="mileageKm" name="mileageKm">
              <Input id="mileageKm" name="mileageKm" type="number" inputMode="numeric" min={0} max={9999999} defaultValue={initial.mileageKm} />
            </Field>
          </div>
        </Card>
      ) : null}

      <Card title={t("billing.sections.dates")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {initial.docType === "offer" ? (
            <Field label={t("billing.fields.validUntil")} htmlFor="validUntil" name="validUntil">
              <Input id="validUntil" name="validUntil" type="date" defaultValue={initial.validUntil} />
            </Field>
          ) : null}
          {invoiceLike ? (
            <>
              <Field label={t("billing.fields.serviceFrom")} htmlFor="serviceFrom" name="serviceFrom" hint={t("billing.fields.serviceHint")}>
                <Input id="serviceFrom" name="serviceFrom" type="date" defaultValue={initial.serviceFrom} />
              </Field>
              <Field label={t("billing.fields.serviceTo")} htmlFor="serviceTo" name="serviceTo">
                <Input id="serviceTo" name="serviceTo" type="date" defaultValue={initial.serviceTo} />
              </Field>
              <Field label={t("billing.fields.paymentDays")} htmlFor="paymentDays" name="paymentDays" hint={t("billing.fields.paymentDaysHint")}>
                <Input id="paymentDays" name="paymentDays" type="number" inputMode="numeric" min={0} max={365} defaultValue={initial.paymentDays} />
              </Field>
              <Field label={t("billing.fields.paymentMethod")} htmlFor="paymentMethod" name="paymentMethod">
                <Select id="paymentMethod" name="paymentMethod" defaultValue={initial.paymentMethod || "transfer"}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {td(`billing.payment.${m}`, m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("billing.fields.buyerReference")} htmlFor="buyerReference" name="buyerReference" hint={t("billing.fields.buyerReferenceHint")} className="sm:col-span-2">
                <Input id="buyerReference" name="buyerReference" defaultValue={initial.buyerReference} maxLength={120} autoComplete="off" />
              </Field>
            </>
          ) : null}
        </div>
      </Card>

      {initial.docType === "final" ? (
        <Card title={t("billing.sections.deductions")}>
          <p className="mb-3 text-sm text-ink-muted">{t("billing.deductions.hint")}</p>
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">{initial.customer ? t("billing.deductions.none") : t("billing.deductions.needCustomer")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {candidates.map((c) => (
                <li key={c.id}>
                  <Checkbox name="deductPartialIds" value={c.id} defaultChecked={c.checked} label={c.label} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title={t("billing.sections.items")}>
        <div className="flex flex-col gap-4">
          {tools}
          <LineItemEditor initialItems={initial.items} exempt={exempt} kinds={kinds} />
          {exempt ? <p className="text-sm text-ink-muted">{t("billing.totals.exempt")}</p> : null}
        </div>
      </Card>

      <Card title={t("billing.sections.texts")}>
        <div className="grid grid-cols-1 gap-4">
          <Field label={t("billing.fields.introText")} htmlFor="introText" name="introText">
            <Textarea id="introText" name="introText" defaultValue={initial.introText} maxLength={2000} rows={3} />
          </Field>
          <Field label={t("billing.fields.footerText")} htmlFor="footerText" name="footerText">
            <Textarea id="footerText" name="footerText" defaultValue={initial.footerText} maxLength={2000} rows={3} />
          </Field>
          {invoiceLike && !exempt ? (
            <Field label={t("billing.fields.taxNote")} htmlFor="taxNote" name="taxNote" hint={t("billing.fields.taxNoteHint")}>
              <Input id="taxNote" name="taxNote" defaultValue={initial.taxNote} maxLength={300} autoComplete="off" />
            </Field>
          ) : null}
        </div>
      </Card>

      <FormActions cancelHref={cancelHref} submitLabel={t("billing.actions.save")} />
    </Form>
  );
}
