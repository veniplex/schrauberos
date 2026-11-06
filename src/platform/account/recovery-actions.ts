"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requireSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { acknowledgeRecoveryNotice, replaceRecoveryCode } from "@/server/auth/recovery";
import { loginThrottle } from "@/server/auth/throttle";
import { getI18n } from "@/i18n/server";
import { audit } from "@/server/audit";
import type { RecoveryActionState } from "@/lib/recovery-code";

/**
 * Wiederherstellungs-Code erzeugen oder neu erzeugen – nur für Administrator-Konten und nur mit erneuter Passwortabfrage. Der
 * bisherige Code wird dabei ungültig (derselbe Schritt in einer Transaktion). Der Klartext steht nur in dieser Antwort.
 */
export async function createRecoveryCode(_prev: RecoveryActionState, formData: FormData): Promise<RecoveryActionState> {
  const session = await requireSession();
  const { t, date } = await getI18n();
  if (!session.user.isAdmin) return { error: t("recovery.account.errors.adminOnly") };
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (user.authSource !== "local") return { error: t("recovery.account.errors.external") };

  // Die Passwortprüfung hat dasselbe eigene Limit wie der Passwortwechsel (gestohlene Sitzung darf nicht raten)
  const gate = loginThrottle.passwordChange;
  const wait = gate.check(user.id);
  if (wait > 0) return { error: t("account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) }) };
  gate.take(user.id);
  if (!(await verifyPassword(String(formData.get("password") ?? ""), user.passwordHash))) return { fieldErrors: { password: t("account.errors.currentWrong") } };
  gate.succeed(user.id);

  const code = await db.$transaction((tx) => replaceRecoveryCode(tx, user.id));
  await audit("auth.recoveryCreated", { target: user.username });
  revalidatePath("/account");
  return { ok: true, recoveryCode: code, issuedOn: date(new Date(), { dateStyle: "medium" }) };
}

/** „Ich habe den Code gesichert“ – merkt sich die Bestätigung des eigenen Codes. */
export async function confirmRecoveryCode(): Promise<{ ok: boolean }> {
  const session = await requireSession({ allowPasswordChange: true });
  await db.recoveryCode.updateMany({ where: { userId: session.user.id, confirmedAt: null }, data: { confirmedAt: new Date() } });
  revalidatePath("/", "layout");
  // „ok“ heißt: Das Konto hat einen Code (bestätigt jetzt oder schon früher) – nicht, dass diesmal etwas geschrieben wurde
  return { ok: (await db.recoveryCode.count({ where: { userId: session.user.id, confirmedAt: { not: null } } })) > 0 };
}

/** Banner „Notzugang wurde verwendet“ als gesehen markieren (für den angemeldeten Benutzer). */
export async function acknowledgeNotice(formData: FormData): Promise<void> {
  const session = await requireSession({ allowPasswordChange: true });
  const id = String(formData.get("id") ?? "");
  if (id) await acknowledgeRecoveryNotice(id, { id: session.user.id, isAdmin: session.user.isAdmin });
  revalidatePath("/", "layout");
}
