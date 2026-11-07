"use client";

import { Field, Form, FormActions, FormCard, Input, Textarea } from "@/components/ui/form";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { useI18n } from "@/i18n/client";
import { saveVehicle, transferVehicle } from "./actions";

export type VehicleFormValues = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  /** nur beim Anlegen wählbar */
  customer: SearchOption | null;
  plate: string;
  make: string;
  model: string;
  vin: string;
  year: string;
  notes: string;
};

export function VehicleForm({ initial, cancelHref }: { initial: VehicleFormValues; cancelHref: string }) {
  const { t } = useI18n();
  return (
    <FormCard action={saveVehicle} draftKey={`vehicle:${initial.id ?? "new"}`}>
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("vehicles.fields.plate")} htmlFor="plate" name="plate" required>
          <Input id="plate" name="plate" defaultValue={initial.plate} className="font-mono uppercase" placeholder="B-AB 1234" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
        </Field>
        <Field label={t("vehicles.fields.year")} htmlFor="year" name="year">
          <Input id="year" name="year" type="number" inputMode="numeric" defaultValue={initial.year} placeholder="2021" />
        </Field>
        <Field label={t("vehicles.fields.make")} htmlFor="make">
          <Input id="make" name="make" defaultValue={initial.make} placeholder="VW" autoComplete="off" />
        </Field>
        <Field label={t("vehicles.fields.model")} htmlFor="model">
          <Input id="model" name="model" defaultValue={initial.model} placeholder="Golf VIII" autoComplete="off" />
        </Field>
      </div>
      <Field label={t("vehicles.fields.vin")} htmlFor="vin" name="vin" hint={t("vehicles.fields.vinHint")}>
        <Input id="vin" name="vin" defaultValue={initial.vin} className="font-mono uppercase" maxLength={17} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
      </Field>
      {!initial.id ? (
        <Field label={t("vehicles.fields.owner")} name="customerId" hint={t("vehicles.fields.ownerHint")}>
          <SearchCombobox endpoint="/api/customers/search" name="customerId" initial={initial.customer} placeholder={t("customers.searchPlaceholder")} />
        </Field>
      ) : null}
      <Field label={t("common.notes")} htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
      </Field>
      <FormActions cancelHref={cancelHref} />
    </FormCard>
  );
}

export function TransferForm({ vehicleId, today, closeHref }: { vehicleId: string; today: string; closeHref: string }) {
  const { t } = useI18n();
  return (
    <Form action={transferVehicle} className="flex flex-col gap-4">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <p className="text-sm text-ink-muted">{t("vehicles.transferHint")}</p>
      <Field label={t("vehicles.fields.newOwner")} name="newCustomerId" hint={t("vehicles.fields.newOwnerHint")}>
        <SearchCombobox endpoint="/api/customers/search" name="newCustomerId" placeholder={t("customers.searchPlaceholder")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("vehicles.fields.transferDate")} htmlFor="date" name="date" required>
          <Input id="date" name="date" type="date" defaultValue={today} required />
        </Field>
        <Field label={t("common.notes")} htmlFor="note">
          <Input id="note" name="note" maxLength={300} placeholder={t("vehicles.fields.noteHint")} />
        </Field>
      </div>
      <FormActions cancelHref={closeHref} submitLabel={t("vehicles.transfer")} />
    </Form>
  );
}
