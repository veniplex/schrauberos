"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Disc3 } from "lucide-react";
import { Field, FormMessage, Input, Select, Textarea, type ActionState } from "@/components/ui/form";
import { ConfirmSubmitButton, SubmitButton } from "@/components/ui/buttons";
import { VehicleCombobox, type VehicleOption } from "@/modules/customers/vehicle-combobox";
import { APPOINTMENT_STATUSES } from "@/lib/domain/constants";
import { useI18n } from "@/i18n/client";
import { deleteAppointment, saveAppointment } from "./actions";

export type AppointmentFormInitial = {
  id?: string;
  title: string;
  typeId: string;
  bayId: string;
  assigneeId: string;
  vehicle: VehicleOption | null;
  tireSet: { id: string; label: string } | null;
  date: string;
  time: string;
  duration: number;
  status: string;
  notes: string;
};

export type AppointmentFormOptions = {
  types: Array<{ id: string; name: string; defaultMinutes: number }>;
  bays: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
};

export function AppointmentForm({
  initial,
  options,
  returnTo,
  closeHref,
  canDelete,
}: {
  initial: AppointmentFormInitial;
  options: AppointmentFormOptions;
  returnTo: string;
  closeHref: string;
  canDelete: boolean;
}) {
  const { t, td } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveAppointment, {});
  const [typeId, setTypeId] = useState(initial.typeId);
  const [title, setTitle] = useState(initial.title);
  const [duration, setDuration] = useState(initial.duration);
  const err = state.fieldErrors ?? {};

  function onTypeChange(id: string) {
    const prev = options.types.find((x) => x.id === typeId);
    const next = options.types.find((x) => x.id === id);
    setTypeId(id);
    if (!next) return;
    // Titel/Dauer nur überschreiben, wenn der Nutzer sie nicht selbst geändert hat
    if (!title.trim() || title === prev?.name) setTitle(next.name);
    if (!initial.id) setDuration(next.defaultMinutes);
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-4">
        {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        {initial.tireSet ? <input type="hidden" name="tireSetId" value={initial.tireSet.id} /> : null}

        {initial.tireSet ? (
          <p className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-sm text-info-ink">
            <Disc3 className="size-4 shrink-0" aria-hidden />
            <span>{t("appointments.linkedTireSet", { set: initial.tireSet.label })}</span>
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("appointments.fields.type")} htmlFor="typeId">
            <Select id="typeId" name="typeId" value={typeId} onChange={(e) => onTypeChange(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {options.types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("appointments.fields.title")} htmlFor="title" error={err.title} required>
            <Input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!err.title} maxLength={120} />
          </Field>
        </div>

        <Field label={t("appointments.fields.vehicle")} error={err.vehicleId} hint={t("appointments.fields.vehicleHint")}>
          <VehicleCombobox initial={initial.vehicle} invalid={!!err.vehicleId} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("appointments.fields.date")} htmlFor="date" error={err.date} required>
            <Input id="date" name="date" type="date" defaultValue={initial.date} invalid={!!err.date} required />
          </Field>
          <Field label={t("appointments.fields.time")} htmlFor="time" error={err.time} required>
            {/* 5-Minuten-Schritte: bestehende Termine dürfen auch außerhalb des Kalenderrasters liegen */}
            <Input id="time" name="time" type="time" step={300} defaultValue={initial.time} invalid={!!err.time} required />
          </Field>
          <Field label={t("appointments.fields.duration")} htmlFor="duration" error={err.duration} required>
            <Input
              id="duration"
              name="duration"
              type="number"
              min={5}
              max={720}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              invalid={!!err.duration}
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("appointments.fields.bay")} htmlFor="bayId" error={err.bayId}>
            <Select id="bayId" name="bayId" defaultValue={initial.bayId} invalid={!!err.bayId}>
              <option value="">{t("common.none")}</option>
              {options.bays.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("appointments.fields.assignee")} htmlFor="assigneeId">
            <Select id="assigneeId" name="assigneeId" defaultValue={initial.assigneeId}>
              <option value="">{t("common.none")}</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.status")} htmlFor="status">
            <Select id="status" name="status" defaultValue={initial.status}>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {td(`enums.appointmentStatus.${s}`, s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t("common.notes")} htmlFor="notes" error={err.notes}>
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>

        <FormMessage state={state} />

        <div className="flex justify-end gap-2">
          <Link href={closeHref} className="btn btn-secondary">
            {t("common.cancel")}
          </Link>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </form>

      {initial.id && canDelete ? (
        <form action={deleteAppointment} className="border-t border-line pt-4">
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <ConfirmSubmitButton message={t("appointments.confirmDelete")}>{t("appointments.delete")}</ConfirmSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
