import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { canonicalHost, isAllowedAddress, isForbiddenHost, isPrivateAddress } from "@/lib/offsite/host-policy";
import { classifyMailError, normalizeMailAddress, sanitizeDisplayName, type MailErrorCode, type MailSecurity } from "@/lib/mail";

/**
 * Verbindung zum SMTP-Server: **Ziel gesperrt wie bei Off-Site/Webhooks, Adresse geprüft und festgelegt, TLS mit Zertifikatsprüfung als Standard.**
 *
 *  - Zielsperre (`lib/offsite/host-policy.ts`): Loopback, der eigene Rechner, Verbindungs-lokal (169.254.x) und die Metadaten-Dienste der Cloud sind nie erlaubt. **Private Netze** (RFC 1918, ULA) nur nach
 *    ausdrücklicher Freigabe (`allowPrivate`) – ein interner Relay ist der Ausnahmefall, ein öffentlicher Mailserver der Normalfall.
 *  - **Auflösen und festlegen** (wie `resolvePinned` bei Off-Site): Der Name wird aufgelöst, jede Antwort geprüft, verbunden wird mit der **geprüften Adresse** (nodemailer bekommt die IP, den Namen nur für
 *    SNI und die Prüfung des Zertifikats) – so kann ein Name nicht zwischen Prüfung und Verbindung umgelenkt werden (DNS-Rebinding).
 *  - **TLS:** `starttls` (Standard, Port 587; `requireTLS`: ohne Verschlüsselung wird nichts gesendet, kein Zurückfallen auf Klartext) oder `smtps` (Port 465); Zertifikat und Name werden geprüft
 *    (`rejectUnauthorized`, mindestens TLS 1.2). **Klartext** (`none`) nur mit bestätigter Freigabe **und** nur zu einem privaten Ziel – gegen eine öffentliche Adresse wird nie unverschlüsselt verbunden.
 *  - Nichts aus den Nachrichten darf Dateien lesen oder Adressen abrufen (`disableFileAccess`/`disableUrlAccess`).
 */
export class MailError extends Error {
  constructor(readonly code: MailErrorCode, readonly permanent = false) {
    super(`E-Mail: ${code}`);
    this.name = "MailError";
  }
}

export type MailConnection = {
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  password: string | null;
  allowPrivate: boolean;
  plainConfirmed: boolean;
};

export type PinnedMailTarget = { address: string; family: 4 | 6; private: boolean; servername: string | null };

type Lookup = (name: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
const LOOKUP_MS = 10_000;

/** Löst das Ziel auf und prüft es gegen die Richtlinie. Wirft `MailError` (`forbiddenHost`, `dns`, `config`). `lookupImpl`: nur für Tests (Antworten der Namensauflösung vorgeben, etwa für Rebinding). */
export async function resolveMailTarget(host: string, options: { allowPrivate: boolean }, lookupImpl: Lookup = lookup as Lookup): Promise<PinnedMailTarget> {
  const canonical = canonicalHost(host);
  if (!canonical) throw new MailError("config");
  if (isForbiddenHost(host)) throw new MailError("forbiddenHost");
  const allowed = (address: string) => isAllowedAddress(address) && (options.allowPrivate || !isPrivateAddress(address));
  if (canonical.kind === "ip") {
    if (!allowed(canonical.ip)) throw new MailError("forbiddenHost");
    return { address: canonical.ip, family: isIP(canonical.ip) as 4 | 6, private: isPrivateAddress(canonical.ip), servername: null };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const answers = await Promise.race([
      lookupImpl(canonical.name, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new MailError("dns")), LOOKUP_MS))),
    ]);
    if (answers.length === 0) throw new MailError("dns");
    // Jede Antwort muss erlaubt sein: ein Name mit einer erlaubten und einer verbotenen (oder nicht freigegebenen privaten) Adresse wäre ein Umlenkversuch
    if (answers.some((answer) => !allowed(answer.address))) throw new MailError("forbiddenHost");
    const first = answers[0];
    return { address: first.address, family: first.family as 4 | 6, private: isPrivateAddress(first.address), servername: canonical.name };
  } catch (error) {
    throw error instanceof MailError ? error : new MailError("dns");
  } finally {
    clearTimeout(timer);
  }
}

export type TlsOverride = { ca?: string | Buffer | Array<string | Buffer> };

/** Nur für Tests: eigene Zertifizierungsstelle des Fake-Servers und vorgegebene Namensauflösung. Im Betrieb wirkungslos – es wirft. */
export const mailTestHooks: { tls?: TlsOverride; lookup?: Lookup } = {};
export function setMailTestHooks(hooks: { tls?: TlsOverride; lookup?: Lookup }): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("setMailTestHooks: nur in Tests");
  mailTestHooks.tls = hooks.tls;
  mailTestHooks.lookup = hooks.lookup;
}

/**
 * Optionen für nodemailer – eine reine Funktion (getestet). `tls` ist nur für Tests austauschbar (eigene Zertifizierungsstelle des Fake-Servers); `rejectUnauthorized` und die Mindestversion bleiben immer.
 */
export function transportOptions(connection: MailConnection, target: PinnedMailTarget, heloName: string, override: TlsOverride = {}): SMTPTransport.Options {
  if (connection.security === "none" && !(connection.plainConfirmed && connection.allowPrivate && target.private)) throw new MailError("config");
  if (connection.security !== "none" && connection.security !== "starttls" && connection.security !== "smtps") throw new MailError("config");
  return {
    host: target.address,
    port: connection.port,
    secure: connection.security === "smtps",
    requireTLS: connection.security === "starttls",
    ignoreTLS: connection.security === "none",
    name: heloName,
    auth: connection.user ? { user: connection.user, pass: connection.password ?? "" } : undefined,
    tls: { ...(target.servername ? { servername: target.servername } : {}), rejectUnauthorized: true, minVersion: "TLSv1.2", ...override },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}

/** Name für den EHLO-Gruß: die Domain der Absenderadresse (ein Name, den der Server kennen kann), sonst `localhost`. */
export const heloNameFor = (fromAddress: string): string => normalizeMailAddress(fromAddress)?.split("@")[1] ?? "localhost";

export type MailPayload = {
  from: { name: string; address: string };
  replyTo?: string;
  to: string[];
  subject: string;
  text: string;
  /** Inhalt als Bytes: `path` wäre für nodemailer Dateizugriff (gesperrt, `disableFileAccess`) – die Datei liest der Aufrufer selbst */
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
  /** Kennung für Nachverfolgung im Log des Servers (nicht der Inhalt) */
  messageId?: string;
};

function wrap(error: unknown): MailError {
  if (error instanceof MailError) return error;
  const { code, permanent } = classifyMailError(error);
  return new MailError(code, permanent);
}

/** Baut den Transport (löst das Ziel auf, prüft Richtlinie) und führt `work` aus; schließt danach. Fehler werden zu `MailError` mit Code. */
async function withTransport<T>(connection: MailConnection, fromAddress: string, deps: { lookup?: Lookup; tls?: TlsOverride }, work: (transport: Transporter<SMTPTransport.SentMessageInfo>) => Promise<T>): Promise<T> {
  const target = await resolveMailTarget(connection.host, { allowPrivate: connection.allowPrivate }, deps.lookup ?? mailTestHooks.lookup);
  const transport = nodemailer.createTransport(transportOptions(connection, target, heloNameFor(fromAddress), deps.tls ?? mailTestHooks.tls));
  try {
    return await work(transport);
  } catch (error) {
    throw wrap(error);
  } finally {
    transport.close();
  }
}

/** Nur Handshake und Anmeldung (EHLO, STARTTLS, AUTH) – es wird nichts gesendet. */
export async function verifyMailConnection(connection: MailConnection, fromAddress: string, deps: { lookup?: Lookup; tls?: TlsOverride } = {}): Promise<void> {
  await withTransport(connection, fromAddress, deps, async (transport) => {
    await transport.verify();
  });
}

/** Sendet eine Nachricht. Alle Kopfzeilenwerte sind bereits bereinigt (`lib/mail.ts`); Adressen gehen als Objekte an nodemailer, nie als zusammengesetzter Text. */
export async function sendMailNow(connection: MailConnection, mail: MailPayload, deps: { lookup?: Lookup; tls?: TlsOverride } = {}): Promise<void> {
  await withTransport(connection, mail.from.address, deps, async (transport) => {
    const result = await transport.sendMail({
      from: { name: sanitizeDisplayName(mail.from.name), address: mail.from.address },
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      to: mail.to.map((address) => ({ name: "", address })),
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, contentDisposition: "attachment" as const })),
      ...(mail.messageId ? { messageId: `<${mail.messageId}@${heloNameFor(mail.from.address)}>` } : {}),
    });
    // alle Empfänger müssen angenommen sein: eine teilweise Annahme würde sonst als Erfolg gelten
    if (result.rejected.length > 0) throw Object.assign(new Error("rejected"), { code: "EENVELOPE", command: "RCPT TO", responseCode: 550 });
  });
}
