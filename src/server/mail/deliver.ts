import "server-only";
import { classifyMailError, countAttachmentLines, normalizeMailAddress, parseAttachments, sanitizeDisplayName, splitAddresses } from "@/lib/mail";
import { readFile } from "node:fs/promises";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { resolveRel } from "@/server/files";
import { SecretKeyUnavailableError } from "@/server/secrets";
import { MAIL_MAX_ATTEMPTS } from "./queue";
import { getMailPassword, getMailSettings, isMailConfigured, type MailSettings } from "./settings";
import { MailError, sendMailNow, verifyMailConnection, type MailConnection, type MailSendResult } from "./transport";

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
  // Schlüssel fehlt oder ist nicht lesbar: Wiederholen hilft nicht, bis die Administration ihn wiederherstellt (dann „Erneut senden“)
  if (error instanceof SecretKeyUnavailableError) return new MailError("keyUnavailable", true);
  const { code, permanent } = classifyMailError(error);
  return new MailError(code, permanent);
}

/** Inhalt der Test-Mail (zweisprachig: die Sprache der Empfängerin ist hier nicht bekannt) */
export const TEST_MAIL = {
  subject: "SchrauberOS: Test-Mail / test email",
  body: "Diese Test-Mail bestätigt, dass der E-Mail-Versand von SchrauberOS funktioniert.\n\nThis test email confirms that sending email from SchrauberOS works.",
} as const;

export type DeliveryResult = "sent" | "skipped" | "failed";

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Nachrichten, die in diesem Prozess gerade gesendet werden: ein zweiter Versuch (etwa nach dem Zeitlimit der Outbox) sendet nicht daneben, sondern wird später wiederholt. */
const inFlight = new Set<string>();

/**
 * `signal`: wird die Zustellung abgebrochen (Zeitlimit der Outbox), werden die Verbindungen zerstört und der Versand endet mit `timeout` – es läuft nie ein abgehängter Versand im Hintergrund weiter,
 * während die Wiederholung schon neu sendet. **Teilweise Annahme:** Empfänger, die die Nachricht angenommen haben, stehen in `deliveredTo`; Wiederholung und „Erneut senden“ gehen nur an die übrigen.
 */
export async function deliverQueuedMail(id: string, info: { attempt: number; signal?: AbortSignal }): Promise<DeliveryResult> {
  const row = await db.mailMessage.findUnique({ where: { id } });
  // schon gesendet, aufgegeben oder gelöscht: nichts zu tun (Wiederholung eines Ereignisses nach einem Absturz)
  if (!row || row.status !== "queued") return "skipped";
  // läuft gerade noch (Zeitlimit abgelaufen, Abbruch noch nicht durch): nicht doppelt senden, später wieder versuchen
  if (inFlight.has(id)) throw new MailError("timeout");
  inFlight.add(id);
  const attempts = row.attempts + 1;
  const delivered = splitAddresses(row.deliveredTo);
  let result: MailSendResult | null = null;
  try {
    const settings = await getMailSettings();
    if (!isMailConfigured(settings)) throw new MailError("config");
    const attachments = [];
    const refs = parseAttachments(row.attachments);
    // ein gespeicherter Anhang, der nicht gelesen werden kann, darf nie stillschweigend wegfallen: sonst ginge die Nachricht ohne Anhang als „gesendet“ hinaus
    if (refs.length !== countAttachmentLines(row.attachments)) throw new MailError("failed", true);
    for (const a of refs) {
      try {
        attachments.push({ filename: a.filename, content: await readFile(resolveRel(a.path)), contentType: a.contentType });
      } catch {
        throw new MailError("failed", true); // ungültiger Pfad im Datensatz oder Datei fehlt: nie versuchen
      }
    }
    const open = splitAddresses(row.toAddresses).filter((address) => !delivered.some((done) => sameAddress(done, address)));
    if (open.length > 0) {
      result = await sendMailNow(
        await connectionFor(settings),
        {
          from: fromOf(settings),
          replyTo: normalizeMailAddress(settings.replyTo) ?? undefined,
          to: open,
          subject: row.subject,
          text: row.body ?? "",
          attachments,
          messageId: row.id,
        },
        { signal: info.signal },
      );
    }
  } catch (error) {
    inFlight.delete(id);
    const failure = asMailError(error);
    const final = failure.permanent || info.attempt >= MAIL_MAX_ATTEMPTS;
    await db.mailMessage.update({ where: { id }, data: { attempts, errorCode: failure.code, status: final ? "failed" : "queued" } });
    if (final) await audit("mail.sendFailed", { target: `${row.toAddresses} – ${row.subject} (${failure.code})`, entityId: id, actor: { id: null, name: "System" } });
    if (failure.permanent) return "failed"; // keine Wiederholung: der Abnehmer meldet „zugestellt“, das Protokoll sagt „fehlgeschlagen“
    throw failure; // der Runner wiederholt (oder gibt nach dem letzten Versuch das Ereignis auf)
  }
  inFlight.delete(id);

  // Teilweise Annahme: die Angenommenen merken, für die übrigen entscheidet die Art der Absage
  const accepted = [...delivered, ...(result?.accepted ?? []).filter((address) => !delivered.some((done) => sameAddress(done, address)))];
  const deliveredTo = accepted.length ? accepted.join(", ") : null;
  const rejected = result?.rejected ?? [];
  if (rejected.length > 0) {
    const retryable = rejected.some((r) => !r.permanent);
    const final = !retryable || info.attempt >= MAIL_MAX_ATTEMPTS;
    const code = retryable ? "rejected" : "recipient";
    await db.mailMessage.update({ where: { id }, data: { attempts, errorCode: code, status: final ? "failed" : "queued", deliveredTo } });
    if (final) await audit("mail.sendFailed", { target: `${row.toAddresses} – ${row.subject} (${code}, ${accepted.length}/${splitAddresses(row.toAddresses).length})`, entityId: id, actor: { id: null, name: "System" } });
    if (!final) throw new MailError("rejected", false); // nur die übrigen Empfänger werden wiederholt
    return "failed";
  }
  await db.mailMessage.update({ where: { id }, data: { status: "sent", sentAt: new Date(), attempts, errorCode: null, deliveredTo, body: null, attachments: null } });
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
    const result = await sendMailNow(await connectionFor(settings), { from: fromOf(settings), replyTo: normalizeMailAddress(settings.replyTo) ?? undefined, to: [to], subject: text.subject, text: text.body, attachments: [], messageId: row.id });
    if (result.rejected.length > 0) throw new MailError("recipient", true); // der einzige Empfänger wurde abgelehnt
  } catch (error) {
    const failure = asMailError(error);
    await db.mailMessage.update({ where: { id: row.id }, data: { status: "failed", errorCode: failure.code } });
    throw failure;
  }
  await db.mailMessage.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date() } });
}

/** Aufräumen (täglich): Inhalt gesendeter und aufgegebener Nachrichten nach 30 Tagen (wartende behalten ihn, sonst ginge später ein leerer Text hinaus), das Protokoll nach 365 Tagen. Gibt die Zahl der gelöschten Zeilen zurück. */
export async function pruneMail(now = new Date()): Promise<number> {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  await db.mailMessage.updateMany({ where: { createdAt: { lt: days(30) }, status: { not: "queued" }, OR: [{ body: { not: null } }, { attachments: { not: null } }] }, data: { body: null, attachments: null } });
  const { count } = await db.mailMessage.deleteMany({ where: { createdAt: { lt: days(365) } } });
  return count;
}
