"use server";

import { getI18n } from "@/i18n/server";
import { currentClientIp } from "@/server/auth/network";
import { MAX_PASSWORD_CHARS, MIN_PASSWORD_LENGTH, passwordProblem } from "@/server/auth/password";
import { redeemRecoveryCode } from "@/server/auth/recovery";
import { loginThrottle } from "@/server/auth/throttle";
import { audit } from "@/server/audit";
import type { RecoveryActionState } from "@/lib/recovery-code";

/**
 * Notzugang einlösen: Wiederherstellungs-Code + neues Passwort. Antwort bei jedem Fehler gleich (siehe `redeemRecoveryCode`); bei
 * Erfolg steht der **neue** Code nur in dieser Antwort. Kein automatisches Anmelden.
 */
export async function recoverAccess(_prev: RecoveryActionState, formData: FormData): Promise<RecoveryActionState> {
  const { t, date } = await getI18n();
  const code = String(formData.get("code") ?? "").slice(0, 100);
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Eingaben zum Passwort sagen nichts über den Code aus – sie werden vor dem Einlösen geprüft
  const problem = passwordProblem(password);
  if (problem === "short") return { fieldErrors: { password: t("account.errors.passwordShort", { min: MIN_PASSWORD_LENGTH }) } };
  if (problem === "long") return { fieldErrors: { password: t("account.errors.passwordLong", { max: MAX_PASSWORD_CHARS }) } };
  if (password !== confirm) return { fieldErrors: { confirm: t("account.errors.mismatch") } };

  const result = await redeemRecoveryCode({ code, password, ip: await currentClientIp() });
  if (!result.ok) {
    // Audit gedrosselt (global) und ohne jedes Code-Material
    if (loginThrottle.recovery.audit.allow("fail")) await audit("auth.recoveryFailed", { actor: { id: null, name: "–" } });
    return { error: result.reason === "throttled" ? t("recovery.recover.errors.throttled", { seconds: result.retryAfterSeconds }) : t("recovery.recover.errors.invalid") };
  }
  await audit("auth.recoveryUsed", { actor: { id: result.account.id, name: result.account.name }, target: result.account.username });
  return { ok: true, recoveryCode: result.newCode, issuedOn: date(new Date(), { dateStyle: "medium" }), secondFactorReset: result.secondFactorReset };
}
