"use server";

import { z } from "zod";
import { qrMatrix } from "@/lib/qr";
import { base32Decode, otpauthUri } from "@/lib/totp";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { authPolicy } from "@/server/auth/policy";
import { clearDeviceCookie, readDeviceToken } from "@/server/auth/devices";
import { revokeAccess } from "@/server/auth/revoke";
import { acknowledgeTwoFactorReset, beginSetup, confirmSetup, disableSecondFactor, replaceBackupCodes, twoFactorStatus } from "@/server/auth/second-factor";
import { clearSessionCookie, currentSessionHash } from "@/server/auth/session";
import { loginThrottle } from "@/server/auth/throttle";
import { defineAction, defineOperation, fail, failField } from "@/server/operations";
import { getWorkshop } from "@/server/workshop";
import { createHash } from "node:crypto";

/**
 * Sicherheit im Konto: Zwei-Faktor-Anmeldung (TOTP) mit Sicherungscodes, eigene Sitzungen, bekannte Geräte, „überall abmelden“. Das sind **Konto-Operationen**
 * (`permission: "authenticated"`): jede angemeldete Sitzung für das eigene Konto, nie über die API (ein Token ist keine Person) und nie für fremde Konten – die Administration
 * setzt den zweiten Faktor anderer Konten über `admin.users.resetTwoFactor` zurück.
 *
 * Alles, was den Schutz des Kontos senkt oder neues Geheimnismaterial erzeugt (einrichten beginnen, ausschalten, Sicherungscodes erneuern), verlangt das Passwort erneut – mit
 * demselben eigenen Limit wie der Passwortwechsel (eine gestohlene Sitzung darf damit nicht raten). Klartext von Geheimnis und Codes steht nur in der Antwort der Aktion.
 */
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const passwordInput = z.object({ password: z.string().max(1024) });
const passwordForm = (fd: FormData) => ({ password: String(fd.get("password") ?? "") });

/* ───────────── Zwei-Faktor-Anmeldung ───────────── */

/** Was die Einrichtung dem Browser zeigt: QR-Code, Textschlüssel und die Sicherungscodes – nur in dieser Antwort. */
export type TwoFactorSetupState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  setup?: { qr: { size: number; rows: string[] }; secret: string; codes: string[]; issuedOn: string };
  /** Neue Sicherungscodes (nach „Neu erzeugen“) */
  backupCodes?: string[];
  issuedOn?: string;
};

const startOperation = defineOperation({
  name: "account.startTwoFactor",
  permission: "authenticated",
  input: passwordInput,
  audit: false,
  auditReason: "Die Einrichtung ist erst mit der Bestätigung des Codes wirksam; das Einschalten selbst ist protokolliert (auth.twoFactorEnabled)",
  prepare: async ({ input, principal }) => {
    if (principal.user.twoFactor) fail("conflict", "security.twoFactor.errors.alreadyEnabled");
    const { username } = await confirmOwnPassword(principal.user.id, input.password);
    return { username, issuer: (await getWorkshop()).name };
  },
  run: async ({ principal, prepared, tx }) => {
    const material = await beginSetup(tx, principal.user.id);
    if (!material) fail("conflict", "security.twoFactor.errors.alreadyEnabled");
    const secret = base32Decode(material.secret)!;
    return { secret: material.secret, codes: material.codes, uri: otpauthUri({ issuer: prepared.issuer, account: prepared.username, secret }) };
  },
});

export const startTwoFactor = defineAction(startOperation, {
  form: passwordForm,
  state: ({ secret, codes, uri }, _input, { date }) => ({ setup: { qr: qrMatrix(uri), secret, codes, issuedOn: date(new Date(), { dateStyle: "medium" }) } }),
});

const enableInput = z.object({
  code: z.string().max(64),
  /** Ohne bestätigte Sicherungscodes wird nichts eingeschaltet: Wer das Telefon verliert, soll nicht ausgesperrt sein */
  backupConfirmed: z.literal(true, { error: "security.twoFactor.errors.confirmCodes" }),
});

const enableOperation = defineOperation({
  name: "account.enableTwoFactor",
  permission: "authenticated",
  input: enableInput,
  audit: "auth.twoFactorEnabled",
  prepare: async ({ principal }) => {
    // Die Code-Eingabe hat ein eigenes Limit (eine gestohlene Sitzung darf bei der Einrichtung nicht unbegrenzt raten)
    const gate = loginThrottle.totpSetup;
    const wait = gate.check(principal.user.id);
    if (wait > 0) fail("forbidden", "account.errors.tooManyAttempts", { seconds: Math.ceil(wait / 1000) });
    gate.take(principal.user.id);
    return undefined;
  },
  run: async ({ input, principal, tx, audit, afterCommit }) => {
    const result = await confirmSetup(tx, principal.user.id, input.code);
    if (result === "notStarted") fail("conflict", "security.twoFactor.errors.notStarted");
    if (result === "wrong") failField("code", "security.twoFactor.errors.codeWrong");
    afterCommit(() => loginThrottle.totpSetup.succeed(principal.user.id));
    audit({ target: principal.user.username, entityId: principal.user.id });
    return {};
  },
});

export const enableTwoFactor = defineAction(enableOperation, {
  form: (fd) => ({ code: String(fd.get("code") ?? ""), backupConfirmed: fd.get("backupConfirmed") === "on" }),
  revalidate: [["/", "layout"]],
  message: "security.twoFactor.enabledMessage",
});

const disableOperation = defineOperation({
  name: "account.disableTwoFactor",
  permission: "authenticated",
  input: passwordInput,
  audit: "auth.twoFactorDisabled",
  prepare: async ({ input, principal }) => {
    if (!principal.user.twoFactor) fail("notFound");
    // Verlangt die Richtlinie den zweiten Faktor für Administratoren, lässt er sich für sie nicht ausschalten
    if (principal.user.isAdmin && (await authPolicy()).requireTwoFactorForAdmins) fail("forbidden", "security.twoFactor.errors.required");
    return confirmOwnPassword(principal.user.id, input.password);
  },
  run: async ({ principal, tx, audit }) => {
    if (!(await disableSecondFactor(tx, principal.user.id))) fail("notFound");
    audit({ target: principal.user.username, entityId: principal.user.id });
    return {};
  },
});

export const disableTwoFactor = defineAction(disableOperation, {
  form: passwordForm,
  revalidate: [["/", "layout"]],
  message: "security.twoFactor.disabledMessage",
});

const regenerateOperation = defineOperation({
  name: "account.regenerateBackupCodes",
  permission: "authenticated",
  input: passwordInput,
  audit: "auth.twoFactorBackupCodes",
  prepare: async ({ input, principal }) => {
    if (!principal.user.twoFactor) fail("notFound");
    return confirmOwnPassword(principal.user.id, input.password);
  },
  run: async ({ principal, tx, audit }) => {
    if (!(await twoFactorStatus(principal.user.id, tx)).enabled) fail("notFound");
    const codes = await replaceBackupCodes(tx, principal.user.id);
    audit({ target: principal.user.username, entityId: principal.user.id }); // nie die Codes selbst
    return { codes };
  },
});

export const regenerateBackupCodes = defineAction(regenerateOperation, {
  form: passwordForm,
  revalidate: ["/account"],
  state: ({ codes }, _input, { date }) => ({ backupCodes: codes, issuedOn: date(new Date(), { dateStyle: "medium" }) }),
});

const acknowledgeResetOperation = defineOperation({
  name: "account.acknowledgeTwoFactorReset",
  permission: "authenticated",
  allowPasswordChange: true,
  input: z.object({}),
  audit: false,
  auditReason: "Das Ausblenden des Hinweises ändert keine Daten; das Zurücksetzen selbst ist protokolliert (auth.twoFactorReset, auth.recoveryUsed)",
  run: async ({ principal, tx }) => {
    await acknowledgeTwoFactorReset(tx, principal.user.id);
    return {};
  },
});

export const acknowledgeTwoFactorResetNotice = defineAction(acknowledgeResetOperation, { revalidate: [["/", "layout"]] });

/* ───────────── Sitzungen und Geräte ───────────── */

const idInput = z.object({ id: z.string().min(1).max(60) });

const revokeSessionOperation = defineOperation({
  name: "account.revokeSession",
  permission: "authenticated",
  input: idInput,
  audit: "auth.sessionRevoked",
  run: async ({ input, principal, tx, audit }) => {
    // Nur eigene Sitzungen; die eigene, laufende beendet man mit „Abmelden“
    const row = await tx.session.findFirst({ where: { id: input.id, userId: principal.user.id }, select: { id: true, tokenHash: true } });
    if (!row) fail("notFound");
    if (row.tokenHash === (await currentSessionHash())) fail("forbidden", "security.sessions.errors.current");
    await tx.session.deleteMany({ where: { id: row.id } });
    audit({ target: principal.user.username, entityId: row.id });
    return {};
  },
});

export const revokeSession = defineAction(revokeSessionOperation, { revalidate: ["/account"], message: "security.sessions.revoked" });

const logoutEverywhereOperation = defineOperation({
  name: "account.logoutEverywhere",
  permission: "authenticated",
  input: z.object({}),
  audit: "auth.logoutEverywhere",
  run: async ({ principal, tx, audit }) => {
    // Sitzungen, bekannte Geräte **und** API-Tokens des Kontos – in derselben Transaktion (`revokeAccess`), auch die eigene Sitzung
    await revokeAccess(tx, principal.user.id);
    audit({ target: principal.user.username, entityId: principal.user.id });
    return {};
  },
});

export const logoutEverywhere = defineAction(logoutEverywhereOperation, {
  onSuccess: async () => {
    await clearSessionCookie();
    await clearDeviceCookie();
  },
  redirect: "/login",
});

const revokeDeviceOperation = defineOperation({
  name: "account.revokeDevice",
  permission: "authenticated",
  allowPasswordChange: true,
  input: idInput,
  audit: "auth.deviceRevoked",
  run: async ({ input, principal, tx, audit }) => {
    const row = await tx.knownDevice.findFirst({ where: { id: input.id, userId: principal.user.id }, select: { id: true, tokenHash: true } });
    if (!row) fail("notFound");
    await tx.knownDevice.deleteMany({ where: { id: row.id } });
    const token = await readDeviceToken();
    audit({ target: principal.user.username, entityId: row.id });
    return { current: !!token && sha256(token) === row.tokenHash };
  },
});

export const revokeDevice = defineAction(revokeDeviceOperation, {
  // Das Gerät dieses Browsers: auch das Cookie entfernen
  onSuccess: async ({ current }) => {
    if (current) await clearDeviceCookie();
  },
  revalidate: ["/account"],
  message: "security.devices.revoked",
});
