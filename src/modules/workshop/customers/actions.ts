"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { audit } from "@/server/audit";
import { customerDisplayName } from "./domain";

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
  const customer = id ? await db.customer.findUnique({ where: { id } }) : null;
  if (id) await db.customer.deleteMany({ where: { id } });
  if (customer) await audit("customer.delete", { target: customerDisplayName(customer), entityId: id });
  revalidatePath("/customers");
  revalidatePath("/tires");
  revalidatePath("/vehicles");
  redirect("/customers");
}
