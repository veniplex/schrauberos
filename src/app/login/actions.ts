"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout, type LoginResult } from "@/server/auth/session";
import { currentClientIp } from "@/server/auth/network";
import { loginThrottle, nameFingerprint, normalizeUsername } from "@/server/auth/throttle";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { audit } from "@/server/audit";
import { passwordTooLong } from "@/lib/password-rules";
import { safeNext } from "@/lib/safe-next";

const schema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1),
});

/**
 * Fehlversuche protokollieren – gedrosselt (je Konto höchstens einer pro Minute, insgesamt höchstens 30 pro Minute), damit ein
 * Dauerbeschuss das Audit-Log nicht füllt, und ohne den Klartext unbekannter Namen (nur ein kurzer Fingerabdruck).
 */
async function auditLogin(username: string, result: LoginResult) {
  const key = normalizeUsername(username);
  const { audit: limiter } = loginThrottle;
  if (result.ok) {
    await audit("auth.login", { actor: result.account });
    return;
  }
  if (result.reason === "throttled" || result.reason === "busy") return;
  const known = result.account;
  const actor = known ?? { id: null, name: "–" };
  const target = known ? `${key} · ${result.reason}` : `#${nameFingerprint(key)} · ${result.reason}`;
  if (limiter.allow(`fail:${key}`)) await audit("auth.loginFailed", { actor, target });
  if (result.reason === "invalid" && result.newlyThrottled && limiter.allow(`throttle:${key}`)) {
    await audit("auth.loginThrottled", { actor, target: known ? key : `#${nameFingerprint(key)}` });
  }
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getI18n();
  const parsed = schema.safeParse({ username: formData.get("username"), password: formData.get("password") });
  // Überlange Eingaben werden gar nicht erst geprüft (und verursachen keine Arbeit)
  if (!parsed.success || passwordTooLong(parsed.data.password)) return { error: t("auth.errors.invalid") };

  const result = await login(parsed.data.username, parsed.data.password, { ip: await currentClientIp() });
  await auditLogin(parsed.data.username, result);
  if (!result.ok) {
    if (result.reason === "throttled") return { error: t("auth.errors.throttled", { seconds: result.retryAfterSeconds }) };
    return { error: t(`auth.errors.${result.reason}`) };
  }

  redirect(result.mustChangePassword ? "/account" : safeNext(formData.get("next")));
}

export async function logoutAction() {
  await audit("auth.logout");
  await logout();
  redirect("/login");
}
