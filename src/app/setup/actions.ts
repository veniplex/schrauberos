"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { login } from "@/server/auth/session";
import { hashPassword, QueueFullError, MIN_PASSWORD_LENGTH, MAX_PASSWORD_CHARS, passwordProblem } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { seedAllDemo } from "@/server/seed/demo";
import { applyTimezone, isValidTimezone } from "@/server/startup";
import { jobRunner } from "@/server/jobs";
import { logError } from "@/lib/log-safe";
import { checkSetupToken, removeSetupToken } from "@/server/setup-token";
import { getI18n } from "@/i18n/server";
import type { RecoveryActionState } from "@/lib/recovery-code";
import { replaceRecoveryCode } from "@/server/auth/recovery";
import { fieldErrors, formObject } from "@/lib/forms";
import { applyPreset } from "@/modules/features";
import { FEATURES, MODULES } from "@/modules/catalog";
import { PRESETS, presetChoices } from "@/modules/presets";

const schema = z.object({
  workshopName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/, { error: "validation.username" }),
  password: z.string(),
  confirm: z.string(),
  timezone: z.string().max(60),
  token: z.string().max(200),
  /** Funktionsumfang (Preset); fehlt er, gilt der Standard */
  preset: z.string().max(40).optional(),
});

/** Ersteinrichtung: legt den ersten Administrator an, solange es noch keinen Benutzer gibt. */
export async function completeSetup(_prev: RecoveryActionState, formData: FormData): Promise<RecoveryActionState> {
  const { t, date } = await getI18n();
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
  // nur Presets, die die Einrichtung auch anbietet (ein Preset ohne Wirkung wird nicht angeboten, und eine erfundene ID nicht angenommen)
  const preset = d.preset ? presetChoices(PRESETS, MODULES, FEATURES).find((p) => p.id === d.preset) : undefined;
  if (d.preset && !preset) return { fieldErrors: { preset: t("setup.errors.preset") } };

  const adminRole = await db.role.findUnique({ where: { key: "admin" } });
  if (!adminRole) return { error: t("setup.errors.notReady") };
  // Eigentümer-Pfad: gleichzeitige Einrichtungsversuche belegen höchstens zwei Plätze, der Rest bekommt „bitte gleich noch einmal“
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(d.password, "setup");
  } catch (error) {
    if (error instanceof QueueFullError) return { error: t("common.errors.busy") };
    throw error;
  }

  // In einer Transaktion: Zwei gleichzeitige Aufrufe können nicht beide einen Administrator anlegen
  const created = await db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return null;
    const admin = await tx.user.create({ data: { username: d.username, name: d.name, passwordHash, roles: { create: [{ roleId: adminRole.id }] } } });
    await tx.workshop.upsert({ where: { id: "default" }, update: { name: d.workshopName, timezone: d.timezone }, create: { id: "default", name: d.workshopName, timezone: d.timezone } });
    // Funktionsumfang: Schalter des gewählten Presets (unbekannte IDs darin werden übersprungen und nur gemeldet)
    if (preset) {
      const plan = await applyPreset(preset.id, d.name, tx);
      for (const skipped of plan?.skipped.filter((s) => s.reason === "unknown") ?? []) logError("setup:preset", new Error(`Preset ${preset.id}: unbekannte Funktion ${skipped.id}`));
    }
    // Notzugang: Wiederherstellungs-Code des ersten Administrators (Klartext nur in der Antwort dieser Aktion)
    return replaceRecoveryCode(tx, admin.id);
  });
  if (!created) redirect("/login");
  // Erst jetzt, nach dem erfolgreichen Anlegen: Zeitzone anwenden, Token verbrauchen
  applyTimezone(d.timezone);
  // Die Termine der Cron-Jobs wurden beim Start in der Zeitzone des Prozesses berechnet (vor der Einrichtung UTC): jetzt in der gewählten neu berechnen
  await jobRunner().reschedule().catch((error) => logError("setup:reschedule", error));
  removeSetupToken();

  // Beispieldaten: jeder Beitrag der Funktionen legt nur an, wenn seine Tabelle leer ist
  if (formData.get("demo") === "on") await seedAllDemo(db);
  await audit("setup.complete", { actor: { id: null, name: d.name }, target: d.workshopName });

  // Angemeldet wird sofort; danach zeigt die Einrichtung den Wiederherstellungs-Code auf einer eigenen Seite mit Pflicht-Bestätigung
  // (kein Redirect, der sie überspringen könnte)
  await login(d.username, d.password);
  return { ok: true, recoveryCode: created, issuedOn: date(new Date(), { dateStyle: "medium" }) };
}
