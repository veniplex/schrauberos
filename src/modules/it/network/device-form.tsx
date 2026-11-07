"use client";

import { Checkbox, Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { DEVICE_STATUSES, DEVICE_TYPES } from "@/modules/it/network/constants";
import { useI18n } from "@/i18n/client";
import { saveDevice } from "./actions";

export type DeviceFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
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

  return (
    <Form action={saveDevice} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Card title={t("network.sections.device")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("network.fields.name")} htmlFor="name" name="name" required hint={t("network.fields.nameHint")}>
            <Input id="name" name="name" defaultValue={initial.name} maxLength={80} required autoComplete="off" />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          <Field label={t("network.fields.portCount")} htmlFor="portCount" name="portCount" hint={t("network.fields.portCountHint")}>
            <Input id="portCount" name="portCount" type="number" min={1} max={96} defaultValue={initial.portCount} />
          </Field>
        </div>
      </Card>

      <Card title={t("network.sections.lifecycle")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("network.fields.purchaseDate")} htmlFor="purchaseDate">
            <Input id="purchaseDate" name="purchaseDate" type="date" defaultValue={initial.purchaseDate} />
          </Field>
          <Field label={t("network.fields.warrantyUntil")} htmlFor="warrantyUntil">
            <Input id="warrantyUntil" name="warrantyUntil" type="date" defaultValue={initial.warrantyUntil} />
          </Field>
        </div>
        <Checkbox name="monitorEnabled" defaultChecked={initial.monitorEnabled} label={t("network.fields.monitorEnabled")} hint={t("network.fields.monitorHint")} className="mt-4" />
        <Field label={t("common.notes")} htmlFor="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
