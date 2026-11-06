"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES } from "@/modules/workshop/appointments/constants";
import { isHexColor } from "@/lib/color";
import { parseLocalDateTime } from "@/lib/dates";
import { fieldErrors, formObject, safeReturn } from "@/lib/forms";
import { audit } from "@/server/audit";
import { claimed } from "@/lib/concurrency";

const schema = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  title: z.string().max(120),
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

export async function saveAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formObject(formData);
  const session = await requirePermission(raw.id ? "appointments.edit" : "appointments.create");
  const i18n = await getI18n();
  const { t } = i18n;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  if (!d.title.trim()) return { fieldErrors: { title: t("validation.required") } };

  const startsAt = parseLocalDateTime(d.date, d.time);
  if (!startsAt) return { fieldErrors: { date: t("validation.invalid") } };
  const endsAt = new Date(startsAt.getTime() + d.duration * 60_000);

  const vehicle = d.vehicleId
    ? await db.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, customerId: true } })
    : null;
  if (d.vehicleId && !vehicle) return { fieldErrors: { vehicleId: t("validation.invalid") } };

  // Alle Verweise müssen existieren (statt eines Datenbankfehlers); Terminart, Arbeitsplatz und Mitarbeiter müssen aktiv sein –
  // es sei denn, der bestehende Termin hat sie schon (dann bleibt der Wert unverändert möglich).
  const current = d.id ? await db.appointment.findUnique({ where: { id: d.id }, select: { typeId: true, bayId: true, assigneeId: true } }) : null;
  const invalid = (field: string) => ({ fieldErrors: { [field]: t("validation.invalid") } });
  if (d.typeId && d.typeId !== current?.typeId && !(await db.appointmentType.findFirst({ where: { id: d.typeId, active: true }, select: { id: true } }))) return invalid("typeId");
  if (d.bayId && d.bayId !== current?.bayId && !(await db.bay.findFirst({ where: { id: d.bayId, active: true }, select: { id: true } }))) return invalid("bayId");
  if (d.assigneeId && d.assigneeId !== current?.assigneeId && !(await db.user.findFirst({ where: { id: d.assigneeId, active: true }, select: { id: true } }))) return invalid("assigneeId");
  if (d.tireSetId) {
    // Der Reifensatz muss existieren und zum gewählten Fahrzeug gehören
    const set = await db.tireSet.findUnique({ where: { id: d.tireSetId }, select: { vehicleId: true } });
    if (!set) return invalid("tireSetId");
    if (!vehicle || set.vehicleId !== vehicle.id) return { fieldErrors: { vehicleId: t("appointments.errors.tireSetMismatch") } };
  }

  const data = {
    title: d.title.trim(),
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

  // Doppelbelegungs-Prüfung und Speichern gehören in eine Transaktion: Zwei gleichzeitige Buchungen desselben Arbeitsplatzes
  // dürfen sich nicht beide an der Prüfung vorbeischieben.
  const outcome = await db.$transaction(async (tx) => {
    if (d.bayId && d.status !== "cancelled" && d.status !== "no_show") {
      const clash = await tx.appointment.findFirst({
        where: {
          bayId: d.bayId,
          id: d.id ? { not: d.id } : undefined,
          status: { notIn: ["cancelled", "no_show"] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        include: { vehicle: true },
      });
      if (clash) return { clash };
    }
    if (d.id) {
      if (!(await claimed(d.version, (stamp, next) => tx.appointment.updateMany({ where: { id: d.id!, updatedAt: stamp }, data: { updatedAt: next } })))) return { conflict: true as const };
      await tx.appointment.update({ where: { id: d.id }, data });
    } else {
      await tx.appointment.create({ data: { ...data, createdById: session.user.id } });
    }
    return {};
  });
  if ("conflict" in outcome) return { error: t("common.conflict") };
  if ("clash" in outcome && outcome.clash) {
    const clash = outcome.clash;
    return {
      fieldErrors: {
        bayId: t("appointments.errors.bayBusy", {
          from: i18n.date(clash.startsAt, { timeStyle: "short" }),
          to: i18n.date(clash.endsAt, { timeStyle: "short" }),
          title: clash.vehicle?.plate ?? clash.title,
        }),
      },
    };
  }

  revalidatePath("/appointments");
  revalidatePath("/");
  revalidatePath("/tires");
  redirect(safeReturn(d.returnTo, "/appointments", `/appointments?date=${d.date}`));
}

export async function deleteAppointment(formData: FormData) {
  await requirePermission("appointments.delete");
  const id = String(formData.get("id") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""), "/appointments", "/appointments");
  const appointment = id ? await db.appointment.findUnique({ where: { id }, select: { title: true } }) : null;
  if (id) await db.appointment.deleteMany({ where: { id } });
  if (appointment) await audit("appointment.delete", { target: appointment.title, entityId: id });
  revalidatePath("/appointments");
  revalidatePath("/");
  revalidatePath("/tires");
  redirect(returnTo);
}

/* ───────────── Einstellungen (Kalender) ───────────── */

const settingsSchema = z.object({
  dayStartHour: z.coerce.number().int().min(0).max(23),
  dayEndHour: z.coerce.number().int().min(1).max(24),
  slotMinutes: z.coerce.number().int().refine((v) => [10, 15, 20, 30, 60].includes(v)),
});

export async function saveAppointmentSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("appointments.configure");
  const { t } = await getI18n();
  const parsed = settingsSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  if (d.dayEndHour <= d.dayStartHour) return { fieldErrors: { dayEndHour: t("appointments.settings.errors.hoursOrder") } };

  await db.appointmentSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
  await audit("settings.appointments");
  revalidatePath("/appointments");
  return { ok: true, message: t("common.saved") };
}

/* ───────────── Arbeitsplätze ───────────── */

const baySchema = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(60), sortOrder: z.coerce.number().int().min(0).max(999).default(0) });

export async function saveBay(formData: FormData) {
  await requirePermission("appointments.configure");
  const parsed = baySchema.safeParse(formObject(formData));
  if (!parsed.success) return;
  const { id, ...data } = parsed.data;
  const active = formData.get("active") === "on" || !id;
  if (id) await db.bay.update({ where: { id }, data: { ...data, active } });
  else await db.bay.create({ data: { ...data, active: true } });
  revalidatePath("/appointments");
}

export async function deleteBay(formData: FormData) {
  await requirePermission("appointments.configure");
  const id = String(formData.get("id") ?? "");
  if (id) await db.bay.deleteMany({ where: { id } });
  revalidatePath("/appointments");
}

/* ───────────── Terminarten ───────────── */

const typeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  color: z.string().refine(isHexColor),
  defaultMinutes: z.coerce.number().int().min(5).max(720),
  kind: z.enum(APPOINTMENT_KINDS).default("general"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function saveAppointmentType(formData: FormData) {
  await requirePermission("appointments.configure");
  const parsed = typeSchema.safeParse(formObject(formData));
  if (!parsed.success) return;
  const { id, ...data } = parsed.data;
  const active = formData.get("active") === "on" || !id;
  if (id) await db.appointmentType.update({ where: { id }, data: { ...data, active } });
  else await db.appointmentType.create({ data: { ...data, active: true } });
  revalidatePath("/appointments");
}

export async function deleteAppointmentType(formData: FormData) {
  await requirePermission("appointments.configure");
  const id = String(formData.get("id") ?? "");
  if (id) await db.appointmentType.deleteMany({ where: { id } });
  revalidatePath("/appointments");
}
