"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { customerDisplayName, formatPlate, normalizePlate } from "@/lib/domain/vehicles";

function refresh(id?: string) {
  for (const p of ["/vehicles", "/customers", "/tires", "/appointments", "/"]) revalidatePath(p);
  if (id) revalidatePath(`/vehicles/${id}`);
}

const vehicleSchema = z.object({
  id: z.string().optional(),
  // nur beim Anlegen: Halter (optional). Spätere Wechsel laufen über den Halterwechsel.
  customerId: z.string().optional(),
  plate: z.string().min(2).max(14),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  vin: z
    .string()
    .transform((v) => v.toUpperCase().replace(/\s/g, ""))
    .pipe(z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/))
    .optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  notes: z.string().max(2000).optional(),
});

export async function saveVehicle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("customers.edit");
  const { t } = await getI18n();
  const parsed = vehicleSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, customerId, plate, ...d } = parsed.data;

  const plateNorm = normalizePlate(plate);
  if (plateNorm.length < 2) return { fieldErrors: { plate: t("validation.invalid") } };

  const duplicate = await db.vehicle.findFirst({
    where: { plateNorm, ...(id ? { id: { not: id } } : {}) },
    include: { customer: true },
  });
  if (duplicate) {
    const owner = duplicate.customer ? customerDisplayName(duplicate.customer) : t("vehicles.noOwner");
    return { fieldErrors: { plate: t("vehicles.errors.plateExists", { customer: owner }) } };
  }

  if (customerId && !(await db.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) {
    return { fieldErrors: { customerId: t("validation.invalid") } };
  }

  const data = {
    plate: formatPlate(plate),
    plateNorm,
    make: d.make ?? null,
    model: d.model ?? null,
    vin: d.vin ?? null,
    year: d.year ?? null,
    notes: d.notes ?? null,
  };

  let savedId: string;
  if (id) {
    await db.vehicle.update({ where: { id }, data });
    savedId = id;
  } else {
    const created = await db.vehicle.create({
      data: {
        ...data,
        customerId: customerId ?? null,
        ownerships: customerId ? { create: [{ customerId }] } : undefined,
      },
    });
    savedId = created.id;
  }
  refresh(savedId);
  redirect(`/vehicles/${savedId}`);
}

const transferSchema = z.object({
  vehicleId: z.string(),
  newCustomerId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(300).optional(),
});

/** Halterwechsel: aktuellen Halter-Eintrag beenden, neuen anlegen (oder Fahrzeug ohne Halter lassen). */
export async function transferVehicle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("customers.edit");
  const { t } = await getI18n();
  const parsed = transferSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  const vehicle = await db.vehicle.findUnique({ where: { id: d.vehicleId } });
  if (!vehicle) return { error: t("validation.invalid") };
  const newId = d.newCustomerId ?? null;
  if (newId === vehicle.customerId) return { fieldErrors: { newCustomerId: t("vehicles.errors.sameOwner") } };
  if (newId && !(await db.customer.findUnique({ where: { id: newId }, select: { id: true } }))) {
    return { fieldErrors: { newCustomerId: t("validation.invalid") } };
  }

  const when = new Date(`${d.date}T12:00:00`);
  await db.$transaction(async (tx) => {
    await tx.vehicleOwnership.updateMany({ where: { vehicleId: vehicle.id, toDate: null }, data: { toDate: when } });
    if (newId) await tx.vehicleOwnership.create({ data: { vehicleId: vehicle.id, customerId: newId, fromDate: when, note: d.note ?? null } });
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { customerId: newId } });
  });
  refresh(vehicle.id);
  redirect(`/vehicles/${vehicle.id}`);
}

export async function deleteVehicle(formData: FormData) {
  await requirePermission("customers.delete");
  const id = String(formData.get("id") ?? "");
  if (id) await db.vehicle.deleteMany({ where: { id } });
  refresh();
  redirect("/vehicles");
}
