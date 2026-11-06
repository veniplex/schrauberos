"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { Field, FormMessage, Input, Select, Textarea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { COST_CATEGORIES, FLEET_STATUSES, FUEL_TYPES } from "@/modules/office/fleet/domain";
import { useI18n } from "@/i18n/client";
import { addCost, addMileage, saveFleetVehicle, saveLicenseCheck } from "./actions";

export type FleetFormInitial = {
  id?: string;
  plate: string;
  make: string;
  model: string;
  vin: string;
  year: string;
  fuelType: string;
  color: string;
  status: string;
  driverId: string;
  location: string;
  huDue: string;
  serviceDue: string;
  serviceDueKm: string;
  insuranceCompany: string;
  insurancePolicy: string;
  insuranceUntil: string;
  leasingProvider: string;
  leasingUntil: string;
  leasingRate: string;
  fuelCardNo: string;
  notes: string;
};

export function FleetForm({ initial, drivers, cancelHref }: { initial: FleetFormInitial; drivers: Array<{ id: string; name: string }>; cancelHref: string }) {
  const { t, td } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveFleetVehicle, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <Card title={t("fleet.sections.vehicle")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("vehicles.fields.plate")} htmlFor="plate" error={err.plate} required>
            <Input id="plate" name="plate" defaultValue={initial.plate} invalid={!!err.plate} className="font-mono uppercase" placeholder="B-FW 100" autoComplete="off" required />
          </Field>
          <Field label={t("vehicles.fields.make")} htmlFor="make">
            <Input id="make" name="make" defaultValue={initial.make} autoComplete="off" />
          </Field>
          <Field label={t("vehicles.fields.model")} htmlFor="model">
            <Input id="model" name="model" defaultValue={initial.model} autoComplete="off" />
          </Field>
          <Field label={t("vehicles.fields.year")} htmlFor="year" error={err.year}>
            <Input id="year" name="year" type="number" defaultValue={initial.year} invalid={!!err.year} />
          </Field>
          <Field label={t("fleet.fields.fuelType")} htmlFor="fuelType">
            <Select id="fuelType" name="fuelType" defaultValue={initial.fuelType}>
              <option value="">{t("common.none")}</option>
              {FUEL_TYPES.map((x) => (
                <option key={x} value={x}>
                  {td(`fleet.fuelTypes.${x}`, x)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fleet.fields.color")} htmlFor="color">
            <Input id="color" name="color" defaultValue={initial.color} maxLength={30} />
          </Field>
          <Field label={t("vehicles.fields.vin")} htmlFor="vin" error={err.vin} hint={t("vehicles.fields.vinHint")} className="sm:col-span-2">
            <Input id="vin" name="vin" defaultValue={initial.vin} invalid={!!err.vin} className="font-mono uppercase" maxLength={17} autoComplete="off" />
          </Field>
          <Field label={t("common.status")} htmlFor="status">
            <Select id="status" name="status" defaultValue={initial.status}>
              {FLEET_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {td(`fleet.statuses.${x}`, x)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fleet.fields.driver")} htmlFor="driverId" error={err.driverId}>
            <Select id="driverId" name="driverId" defaultValue={initial.driverId} invalid={!!err.driverId}>
              <option value="">{t("fleet.noDriver")}</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fleet.fields.location")} htmlFor="location" className="sm:col-span-2">
            <Input id="location" name="location" defaultValue={initial.location} maxLength={80} />
          </Field>
        </div>
      </Card>

      <Card title={t("fleet.sections.dues")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("fleet.fields.huDue")} htmlFor="huDue">
            <Input id="huDue" name="huDue" type="date" defaultValue={initial.huDue} />
          </Field>
          <Field label={t("fleet.fields.serviceDue")} htmlFor="serviceDue">
            <Input id="serviceDue" name="serviceDue" type="date" defaultValue={initial.serviceDue} />
          </Field>
          <Field label={t("fleet.fields.serviceDueKm")} htmlFor="serviceDueKm" error={err.serviceDueKm} hint={t("fleet.fields.serviceDueKmHint")}>
            <Input id="serviceDueKm" name="serviceDueKm" type="number" min={0} defaultValue={initial.serviceDueKm} invalid={!!err.serviceDueKm} />
          </Field>
        </div>
      </Card>

      <Card title={t("fleet.sections.contracts")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("fleet.fields.insuranceCompany")} htmlFor="insuranceCompany">
            <Input id="insuranceCompany" name="insuranceCompany" defaultValue={initial.insuranceCompany} maxLength={80} />
          </Field>
          <Field label={t("fleet.fields.insurancePolicy")} htmlFor="insurancePolicy">
            <Input id="insurancePolicy" name="insurancePolicy" defaultValue={initial.insurancePolicy} maxLength={60} className="font-mono" />
          </Field>
          <Field label={t("fleet.fields.insuranceUntil")} htmlFor="insuranceUntil">
            <Input id="insuranceUntil" name="insuranceUntil" type="date" defaultValue={initial.insuranceUntil} />
          </Field>
          <Field label={t("fleet.fields.leasingProvider")} htmlFor="leasingProvider">
            <Input id="leasingProvider" name="leasingProvider" defaultValue={initial.leasingProvider} maxLength={80} />
          </Field>
          <Field label={t("fleet.fields.leasingUntil")} htmlFor="leasingUntil">
            <Input id="leasingUntil" name="leasingUntil" type="date" defaultValue={initial.leasingUntil} />
          </Field>
          <Field label={t("fleet.fields.leasingRate")} htmlFor="leasingRate" error={err.leasingRate} hint={t("fleet.fields.perMonth")}>
            <Input id="leasingRate" name="leasingRate" inputMode="decimal" defaultValue={initial.leasingRate} invalid={!!err.leasingRate} placeholder="289,00" />
          </Field>
          <Field label={t("fleet.fields.fuelCardNo")} htmlFor="fuelCardNo">
            <Input id="fuelCardNo" name="fuelCardNo" defaultValue={initial.fuelCardNo} maxLength={40} className="font-mono" />
          </Field>
        </div>
        <Field label={t("common.notes")} htmlFor="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

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

/* ───────────── Kilometerstand (Inline) ───────────── */

export function MileageForm({ fleetVehicleId, today }: { fleetVehicleId: string; today: string }) {
  const { t } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await addMileage(prev, fd);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});
  const err = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="fleetVehicleId" value={fleetVehicleId} />
      <Input name="date" type="date" defaultValue={today} aria-label={t("fleet.fields.date")} className="w-40" required />
      <div>
        <Input name="km" type="number" min={0} placeholder="km" aria-label={t("fleet.fields.km")} className="w-36" required invalid={!!err.km} />
        {err.km ? <p className="field-error max-w-56">{err.km}</p> : null}
      </div>
      <Input name="note" placeholder={t("common.notes")} aria-label={t("common.notes")} className="min-w-32 flex-1" maxLength={100} />
      <SubmitButton size="sm" className="mt-0.5">
        {t("common.add")}
      </SubmitButton>
    </form>
  );
}

/* ───────────── Kosten (Inline) ───────────── */

export function CostForm({ fleetVehicleId, today }: { fleetVehicleId: string; today: string }) {
  const { t, td } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await addCost(prev, fd);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});
  const err = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="fleetVehicleId" value={fleetVehicleId} />
      <Input name="date" type="date" defaultValue={today} aria-label={t("fleet.fields.date")} className="w-40" required />
      <Select name="category" defaultValue="fuel" aria-label={t("fleet.fields.category")} className="w-40">
        {COST_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {td(`fleet.costCategories.${c}`, c)}
          </option>
        ))}
      </Select>
      <div>
        <Input name="amount" inputMode="decimal" placeholder="0,00 €" aria-label={t("fleet.fields.amount")} className="w-32" required invalid={!!err.amount} />
        {err.amount ? <p className="field-error max-w-40">{err.amount}</p> : null}
      </div>
      <Input name="km" type="number" min={0} placeholder="km" aria-label={t("fleet.fields.km")} className="w-28" />
      <Input name="note" placeholder={t("common.notes")} aria-label={t("common.notes")} className="min-w-32 flex-1" maxLength={100} />
      <SubmitButton size="sm" className="mt-0.5">
        {t("common.add")}
      </SubmitButton>
    </form>
  );
}

/* ───────────── Führerscheinkontrolle (Modal) ───────────── */

export function LicenseCheckForm({
  employees,
  initialEmployeeId,
  today,
  closeHref,
}: {
  employees: Array<{ id: string; name: string }>;
  initialEmployeeId: string;
  today: string;
  closeHref: string;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveLicenseCheck, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("fleet.fields.driver")} htmlFor="employeeId" error={err.employeeId} required>
          <Select id="employeeId" name="employeeId" defaultValue={initialEmployeeId} required>
            <option value="" disabled>
              {t("employees.fields.choose")}
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("fleet.fields.checkedAt")} htmlFor="checkedAt" error={err.checkedAt} required>
          <Input id="checkedAt" name="checkedAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={t("fleet.fields.method")} htmlFor="method" hint={t("fleet.fields.methodHint")}>
          <Input id="method" name="method" maxLength={60} placeholder={t("fleet.fields.methodPlaceholder")} />
        </Field>
        <Field label={t("common.notes")} htmlFor="note">
          <Input id="note" name="note" maxLength={200} />
        </Field>
      </div>
      <p className="text-sm text-ink-muted">{t("fleet.licenseNextHint")}</p>
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Link href={closeHref} className="btn btn-secondary">
          {t("common.cancel")}
        </Link>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
