import "server-only";
import { classifyMailError, normalizeMailAddress, parseAttachments, sanitizeDisplayName } from "@/lib/mail";
import { readFile } from "node:fs/promises";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { resolveRel } from "@/server/files";
import { MAIL_MAX_ATTEMPTS } from "./queue";
import { getMailPassword, getMailSettings, isMailConfigured, type MailSettings } from "./settings";
import { MailError, sendMailNow, verifyMailConnection, type MailConnection } from "./transport";

/**
 * Zustellung einer vorgemerkten Nachricht (Abnehmer `mail.send` der Outbox) und die direkten Wege der Verwaltung (Verbindungstest, Test-Mail).
 *
 * **Mindestens einmal:** Stürzt der Prozess nach dem Absenden und vor dem Vermerken ab, geht die Nachricht noch einmal hinaus (mit derselben `Message-ID`, damit Empfänger sie als Dublette erkennen).
 * **Wiederholen:** Netz, Zeit, Anmeldung, Zertifikat und vorübergehende Absagen (4xx) werfen – der Runner wiederholt mit Wartezeit (30 s · 2ⁿ, höchstens 1 h), bis `MAIL_MAX_ATTEMPTS` erreicht sind. Eine **endgültige**
 * Absage (Empfänger 5xx, Nachricht zu groß) wird nicht wiederholt. Aufgegeben = Status „failed“ im Sendeprotokoll, ein Audit-Eintrag und bei erschöpften Versuchen auch das aufgegebene Ereignis im Systemstatus.
 * In Protokoll, Audit und Meldungen steht nur der Fehlercode (`MailErrorCode`), nie die Antwort des Servers.
 */
export async function connectionFor(settings: MailSettings): Promise<MailConnection> {
  const password = settings.user ? await getMailPassword() : null;
  // Konto angegeben, aber kein lesbares Passwort (nie gesetzt, oder `secret.key` fehlt): lieber nicht versuchen, als mit leerem Passwort anzumelden
  if (settings.user && password === null) throw new MailError("config");
  return { host: settings.host, port: settings.port, security: settings.security, user: settings.user, password, allowPrivate: settings.allowPrivate, plainConfirmed: settings.plainConfirmed };
}

const fromOf = (settings: MailSettings) => {
  const address = normalizeMailAddress(settings.fromAddress);
  if (!address) throw new MailError("config");
  return { name: sanitizeDisplayName(settings.fromName), address };
};

/** Fehler → `MailError` (Code, ob endgültig). */
export function asMailError(error: unknown): MailError {
  if (error instanceof MailError) return error;
  const { code, permanent } = classifyMailError(error);
  return new MailError(code, permanent);
}

/** Inhalt der Test-Mail (zweisprachig: die Sprache der Empfängerin ist hier nicht bekannt) */
export const TEST_MAIL = {
  subject: "SchrauberOS: Test-Mail / test email",
  body: "Diese Test-Mail bestätigt, dass der E-Mail-Versand von SchrauberOS funktioniert.\n\nThis test email confirms that sending email from SchrauberOS works.",
} as const;

export type DeliveryResult = "sent" | "skipped" | "failed";

export async function deliverQueuedMail(id: string, info: { attempt: number }): Promise<DeliveryResult> {
  const row = await db.mailMessage.findUnique({ where: { id } });
  // schon gesendet, aufgegeben oder gelöscht: nichts zu tun (Wiederholung eines Ereignisses nach einem Absturz)
  if (!row || row.status !== "queued") return "skipped";
  const attempts = row.attempts + 1;
  try {
    const settings = await getMailSettings();
    if (!isMailConfigured(settings)) throw new MailError("config");
    const attachments = [];
    for (const a of parseAttachments(row.attachments)) {
      try {
        attachments.push({ filename: a.filename, content: await readFile(resolveRel(a.path)), contentType: a.contentType });
      } catch {
        throw new MailError("failed", true); // ungültiger Pfad im Datensatz oder Datei fehlt: nie versuchen
      }
    }
    await sendMailNow(await connectionFor(settings), {
      from: fromOf(settings),
      replyTo: normalizeMailAddress(settings.replyTo) ?? undefined,
      to: row.toAddresses.split(", "),
      subject: row.subject,
      text: row.body ?? "",
      attachments,
      messageId: row.id,
    });
  } catch (error) {
    const failure = asMailError(error);
    const final = failure.permanent || info.attempt >= MAIL_MAX_ATTEMPTS;
    await db.mailMessage.update({ where: { id }, data: { attempts, errorCode: failure.code, status: final ? "failed" : "queued" } });
    if (final) await audit("mail.sendFailed", { target: `${row.toAddresses} – ${row.subject} (${failure.code})`, entityId: id, actor: { id: null, name: "System" } });
    if (failure.permanent) return "failed"; // keine Wiederholung: der Abnehmer meldet „zugestellt“, das Protokoll sagt „fehlgeschlagen“
    throw failure; // der Runner wiederholt (oder gibt nach dem letzten Versuch das Ereignis auf)
  }
  await db.mailMessage.update({ where: { id }, data: { status: "sent", sentAt: new Date(), attempts, errorCode: null, body: null, attachments: null } });
  return "sent";
}

/** Verbindungstest mit den gespeicherten Einstellungen: nur Handshake und Anmeldung, es wird nichts gesendet. Wirft `MailError`. */
export async function testMailConnection(): Promise<void> {
  const settings = await getMailSettings();
  if (!settings.host.trim()) throw new MailError("config");
  fromOf(settings);
  await verifyMailConnection(await connectionFor(settings), settings.fromAddress);
}

/**
 * Test-Mail **nur an die eigene Adresse** der angemeldeten Person (es gibt keinen Weg, eine andere Adresse anzugeben). Sie läuft sofort (nicht über die Outbox), damit das Ergebnis gleich
 * da ist, und steht im Sendeprotokoll (ohne Inhalt). Wirft `MailError`.
 */
export async function sendTestMail(user: { id: string; name: string; email: string }, text: { subject: string; body: string }): Promise<void> {
  const settings = await getMailSettings();
  if (!isMailConfigured(settings)) throw new MailError("config");
  const to = normalizeMailAddress(user.email);
  if (!to) throw new MailError("recipient", true);
  const row = await db.mailMessage.create({ data: { userId: user.id, userName: user.name.slice(0, 120), toAddresses: to, subject: text.subject, purpose: "test", attempts: 1 }, select: { id: true } });
  try {
    await sendMailNow(await connectionFor(settings), { from: fromOf(settings), replyTo: normalizeMailAddress(settings.replyTo) ?? undefined, to: [to], subject: text.subject, text: text.body, attachments: [], messageId: row.id });
  } catch (error) {
    const failure = asMailError(error);
    await db.mailMessage.update({ where: { id: row.id }, data: { status: "failed", errorCode: failure.code } });
    throw failure;
  }
  await db.mailMessage.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date() } });
}

/** Aufräumen (täglich): Inhalt aufgegebener Nachrichten nach 30 Tagen, das Protokoll nach 365 Tagen. Gibt die Zahl der gelöschten Zeilen zurück. */
export async function pruneMail(now = new Date()): Promise<number> {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  await db.mailMessage.updateMany({ where: { createdAt: { lt: days(30) }, OR: [{ body: { not: null } }, { attachments: { not: null } }] }, data: { body: null, attachments: null } });
  const { count } = await db.mailMessage.deleteMany({ where: { createdAt: { lt: days(365) } } });
  return count;
}
