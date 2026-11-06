"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { login } from "@/server/auth/session";
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_CHARS, passwordProblem } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { seedAllDemo } from "@/server/seed/demo";
import { applyTimezone, isValidTimezone } from "@/server/startup";
import { checkSetupToken, removeSetupToken } from "@/server/setup-token";
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
  password: z.string(),
  confirm: z.string(),
  timezone: z.string().max(60),
  token: z.string().max(200),
});

/** Ersteinrichtung: legt den ersten Administrator an, solange es noch keinen Benutzer gibt. */
export async function completeSetup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getI18n();
  // Gibt es schon einen Benutzer, ist die Einrichtung vorbei – vor allem anderen (kein Token-Test, keine Zeitzone)
  if ((await db.user.count()) > 0) redirect("/login");
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;
  const token = checkSetupToken(d.token);
  if (!token.ok) {
    return { fieldErrors: { token: token.reason === "throttled" ? t("setup.errors.tokenThrottled", { seconds: token.retryAfterSeconds }) : t("setup.errors.token") } };
  }
  const problem = passwordProblem(d.password);
  if (problem === "short") return { fieldErrors: { password: t("account.errors.passwordShort", { min: MIN_PASSWORD_LENGTH }) } };
  if (problem === "long") return { fieldErrors: { password: t("account.errors.passwordLong", { max: MAX_PASSWORD_CHARS }) } };
  if (d.password !== d.confirm) return { fieldErrors: { confirm: t("account.errors.mismatch") } };
  if (!isValidTimezone(d.timezone)) return { fieldErrors: { timezone: t("validation.invalid") } };

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
  // Erst jetzt, nach dem erfolgreichen Anlegen: Zeitzone anwenden, Token verbrauchen
  applyTimezone(d.timezone);
  removeSetupToken();

  if (formData.get("demo") === "on" && (await db.customer.count()) === 0) await seedAllDemo(db);
  await audit("setup.complete", { actor: { id: null, name: d.name }, target: d.workshopName });

  const result = await login(d.username, d.password);
  redirect(result.ok ? "/" : "/login");
}
