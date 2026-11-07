"use client";

import { DuplicateNotice } from "@/components/ui/duplicate-notice";
import { Field, Form, FormActions, FormCard, Input, Select, Textarea } from "@/components/ui/form";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { useI18n } from "@/i18n/client";
import { saveVehicle, transferVehicle } from "./actions";
import { EXTRA_INSPECTION_KINDS, FUEL_TYPES } from "./domain";

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
  mileage: string;
  fuel: string;
  hsn: string;
  tsn: string;
  /** JJJJ-MM-TT */
  firstRegistration: string;
  /** JJJJ-MM */
  inspectionDue: string;
  extraKind: string;
  /** JJJJ-MM-TT */
  extraDue: string;
  notes: string;
};

export function VehicleForm({ initial, cancelHref }: { initial: VehicleFormValues; cancelHref: string }) {
  const { t, td } = useI18n();
  return (
    <FormCard action={saveVehicle} draftKey={`vehicle:${initial.id ?? "new"}`}>
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      {/* Kennzeichen-Dublette: eine Warnung mit Bestätigung, keine Sperre (die Aktion nennt das vorhandene Fahrzeug im Fehlerzustand) */}
      <DuplicateNotice
        title={t("vehicles.duplicate.title")}
        message={(data) => `${t("vehicles.duplicate.message", { plate: data.duplicatePlate ?? "", owner: data.duplicateOwner ? t("vehicles.duplicate.ownerPart", { owner: data.duplicateOwner }) : "" })} ${t("vehicles.duplicate.archiveOldHint")}`}
        openLabel={t("vehicles.duplicate.open")}
        openHref={(id) => `/vehicles/${id}`}
        anywayLabel={initial.id ? t("vehicles.duplicate.anywaySave") : t("vehicles.duplicate.anywayCreate")}
        archiveLabel={t("vehicles.duplicate.archiveOld")}
      />
      <Field label={t("vehicles.fields.vin")} htmlFor="vin" name="vin" hint={t("vehicles.fields.vinHint")}>
        <Input id="vin" name="vin" defaultValue={initial.vin} className="font-mono uppercase" maxLength={17} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
      </Field>
      {!initial.id ? (
        <Field label={t("vehicles.fields.owner")} name="customerId" hint={t("vehicles.fields.ownerHint")}>
          <SearchCombobox endpoint="/api/customers/search" name="customerId" initial={initial.customer} placeholder={t("customers.searchPlaceholder")} />
        </Field>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold">{t("vehicles.sections.inspections")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("vehicles.fields.inspectionDue")} htmlFor="inspectionDue" name="inspectionDue" hint={t("vehicles.fields.inspectionDueHint")}>
            <Input id="inspectionDue" name="inspectionDue" type="month" defaultValue={initial.inspectionDue} placeholder="11/2026" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 gap-4">
            <Field label={t("vehicles.fields.extraKind")} htmlFor="extraInspectionKind" name="extraInspectionKind" hint={t("vehicles.fields.extraHint")}>
              <Select id="extraInspectionKind" name="extraInspectionKind" defaultValue={initial.extraKind}>
                <option value="">{t("vehicles.fields.extraKindNone")}</option>
                {EXTRA_INSPECTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {td(`vehicles.extraKinds.${kind}`, kind)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("vehicles.fields.extraDue")} htmlFor="extraInspectionDue" name="extraInspectionDue">
              <Input id="extraInspectionDue" name="extraInspectionDue" type="date" defaultValue={initial.extraDue} />
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold">{t("vehicles.sections.registration")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("vehicles.fields.mileage")} htmlFor="mileageKm" name="mileageKm" hint={t("vehicles.fields.mileageHint")}>
            <Input id="mileageKm" name="mileageKm" inputMode="numeric" defaultValue={initial.mileage} autoComplete="off" placeholder="123456" />
          </Field>
          <Field label={t("vehicles.fields.fuel")} htmlFor="fuel" name="fuel">
            <Select id="fuel" name="fuel" defaultValue={initial.fuel}>
              <option value="" />
              {FUEL_TYPES.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {td(`vehicles.fuelTypes.${fuel}`, fuel)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("vehicles.fields.firstRegistration")} htmlFor="firstRegistration" name="firstRegistration">
            <Input id="firstRegistration" name="firstRegistration" type="date" defaultValue={initial.firstRegistration} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("vehicles.fields.hsn")} htmlFor="hsn" name="hsn">
              <Input id="hsn" name="hsn" defaultValue={initial.hsn} className="font-mono uppercase" maxLength={4} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </Field>
            <Field label={t("vehicles.fields.tsn")} htmlFor="tsn" name="tsn">
              <Input id="tsn" name="tsn" defaultValue={initial.tsn} className="font-mono uppercase" maxLength={3} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </Field>
            <p className="col-span-2 -mt-2 text-xs text-ink-muted">{t("vehicles.fields.keysHint")}</p>
          </div>
        </div>
      </fieldset>

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
