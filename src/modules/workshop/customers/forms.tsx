"use client";

import { Field, FormActions, FormCard, Input, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { saveCustomer } from "./actions";

export type CustomerFormValues = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  zip: string;
  city: string;
  notes: string;
};

export function CustomerForm({ initial, cancelHref }: { initial: CustomerFormValues; cancelHref: string }) {
  const { t } = useI18n();
  return (
    <FormCard action={saveCustomer} draftKey={`customer:${initial.id ?? "new"}`}>
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("customers.fields.firstName")} htmlFor="firstName" name="firstName">
          <Input id="firstName" name="firstName" defaultValue={initial.firstName} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.lastName")} htmlFor="lastName" name="lastName">
          <Input id="lastName" name="lastName" defaultValue={initial.lastName} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.company")} htmlFor="company" name="company">
          <Input id="company" name="company" defaultValue={initial.company} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.customerNumber")} htmlFor="customerNumber" name="customerNumber">
          <Input id="customerNumber" name="customerNumber" defaultValue={initial.customerNumber} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.phone")} htmlFor="phone" name="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.email")} htmlFor="email" name="email">
          <Input id="email" name="email" type="email" defaultValue={initial.email} autoComplete="off" />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem_1fr]">
        <Field label={t("customers.fields.street")} htmlFor="street">
          <Input id="street" name="street" defaultValue={initial.street} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.zip")} htmlFor="zip">
          <Input id="zip" name="zip" defaultValue={initial.zip} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.city")} htmlFor="city">
          <Input id="city" name="city" defaultValue={initial.city} autoComplete="off" />
        </Field>
      </div>
      <Field label={t("common.notes")} htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
      </Field>
      <FormActions cancelHref={cancelHref} secondaryLabel={initial.id ? undefined : t("customers.saveAndAddVehicle")} />
    </FormCard>
  );
}
