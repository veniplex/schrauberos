"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { APPOINTMENT_STATUSES } from "@/lib/domain/constants";
import { parseLocalDateTime } from "@/lib/dates";
import { fieldErrors, formObject, safeReturn } from "@/lib/forms";

const schema = z.object({
  id: z.string().optional(),
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

  // Keine Doppelbelegung desselben Arbeitsplatzes
  if (d.bayId && d.status !== "cancelled" && d.status !== "no_show") {
    const clash = await db.appointment.findFirst({
      where: {
        bayId: d.bayId,
        id: d.id ? { not: d.id } : undefined,
        status: { notIn: ["cancelled", "no_show"] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      include: { vehicle: true },
    });
    if (clash) {
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
  }

  const vehicle = d.vehicleId
    ? await db.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, customerId: true } })
    : null;
  if (d.vehicleId && !vehicle) return { fieldErrors: { vehicleId: t("validation.invalid") } };

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

  if (d.id) {
    await db.appointment.update({ where: { id: d.id }, data });
  } else {
    await db.appointment.create({ data: { ...data, createdById: session.user.id } });
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
  if (id) await db.appointment.deleteMany({ where: { id } });
  revalidatePath("/appointments");
  revalidatePath("/");
  revalidatePath("/tires");
  redirect(returnTo);
}
