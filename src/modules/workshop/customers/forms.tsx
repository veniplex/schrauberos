"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input, Textarea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
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
  const [state, action] = useActionState<ActionState, FormData>(saveCustomer, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="card card-pad flex flex-col gap-4">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("customers.fields.firstName")} htmlFor="firstName" error={err.firstName}>
          <Input id="firstName" name="firstName" defaultValue={initial.firstName} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.lastName")} htmlFor="lastName" error={err.lastName}>
          <Input id="lastName" name="lastName" defaultValue={initial.lastName} invalid={!!err.lastName} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.company")} htmlFor="company" error={err.company}>
          <Input id="company" name="company" defaultValue={initial.company} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.customerNumber")} htmlFor="customerNumber" error={err.customerNumber}>
          <Input id="customerNumber" name="customerNumber" defaultValue={initial.customerNumber} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.phone")} htmlFor="phone" error={err.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" />
        </Field>
        <Field label={t("customers.fields.email")} htmlFor="email" error={err.email}>
          <Input id="email" name="email" type="email" defaultValue={initial.email} invalid={!!err.email} autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_1fr]">
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
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Link href={cancelHref} className="btn btn-secondary">
          {t("common.cancel")}
        </Link>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
