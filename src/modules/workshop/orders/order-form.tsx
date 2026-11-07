"use client";

import { Field, Form, FormActions, Input, Textarea } from "@/components/ui/form";
import { Card, Plate } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { VehiclePicker, type VehicleOption } from "@/modules/workshop/vehicles/public";
import { createOrder, updateOrder } from "./actions";

export type OrderFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  vehicle: VehicleOption | null;
  /** Termin, aus dem der Auftrag entsteht (nur Anlegen) */
  appointmentId?: string;
  appointmentLabel?: string;
  request: string;
  mileageKm: string;
};

/** Auftrag annehmen oder (Kundenwunsch, Kilometerstand) bearbeiten. Das Fahrzeug lässt sich nach dem Anlegen nicht mehr ändern. */
export function OrderForm({ initial, cancelHref, canCreateVehicle = false }: { initial: OrderFormInitial; cancelHref: string; canCreateVehicle?: boolean }) {
  const { t } = useI18n();
  return (
    <Form action={initial.id ? updateOrder : createOrder} draftKey={`order:${initial.id ?? "new"}`} className="flex flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      {initial.appointmentId ? <input type="hidden" name="appointmentId" value={initial.appointmentId} /> : null}

      <Card title={t("orders.sections.vehicle")}>
        <Field label={t("orders.fields.vehicle")} name="vehicleId" required hint={initial.appointmentLabel ? t("orders.fields.fromAppointment", { title: initial.appointmentLabel }) : undefined}>
          {initial.id && initial.vehicle ? (
            <>
              <input type="hidden" name="vehicleId" value={initial.vehicle.id} />
              <p className="text-sm">
                <Plate>{initial.vehicle.plate}</Plate> <span className="ml-2 text-ink-muted">{[initial.vehicle.description, initial.vehicle.customer].filter(Boolean).join(" · ")}</span>
              </p>
            </>
          ) : (
            <VehiclePicker initial={initial.vehicle} canCreate={canCreateVehicle} required />
          )}
        </Field>
      </Card>

      <Card title={t("orders.sections.request")}>
        <div className="grid grid-cols-1 gap-4">
          <Field label={t("orders.fields.request")} htmlFor="request" name="request" hint={t("orders.fields.requestHint")}>
            <Textarea id="request" name="request" defaultValue={initial.request} maxLength={4000} rows={4} />
          </Field>
          <Field label={t("orders.fields.mileage")} htmlFor="mileageKm" name="mileageKm" hint={t("orders.fields.mileageHint")} className="max-w-xs">
            <Input id="mileageKm" name="mileageKm" type="number" inputMode="numeric" min={0} max={9999999} defaultValue={initial.mileageKm} />
          </Field>
        </div>
      </Card>

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
