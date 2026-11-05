"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireSession, revokeSessions } from "@/server/auth/session";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/server/auth/password";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(200).optional(),
});

export async function saveProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession({ allowPasswordChange: true });
  const { t } = await getI18n();
  const parsed = profileSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  await db.user.update({ where: { id: session.user.id }, data: { name: parsed.data.name, email: parsed.data.email ?? null } });
  revalidatePath("/", "layout");
  return { ok: true, message: t("common.saved") };
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession({ allowPasswordChange: true });
  const { t } = await getI18n();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (user.authSource !== "local") return { error: t("account.errors.externalPassword") };
  if (!(await verifyPassword(current, user.passwordHash))) return { fieldErrors: { current: t("account.errors.currentWrong") } };
  if (next.length < MIN_PASSWORD_LENGTH) return { fieldErrors: { next: t("account.errors.passwordShort", { min: MIN_PASSWORD_LENGTH }) } };
  if (next !== confirm) return { fieldErrors: { confirm: t("account.errors.mismatch") } };
  if (next === current) return { fieldErrors: { next: t("account.errors.sameAsOld") } };

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  // Alle anderen Geräte abmelden
  await revokeSessions(user.id, true);
  if (user.mustChangePassword) redirect("/");
  return { ok: true, message: t("account.passwordChanged") };
}
