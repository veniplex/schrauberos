"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { login } from "@/server/auth/session";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { seedAllDemo } from "@/server/seed/demo";
import { applyTimezone } from "@/server/startup";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";

const schema = z.object({
  workshopName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  confirm: z.string(),
  timezone: z.string().max(60),
});

/** Ersteinrichtung: legt den ersten Administrator an, solange es noch keinen Benutzer gibt. */
export async function completeSetup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getI18n();
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  if (d.password !== d.confirm) return { fieldErrors: { confirm: t("account.errors.mismatch") } };
  if (!applyTimezone(d.timezone)) return { fieldErrors: { timezone: t("validation.invalid") } };

  const adminRole = await db.role.findUnique({ where: { key: "admin" } });
  if (!adminRole) return { error: t("setup.errors.notReady") };
  const passwordHash = await hashPassword(d.password);

  // In einer Transaktion: Zwei gleichzeitige Aufrufe können nicht beide einen Administrator anlegen
  const created = await db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return false;
    await tx.user.create({ data: { username: d.username, name: d.name, passwordHash, roles: { create: [{ roleId: adminRole.id }] } } });
    await tx.workshop.upsert({ where: { id: "default" }, update: { name: d.workshopName, timezone: d.timezone }, create: { id: "default", name: d.workshopName, timezone: d.timezone } });
    return true;
  });
  if (!created) redirect("/login");

  if (formData.get("demo") === "on" && (await db.customer.count()) === 0) await seedAllDemo(db);
  await audit("setup.complete", { actor: { id: null, name: d.name }, target: d.workshopName });

  const result = await login(d.username, d.password);
  redirect(result.ok ? "/" : "/login");
}
