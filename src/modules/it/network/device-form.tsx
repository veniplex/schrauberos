"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input, Select, Textarea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { DEVICE_STATUSES, DEVICE_TYPES } from "@/modules/it/network/constants";
import { useI18n } from "@/i18n/client";
import { saveDevice } from "./actions";

export type DeviceFormInitial = {
  id?: string;
  name: string;
  type: string;
  status: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  locationId: string;
  rackInfo: string;
  portCount: string;
  assignedTo: string;
  purchaseDate: string;
  warrantyUntil: string;
  monitorEnabled: boolean;
  notes: string;
};

export function DeviceForm({
  initial,
  locations,
  cancelHref,
}: {
  initial: DeviceFormInitial;
  locations: Array<{ id: string; name: string }>;
  cancelHref: string;
}) {
  const { t, td } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveDevice, {});
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <Card title={t("network.sections.device")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("network.fields.name")} htmlFor="name" error={err.name} required hint={t("network.fields.nameHint")}>
            <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} maxLength={80} required autoComplete="off" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("network.fields.type")} htmlFor="type" required>
              <Select id="type" name="type" defaultValue={initial.type}>
                {DEVICE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {td(`enums.deviceType.${x}`, x)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("common.status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={initial.status}>
                {DEVICE_STATUSES.map((x) => (
                  <option key={x} value={x}>
                    {td(`enums.deviceStatus.${x}`, x)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("network.fields.manufacturer")} htmlFor="manufacturer">
            <Input id="manufacturer" name="manufacturer" defaultValue={initial.manufacturer} maxLength={60} autoComplete="off" />
          </Field>
          <Field label={t("network.fields.model")} htmlFor="model">
            <Input id="model" name="model" defaultValue={initial.model} maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("network.fields.serialNumber")} htmlFor="serialNumber">
            <Input id="serialNumber" name="serialNumber" defaultValue={initial.serialNumber} maxLength={80} className="font-mono" autoComplete="off" />
          </Field>
          <Field label={t("network.fields.assignedTo")} htmlFor="assignedTo" hint={t("network.fields.assignedToHint")}>
            <Input id="assignedTo" name="assignedTo" defaultValue={initial.assignedTo} maxLength={80} autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card title={t("network.sections.placement")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("network.fields.location")} htmlFor="locationId">
            <Select id="locationId" name="locationId" defaultValue={initial.locationId}>
              <option value="">{t("common.none")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("network.fields.rackInfo")} htmlFor="rackInfo" hint={t("network.fields.rackInfoHint")}>
            <Input id="rackInfo" name="rackInfo" defaultValue={initial.rackInfo} maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("network.fields.portCount")} htmlFor="portCount" error={err.portCount} hint={t("network.fields.portCountHint")}>
            <Input id="portCount" name="portCount" type="number" min={1} max={96} defaultValue={initial.portCount} invalid={!!err.portCount} />
          </Field>
        </div>
      </Card>

      <Card title={t("network.sections.lifecycle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("network.fields.purchaseDate")} htmlFor="purchaseDate">
            <Input id="purchaseDate" name="purchaseDate" type="date" defaultValue={initial.purchaseDate} />
          </Field>
          <Field label={t("network.fields.warrantyUntil")} htmlFor="warrantyUntil">
            <Input id="warrantyUntil" name="warrantyUntil" type="date" defaultValue={initial.warrantyUntil} />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" name="monitorEnabled" defaultChecked={initial.monitorEnabled} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            {t("network.fields.monitorEnabled")}
            <span className="block text-xs text-ink-muted">{t("network.fields.monitorHint")}</span>
          </span>
        </label>
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
