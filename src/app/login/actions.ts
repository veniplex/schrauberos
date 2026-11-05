"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";

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
  if (!result.ok) return { error: t(`auth.errors.${result.reason}`) };

  redirect(result.mustChangePassword ? "/account" : safeNext(formData.get("next")));
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
