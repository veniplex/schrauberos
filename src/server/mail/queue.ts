import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  checkMailLimits,
  MAIL_MAX_ATTACHMENT_BYTES,
  MAIL_MAX_ATTACHMENTS,
  MAIL_MAX_BODY,
  parseRecipients,
  sanitizeSubject,
  serializeAttachments,
  type MailAttachmentRef,
  type MailLimitHit,
} from "@/lib/mail";
import { writeAudit } from "@/server/audit";
import { fileExists, fileSize } from "@/server/files";
import { fail, OperationError } from "@/server/operations/errors";
import type { RunContext } from "@/server/operations/operation";
import { getMailSettings, isMailConfigured } from "./settings";

/**
 * Nachricht für den Versand vormerken – **in der Transaktion der aufrufenden Operation**: Ist sie zurückgerollt, gibt es weder Zeile noch Ereignis; ist sie festgeschrieben, wird genau eine Nachricht
 * zugestellt (Outbox, Abnehmer `mail.send` der Funktion „E-Mail“, Wiederholung mit Wartezeit, Aufgabe nach `MAIL_MAX_ATTEMPTS` Versuchen – sichtbar im Sendeprotokoll und im Systemstatus).
 *
 * Aufrufer (Rechnungen, Angebote …) prüfen **vorher** ihr eigenes Fachrecht und fragen mit `mailConfigured()` (außerhalb der Transaktion, in der Oberfläche), ob sie „Per E-Mail senden“ überhaupt anbieten.
 * Hier wird zusätzlich verlangt: das Recht `mail.send` der absendenden Person (Regel 9: in keiner Standardrolle), ein eingerichteter Versand, gültige Empfänger, Betreff und Inhalt in den Grenzen,
 * vorhandene Anhänge (relative Pfade unter `files/` – ein Anhang wird nie kopiert und nie verändert) und die **Versandlimits** (je Stunde/Tag, gesamt und je Benutzer). Der Empfänger steht im Audit-Log.
 *
 * Alle Lesezugriffe laufen über `tx` (SQLite hat nur einen Schreiber).
 */
export const MAIL_MAX_ATTEMPTS = 10;

export type QueueMailInput = {
  to: readonly string[];
  subject: string;
  /** Nur Text; Absenderzeile und Kopfzeilen entstehen beim Versand */
  text: string;
  attachments?: readonly MailAttachmentRef[];
  /** Fachlicher Bezug für die Zuordnung im Protokoll (z. B. `invoice`) und dessen ID – kein Inhalt */
  purpose?: string;
  entityId?: string;
};

type Counter = Pick<PrismaClient | Prisma.TransactionClient, "mailMessage">;

/** Zahl der in den letzten Stunden/Tagen angenommenen Nachrichten (gesamt und für eine Person). */
export async function mailCounts(client: Counter, userId: string | null, now = new Date()) {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const user = userId ? { userId } : { userId: null };
  const [hour, day, userHour, userDay] = await Promise.all([
    client.mailMessage.count({ where: { createdAt: { gte: hourAgo } } }),
    client.mailMessage.count({ where: { createdAt: { gte: dayAgo } } }),
    client.mailMessage.count({ where: { createdAt: { gte: hourAgo }, ...user } }),
    client.mailMessage.count({ where: { createdAt: { gte: dayAgo }, ...user } }),
  ]);
  return { hour, day, userHour, userDay };
}

export const LIMIT_MESSAGE = { hour: "mail.errors.limitHour", day: "mail.errors.limitDay", userHour: "mail.errors.limitUserHour", userDay: "mail.errors.limitUserDay" } as const satisfies Record<MailLimitHit, string>;

export async function queueMail(ctx: Pick<RunContext<unknown, unknown>, "tx" | "emit" | "principal">, mail: QueueMailInput): Promise<{ id: string }> {
  const { tx, emit, principal } = ctx;
  if (!principal.can("mail.send")) fail("forbidden");
  const settings = await getMailSettings(tx);
  if (!isMailConfigured(settings)) fail("failed", "mail.errors.notConfigured");

  const recipients = parseRecipients(mail.to);
  if (!recipients.ok) fail("invalid", recipients.reason === "tooMany" ? "mail.errors.tooManyRecipients" : recipients.reason === "empty" ? "mail.errors.noRecipient" : "mail.errors.badRecipient", { address: recipients.bad ?? "" });
  const subject = sanitizeSubject(mail.subject);
  if (!subject) fail("invalid", "mail.errors.noSubject");
  if (!mail.text.trim() || mail.text.length > MAIL_MAX_BODY) fail("invalid", "mail.errors.badBody");

  const attachments = mail.attachments ?? [];
  if (attachments.length > MAIL_MAX_ATTACHMENTS) fail("invalid", "mail.errors.tooManyAttachments");
  let bytes = 0;
  for (const attachment of attachments) {
    // `fileExists`/`fileSize` lehnen jeden Pfad ab, der nicht dem festen Muster unter `files/` entspricht (wirft)
    try {
      if (!fileExists(attachment.path)) fail("notFound", "mail.errors.attachmentMissing");
      bytes += fileSize(attachment.path);
    } catch (error) {
      if (error instanceof OperationError) throw error;
      fail("invalid", "mail.errors.attachmentMissing");
    }
  }
  if (bytes > MAIL_MAX_ATTACHMENT_BYTES) fail("invalid", "mail.errors.attachmentsTooLarge");

  const hit = checkMailLimits(await mailCounts(tx, principal.user.id), settings.limits);
  if (hit) fail("busy", LIMIT_MESSAGE[hit]);

  const row = await tx.mailMessage.create({
    data: {
      userId: principal.user.id,
      userName: principal.user.name.slice(0, 120),
      toAddresses: recipients.addresses.join(", "),
      subject,
      body: mail.text,
      attachments: serializeAttachments(attachments),
      purpose: mail.purpose?.slice(0, 40) ?? null,
      entityId: mail.entityId?.slice(0, 60) ?? null,
    },
    select: { id: true },
  });
  // Das Ereignis trägt nur die ID – Empfänger, Betreff und Inhalt stehen nicht in der Outbox (die sie 14 Tage nach der Zustellung aufbewahrt)
  await emit("mail.send", { mailId: row.id }, row.id);
  await writeAudit(tx, "mail.send", { target: `${recipients.addresses.join(", ")} – ${subject}`, entityId: row.id, actor: { id: principal.user.id, name: principal.user.name } });
  return { id: row.id };
}
