"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import type { ActionState } from "@/components/ui/form";
import { audit } from "@/server/audit";

const schema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

/** Nur interne Pfade zulassen (kein Open Redirect). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getI18n();
  const parsed = schema.safeParse({ username: formData.get("username"), password: formData.get("password") });
  if (!parsed.success) return { error: t("auth.errors.invalid") };

  const result = await login(parsed.data.username, parsed.data.password);
  const attempted = parsed.data.username.slice(0, 100);
  const account = await db.user.findUnique({ where: { username: attempted.trim().toLowerCase() }, select: { id: true, name: true } });
  await audit(result.ok ? "auth.login" : "auth.loginFailed", {
    actor: { id: account?.id ?? null, name: account?.name ?? attempted },
    target: result.ok ? null : `${attempted} · ${result.reason}`,
  });
  if (!result.ok) return { error: t(`auth.errors.${result.reason}`) };

  redirect(result.mustChangePassword ? "/account" : safeNext(formData.get("next")));
}

export async function logoutAction() {
  await audit("auth.logout");
  await logout();
  redirect("/login");
}
