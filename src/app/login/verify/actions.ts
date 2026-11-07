"use server";

import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { currentClientIp } from "@/server/auth/network";
import { loginThrottle } from "@/server/auth/throttle";
import { verifySecondFactor } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { safeNext } from "@/lib/safe-next";

/**
 * Zweiter Schritt der Anmeldung (siehe `verifySecondFactor`). Fehler: eine einzige Meldung für „Code falsch“, „Code schon benutzt“ und „Sicherungscode falsch“; ist der
 * Zwischenzustand weg (abgelaufen, fünf falsche Codes), geht es zurück zur Passwort-Eingabe. Audit: Fehlversuche gedrosselt (je Konto höchstens einer pro Minute),
 * Erfolg wie bei der Passwort-Anmeldung; ein verbrauchter Sicherungscode eigens.
 */
export async function verifyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getI18n();
  const code = String(formData.get("code") ?? "").slice(0, 64);
  const result = await verifySecondFactor(code, { ip: await currentClientIp() });

  if (!result.ok) {
    if (result.reason === "expired") redirect("/login?notice=twoFactorExpired");
    if (result.reason === "throttled") return { error: t("auth.errors.throttled", { seconds: result.retryAfterSeconds }) };
    if (loginThrottle.audit2fa.allow(`fail:${result.account.id}`)) {
      await audit("auth.secondFactorFailed", { actor: result.account, target: result.account.name });
    }
    return { error: t("auth.secondFactor.invalid") };
  }

  await audit("auth.login", { actor: result.account });
  if (result.via === "backup") await audit("auth.backupCodeUsed", { actor: result.account, target: `${result.backupCodesLeft}` });
  redirect(result.mustChangePassword ? "/account" : safeNext(formData.get("next")));
}
