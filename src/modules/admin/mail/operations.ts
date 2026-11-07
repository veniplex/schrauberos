import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { checkMailLimits, MAIL_SECURITY, MAX_MAIL_LIMIT, normalizeMailAddress } from "@/lib/mail";
import { canonicalHost, isForbiddenHost, isPrivateAddress } from "@/lib/offsite/host-policy";
import { logError } from "@/lib/log-safe";
import { db } from "@/server/db";
import { asMailError, sendTestMail, TEST_MAIL, testMailConnection } from "@/server/mail/deliver";
import { LIMIT_MESSAGE, mailCounts } from "@/server/mail/queue";
import { getMailSettings, MAIL_PASSWORD_SECRET, saveMailSettings, setMailPassword, type MailSettings } from "@/server/mail/settings";
import { defineOperation, fail, failField } from "@/server/operations";
import { writeOutboxEvent } from "@/server/outbox";
import { hasSecret } from "@/server/settings";

const limit = z.coerce.number().int().min(0).max(MAX_MAIL_LIMIT);

const settingsInput = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253).default(""),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(MAIL_SECURITY),
  user: z.string().trim().max(200).default(""),
  /** Leer = gespeichertes Passwort behalten; nie gekürzt */
  password: z.string().max(1024).optional(),
  clearPassword: z.boolean().default(false),
  fromAddress: z.string().trim().max(254).default(""),
  fromName: z.string().trim().max(80).default(""),
  replyTo: z.string().trim().max(254).default(""),
  allowPrivate: z.boolean(),
  plainConfirmed: z.boolean(),
  limitHour: limit,
  limitDay: limit,
  limitUserHour: limit,
  limitUserDay: limit,
});

/** Meldung zu einem Versandfehler (`mail.errors.code.<code>`) – nie der Text des Servers. */
function failMail(error: unknown): never {
  const mail = asMailError(error);
  if (mail.code === "failed") logError("mail", error); // Art und Code, kein Text (log-safe)
  fail("failed", `mail.errors.code.${mail.code}` as MessageKey);
}

/**
 * Einstellungen speichern. Regeln:
 *  - **Server:** gültiger Name oder gültige Adresse; der eigene Rechner, verbindungs-lokale Adressen und Metadaten-Dienste sind nie erlaubt; eine Adresse im privaten Netz nur mit der Freigabe `allowPrivate`.
 *    (Namen werden erst beim Verbinden aufgelöst und geprüft – dort greift die Sperre gegen Umlenkung.)
 *  - **Unverschlüsselt** (`none`) nur mit Freigabe für das eigene Netz **und** ausdrücklicher Bestätigung.
 *  - **Passwort** (Geheimnis, verschlüsselt): leer lässt das gespeicherte; ändert sich Server, Anschluss, Verschlüsselung oder Benutzer, muss es neu eingegeben werden – ein gespeichertes Passwort geht nie an ein
 *    anderes Ziel. Ein Benutzername braucht ein Passwort.
 *  - **Einschalten** geht erst mit Server und gültiger Absenderadresse.
 */
const saveSettingsOperation = defineOperation({
  name: "admin.mail.saveSettings",
  permission: "mail.manage",
  input: settingsInput,
  audit: "mail.settings",
  // Lesen außerhalb der Transaktion (SQLite hat nur einen Schreiber)
  prepare: async () => ({ current: await getMailSettings(), hasPassword: await hasSecret(MAIL_PASSWORD_SECRET) }),
  run: async ({ input, prepared, tx, audit: setAudit }) => {
    const { current } = prepared;
    const host = input.host.replace(/^\[|\]$/g, "");
    if (host) {
      const canonical = canonicalHost(host);
      if (!canonical) failField("host", "mail.errors.host");
      if (isForbiddenHost(host)) failField("host", "mail.errors.hostForbidden");
      if (canonical.kind === "ip" && isPrivateAddress(canonical.ip) && !input.allowPrivate) failField("host", "mail.errors.privateNeedsApproval");
    }
    const fromAddress = input.fromAddress ? (normalizeMailAddress(input.fromAddress) ?? failField("fromAddress", "mail.errors.fromAddress")) : "";
    const replyTo = input.replyTo ? (normalizeMailAddress(input.replyTo) ?? failField("replyTo", "mail.errors.replyTo")) : "";
    if (input.security === "none") {
      if (!input.allowPrivate) failField("security", "mail.errors.plainNeedsPrivate");
      if (!input.plainConfirmed) failField("plainConfirmed", "mail.errors.plainNeedsConfirm");
    }
    if (input.enabled && (!host || !fromAddress)) failField("enabled", "mail.errors.enableIncomplete");

    const targetChanged = host !== current.host || input.port !== current.port || input.security !== current.security || input.user !== current.user;
    const newPassword = input.password ? input.password : null;
    const clearing = input.clearPassword || !input.user;
    if (input.user && !newPassword && (input.clearPassword || !prepared.hasPassword || targetChanged)) failField("password", "mail.errors.userNeedsPassword");
    const next: MailSettings = {
      enabled: input.enabled,
      host,
      port: input.port,
      security: input.security,
      user: input.user,
      fromAddress,
      fromName: input.fromName,
      replyTo,
      allowPrivate: input.allowPrivate,
      plainConfirmed: input.security === "none" ? input.plainConfirmed : false,
      limits: { hour: input.limitHour, day: input.limitDay, userHour: input.limitUserHour, userDay: input.limitUserDay },
    };
    await saveMailSettings(next, tx);
    if (newPassword && input.user) await setMailPassword(newPassword, tx);
    else if (clearing) await setMailPassword(null, tx);
    setAudit({ target: `${host || "–"}:${input.port} · ${input.security} · ${input.enabled ? "an" : "aus"}` });
    return { saved: true };
  },
});

export const saveSettings = saveSettingsOperation;

/** „Verbindung testen“ mit den gespeicherten Einstellungen: nur Handshake und Anmeldung, es wird nichts gesendet. */
export const testConnection = defineOperation({
  name: "admin.mail.testConnection",
  permission: "mail.manage",
  input: z.object({}),
  audit: "mail.test",
  transaction: false,
  run: async ({ audit: setAudit }) => {
    try {
      await testMailConnection();
    } catch (error) {
      return failMail(error);
    }
    setAudit({ target: "Handshake/Anmeldung" });
    return { ok: true };
  },
});

/** Test-Mail **nur an die eigene Adresse** des angemeldeten Kontos – es gibt kein Eingabefeld für eine Adresse. */
export const sendTest = defineOperation({
  name: "admin.mail.sendTest",
  permission: "mail.manage",
  input: z.object({}),
  audit: "mail.testSend",
  transaction: false,
  run: async ({ principal, audit: setAudit }) => {
    const to = normalizeMailAddress(principal.user.email ?? "");
    if (!to) fail("failed", "mail.errors.noOwnAddress");
    const settings = await getMailSettings();
    const hit = checkMailLimits(await mailCounts(db, principal.user.id), settings.limits);
    if (hit) fail("busy", LIMIT_MESSAGE[hit]);
    try {
      await sendTestMail({ id: principal.user.id, name: principal.user.name, email: to }, TEST_MAIL);
    } catch (error) {
      return failMail(error);
    }
    setAudit({ target: to });
    return { to };
  },
});

/** Eine aufgegebene Nachricht erneut zum Versand vormerken (solange ihr Inhalt noch da ist). */
export const resendMail = defineOperation({
  name: "admin.mail.resend",
  permission: "mail.manage",
  input: z.object({ id: z.string().min(1).max(40) }),
  audit: "mail.resend",
  run: async ({ input, tx, principal, audit: setAudit }) => {
    const row = await tx.mailMessage.findUnique({ where: { id: input.id } });
    if (!row) fail("notFound", "common.errors.notFound");
    if (row.status !== "failed" || row.body === null) fail("conflict", "mail.errors.notFailed");
    const moved = await tx.mailMessage.updateMany({ where: { id: row.id, status: "failed" }, data: { status: "queued", attempts: 0, errorCode: null } });
    if (moved.count !== 1) fail("conflict", "mail.errors.notFailed");
    await writeOutboxEvent(tx, { type: "mail.send", entityId: row.id, payload: { mailId: row.id }, actorId: principal.user.id });
    setAudit({ target: `${row.toAddresses} – ${row.subject}`, entityId: row.id });
    return { id: row.id };
  },
});
