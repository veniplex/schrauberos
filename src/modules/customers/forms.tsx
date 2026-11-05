"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input, Textarea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { saveCustomer, saveVehicle } from "./actions";

export type CustomerFormValues = {
  id?: string;
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
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
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

export type VehicleFormValues = {
  id?: string;
  customerId: string;
  plate: string;
  make: string;
  model: string;
  vin: string;
  year: string;
  notes: string;
};

export function VehicleForm({ initial, cancelHref }: { initial: VehicleFormValues; cancelHref: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveVehicle, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="card card-pad flex flex-col gap-4">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="customerId" value={initial.customerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("vehicles.fields.plate")} htmlFor="plate" error={err.plate} required>
          <Input id="plate" name="plate" defaultValue={initial.plate} invalid={!!err.plate} className="font-mono uppercase" placeholder="B-AB 1234" autoComplete="off" required />
        </Field>
        <Field label={t("vehicles.fields.year")} htmlFor="year" error={err.year}>
          <Input id="year" name="year" type="number" inputMode="numeric" defaultValue={initial.year} invalid={!!err.year} placeholder="2021" />
        </Field>
        <Field label={t("vehicles.fields.make")} htmlFor="make">
          <Input id="make" name="make" defaultValue={initial.make} placeholder="VW" autoComplete="off" />
        </Field>
        <Field label={t("vehicles.fields.model")} htmlFor="model">
          <Input id="model" name="model" defaultValue={initial.model} placeholder="Golf VIII" autoComplete="off" />
        </Field>
      </div>
      <Field label={t("vehicles.fields.vin")} htmlFor="vin" error={err.vin} hint={t("vehicles.fields.vinHint")}>
        <Input id="vin" name="vin" defaultValue={initial.vin} invalid={!!err.vin} className="font-mono uppercase" maxLength={17} autoComplete="off" />
      </Field>
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
