"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { formatPlate, normalizePlate } from "@/lib/domain/vehicles";

const customerSchema = z.object({
  id: z.string().optional(),
  customerNumber: z.string().max(40).optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(60).optional(),
  street: z.string().max(120).optional(),
  zip: z.string().max(12).optional(),
  city: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
});

export async function saveCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("customers.edit");
  const { t } = await getI18n();
  const parsed = customerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, ...d } = parsed.data;

  if (!d.lastName && !d.company) return { fieldErrors: { lastName: t("customers.errors.nameRequired") } };

  const data = {
    customerNumber: d.customerNumber ?? null,
    firstName: d.firstName ?? null,
    // Bei reinen Firmenkunden dient der Firmenname als Nachname (Sortierung/Suche)
    lastName: d.lastName ?? d.company!,
    company: d.company ?? null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    street: d.street ?? null,
    zip: d.zip ?? null,
    city: d.city ?? null,
    notes: d.notes ?? null,
  };
  const saved = id
    ? await db.customer.update({ where: { id }, data })
    : await db.customer.create({ data });

  revalidatePath("/customers");
  redirect(`/customers/${saved.id}`);
}

export async function deleteCustomer(formData: FormData) {
  await requirePermission("customers.delete");
  const id = String(formData.get("id") ?? "");
  if (id) await db.customer.deleteMany({ where: { id } });
  revalidatePath("/customers");
  revalidatePath("/tires");
  redirect("/customers");
}

const vehicleSchema = z.object({
  id: z.string().optional(),
  customerId: z.string(),
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
  if (duplicate) return { fieldErrors: { plate: t("vehicles.errors.plateExists", { customer: duplicate.customer.lastName }) } };

  const data = {
    customerId,
    plate: formatPlate(plate),
    plateNorm,
    make: d.make ?? null,
    model: d.model ?? null,
    vin: d.vin ?? null,
    year: d.year ?? null,
    notes: d.notes ?? null,
  };
  if (id) await db.vehicle.update({ where: { id }, data });
  else await db.vehicle.create({ data });

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/tires");
  redirect(`/customers/${customerId}`);
}

export async function deleteVehicle(formData: FormData) {
  await requirePermission("customers.delete");
  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  if (id) await db.vehicle.deleteMany({ where: { id } });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/tires");
  redirect(`/customers/${customerId}`);
}
