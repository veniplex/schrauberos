"use server";

import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { isHexColor } from "@/lib/color";
import { toTimeInput } from "@/lib/dates";
import { formObject, safeReturn } from "@/lib/forms";
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES } from "@/modules/workshop/appointments/constants";
import { defineAction, defineOperation, fail, failField, type RunContext } from "@/server/operations";
import { appointmentWindow, findBayClash } from "./domain";

const refresh = ["/appointments", "/", "/tires"] as const;

const appointmentInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  typeId: z.string().optional(),
  vehicleId: z.string().optional(),
  bayId: z.string().optional(),
  assigneeId: z.string().optional(),
  tireSetId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(5).max(720),
  status: z.enum(APPOINTMENT_STATUSES).default("scheduled"),
  notes: z.string().max(2000).optional(),
  returnTo: z.string().optional(),
});

type AppointmentInput = z.output<typeof appointmentInput>;

/** Gemeinsamer Ablauf von Anlegen und Ändern (je ein eigenes Recht, daher zwei Operationen). */
async function saveAppointmentRun({ input: d, principal, tx, audit }: RunContext<AppointmentInput, undefined>): Promise<{ id: string }> {
  const window = appointmentWindow(d.date, d.time, d.duration);
  if (!window) failField("date", "validation.invalid");
  const { startsAt, endsAt } = window;

  const vehicle = d.vehicleId ? await tx.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, customerId: true } }) : null;
  if (d.vehicleId && !vehicle) failField("vehicleId", "validation.invalid");

  // Alle Verweise müssen existieren (statt eines Datenbankfehlers); Terminart, Arbeitsplatz und Mitarbeiter müssen aktiv sein –
  // es sei denn, der bestehende Termin hat sie schon (dann bleibt der Wert unverändert möglich).
  const current = d.id ? await tx.appointment.findUnique({ where: { id: d.id }, select: { typeId: true, bayId: true, assigneeId: true } }) : null;
  if (d.id && !current) fail("notFound");
  if (d.typeId && d.typeId !== current?.typeId && !(await tx.appointmentType.findFirst({ where: { id: d.typeId, active: true }, select: { id: true } }))) failField("typeId", "validation.invalid");
  if (d.bayId && d.bayId !== current?.bayId && !(await tx.bay.findFirst({ where: { id: d.bayId, active: true }, select: { id: true } }))) failField("bayId", "validation.invalid");
  if (d.assigneeId && d.assigneeId !== current?.assigneeId && !(await tx.user.findFirst({ where: { id: d.assigneeId, active: true }, select: { id: true } }))) failField("assigneeId", "validation.invalid");
  if (d.tireSetId) {
    // Der Reifensatz muss existieren und zum gewählten Fahrzeug gehören
    const set = await tx.tireSet.findUnique({ where: { id: d.tireSetId }, select: { vehicleId: true } });
    if (!set) failField("tireSetId", "validation.invalid");
    if (!vehicle || set.vehicleId !== vehicle.id) failField("vehicleId", "appointments.errors.tireSetMismatch");
  }

  // Doppelbelegung des Arbeitsplatzes: Prüfen und Speichern laufen in derselben Transaktion (SQLite hat einen Schreiber), zwei
  // gleichzeitige Buchungen desselben Arbeitsplatzes schieben sich also nicht beide an der Prüfung vorbei. Die Entscheidung trifft die
  // reine Funktion `findBayClash`; die Abfrage grenzt nur grob auf Arbeitsplatz und Zeitfenster ein.
  if (d.bayId) {
    const candidates = await tx.appointment.findMany({
      where: { bayId: d.bayId, id: d.id ? { not: d.id } : undefined, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      include: { vehicle: { select: { plate: true } } },
    });
    const clash = findBayClash({ id: d.id, bayId: d.bayId, status: d.status, startsAt, endsAt }, candidates);
    if (clash) failField("bayId", "appointments.errors.bayBusy", { from: toTimeInput(clash.startsAt), to: toTimeInput(clash.endsAt), title: clash.vehicle?.plate ?? clash.title });
  }

  const data = {
    title: d.title,
    startsAt,
    endsAt,
    status: d.status,
    notes: d.notes ?? null,
    typeId: d.typeId ?? null,
    bayId: d.bayId ?? null,
    assigneeId: d.assigneeId ?? null,
    vehicleId: vehicle?.id ?? null,
    customerId: vehicle?.customerId ?? null,
    tireSetId: d.tireSetId ?? null,
  };
  let id: string;
  if (d.id) {
    if (!(await claimRow(tx.appointment, d.id, d.version))) fail("conflict");
    await tx.appointment.update({ where: { id: d.id }, data });
    id = d.id;
  } else {
    id = (await tx.appointment.create({ data: { ...data, createdById: principal.user.id } })).id;
  }
  audit({ target: d.title, entityId: id });
  return { id };
}

const afterSave = {
  form: formObject,
  revalidate: [...refresh],
  redirect: (_data: unknown, input: AppointmentInput) => safeReturn(input.returnTo, "/appointments", `/appointments?date=${input.date}`),
};

const createAppointmentOperation = defineOperation({
  name: "appointments.create",
  permission: "appointments.create",
  input: appointmentInput.refine((d) => !d.id, { message: "validation.invalid", path: ["id"] }),
  audit: "appointment.create",
  run: saveAppointmentRun,
});

const updateAppointmentOperation = defineOperation({
  name: "appointments.update",
  permission: "appointments.edit",
  input: appointmentInput.refine((d) => !!d.id, { message: "validation.invalid", path: ["id"] }),
  audit: "appointment.update",
  run: saveAppointmentRun,
});

/** Neuen Termin anlegen (Formular ohne `id`). */
export const createAppointment = defineAction(createAppointmentOperation, afterSave);
/** Bestehenden Termin ändern (Formular mit `id` und `version`). */
export const updateAppointment = defineAction(updateAppointmentOperation, afterSave);

const deleteAppointmentOperation = defineOperation({
  name: "appointments.delete",
  permission: "appointments.delete",
  input: z.object({ id: z.string().min(1), returnTo: z.string().optional() }),
  audit: "appointment.delete",
  run: async ({ input, tx, audit }) => {
    const appointment = await tx.appointment.findUnique({ where: { id: input.id }, select: { title: true } });
    if (!appointment) fail("notFound");
    await tx.appointment.delete({ where: { id: input.id } });
    audit({ target: appointment.title, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteAppointment = defineAction(deleteAppointmentOperation, {
  revalidate: [...refresh],
  redirect: (_data, input) => safeReturn(input.returnTo, "/appointments", "/appointments"),
  message: "common.deleted",
  redirectOnError: (formData) => safeReturn(String(formData.get("returnTo") ?? ""), "/appointments", "/appointments"),
});

/* ───────────── Einstellungen (Kalender) ───────────── */

const settingsInput = z
  .object({
    dayStartHour: z.coerce.number().int().min(0).max(23),
    dayEndHour: z.coerce.number().int().min(1).max(24),
    slotMinutes: z.coerce.number().int().refine((v) => [10, 15, 20, 30, 60].includes(v)),
  })
  .superRefine((d, ctx) => {
    if (d.dayEndHour <= d.dayStartHour) ctx.addIssue({ code: "custom", message: "appointments.settings.errors.hoursOrder", path: ["dayEndHour"] });
  });

const saveSettingsOperation = defineOperation({
  name: "appointments.saveSettings",
  permission: "appointments.configure",
  input: settingsInput,
  audit: "settings.appointments",
  run: async ({ input: d, tx, audit }) => {
    await tx.appointmentSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
    audit({ target: `${d.dayStartHour}–${d.dayEndHour}, ${d.slotMinutes} min`, entityId: "default" });
    return {};
  },
});

export const saveAppointmentSettings = defineAction(saveSettingsOperation, { form: formObject, revalidate: ["/appointments"], message: "common.saved" });

/* ───────────── Arbeitsplätze ───────────── */

const bayInput = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(60), sortOrder: z.coerce.number().int().min(0).max(999).default(0), active: z.boolean() });

const saveBayOperation = defineOperation({
  name: "appointments.saveBay",
  permission: "appointments.configure",
  input: bayInput,
  audit: "settings.appointments",
  run: async ({ input: { id, ...data }, tx, audit }) => {
    // Neue Arbeitsplätze sind immer aktiv; das Häkchen gilt nur beim Bearbeiten
    const saved = id ? await tx.bay.update({ where: { id }, data }) : await tx.bay.create({ data: { ...data, active: true } });
    audit({ target: `Bay: ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const saveBay = defineAction(saveBayOperation, {
  form: (fd) => ({ ...formObject(fd), active: fd.get("active") === "on" }),
  revalidate: ["/appointments"],
  message: "common.saved",
});

const deleteBayOperation = defineOperation({
  name: "appointments.deleteBay",
  permission: "appointments.configure",
  input: z.object({ id: z.string().min(1) }),
  audit: "settings.appointments",
  run: async ({ input, tx, audit }) => {
    const bay = await tx.bay.findUnique({ where: { id: input.id }, select: { name: true } });
    if (!bay) fail("notFound");
    await tx.bay.delete({ where: { id: input.id } });
    audit({ target: `Bay deleted: ${bay.name}`, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteBay = defineAction(deleteBayOperation, { revalidate: ["/appointments"], message: "common.deleted" });

/* ───────────── Terminarten ───────────── */

const typeInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  color: z.string().refine(isHexColor),
  defaultMinutes: z.coerce.number().int().min(5).max(720),
  kind: z.enum(APPOINTMENT_KINDS).default("general"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean(),
});

const saveTypeOperation = defineOperation({
  name: "appointments.saveType",
  permission: "appointments.configure",
  input: typeInput,
  audit: "settings.appointments",
  run: async ({ input: { id, ...data }, tx, audit }) => {
    const saved = id ? await tx.appointmentType.update({ where: { id }, data }) : await tx.appointmentType.create({ data: { ...data, active: true } });
    audit({ target: `Type: ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const saveAppointmentType = defineAction(saveTypeOperation, {
  form: (fd) => ({ ...formObject(fd), active: fd.get("active") === "on" }),
  revalidate: ["/appointments"],
  message: "common.saved",
});

const deleteTypeOperation = defineOperation({
  name: "appointments.deleteType",
  permission: "appointments.configure",
  input: z.object({ id: z.string().min(1) }),
  audit: "settings.appointments",
  run: async ({ input, tx, audit }) => {
    const type = await tx.appointmentType.findUnique({ where: { id: input.id }, select: { name: true } });
    if (!type) fail("notFound");
    await tx.appointmentType.delete({ where: { id: input.id } });
    audit({ target: `Type deleted: ${type.name}`, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteAppointmentType = defineAction(deleteTypeOperation, { revalidate: ["/appointments"], message: "common.deleted" });
