import "server-only";
import { lookup } from "node:dns/promises";
import net, { isIP } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { canonicalHost, isForbiddenHost, isPrivateAddress } from "@/lib/offsite/host-policy";
import { isAllowedTarget } from "@/server/host-gateway";
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

/** Ergebnis eines Versands: wer die Nachricht angenommen hat und wer nicht (nur Adressen); `permanent`: Absage des Servers mit 5xx (Wiederholung sinnlos). */
export type MailSendResult = { accepted: string[]; rejected: Array<{ address: string; permanent: boolean }> };

export type PinnedMailTarget = { address: string; family: 4 | 6; private: boolean; servername: string | null };

type Lookup = (name: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
const LOOKUP_MS = 10_000;

/** Löst das Ziel auf und prüft es gegen die Richtlinie. Wirft `MailError` (`forbiddenHost`, `dns`, `config`). `lookupImpl`: nur für Tests (Antworten der Namensauflösung vorgeben, etwa für Rebinding). */
export async function resolveMailTarget(host: string, options: { allowPrivate: boolean }, lookupImpl: Lookup = lookup as Lookup): Promise<PinnedMailTarget> {
  const canonical = canonicalHost(host);
  if (!canonical) throw new MailError("config");
  if (isForbiddenHost(host)) throw new MailError("forbiddenHost");
  // Das Host-Gateway des Containers ist der Server selbst: auch mit der Freigabe `allowPrivate` nie erlaubt (`server/host-gateway.ts`)
  const allowed = (address: string) => isAllowedTarget(address, { allowPrivate: options.allowPrivate });
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

type Deps = { lookup?: Lookup; tls?: TlsOverride; signal?: AbortSignal };

/**
 * Öffnet die TCP-Verbindung selbst (zur geprüften Adresse) und gibt sie nodemailer als fertigen Socket (`getSocket`/`connection`, derselbe Weg wie bei Proxys; STARTTLS/SMTPS setzt nodemailer
 * danach wie gewohnt auf). So bleibt die Verbindung in unserer Hand: Wird der Versand abgebrochen (Zeitlimit der Outbox), **zerstören wir den Socket** – nodemailer bricht dann ab, statt im Hintergrund
 * weiterzusenden, während die Outbox schon wiederholt.
 */
function ownSocketProvider(target: PinnedMailTarget, port: number, sockets: Set<net.Socket>, connectMs: number): NonNullable<SMTPTransport.Options["getSocket"]> {
  return (_options, callback) => {
    const socket = net.connect({ host: target.address, port, family: target.family });
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const timer = setTimeout(() => socket.destroy(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" })), connectMs);
    const failed = (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      callback(error);
    };
    socket.once("error", failed);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("error", failed);
      callback(null, { connection: socket });
    });
  };
}

/** Baut den Transport (löst das Ziel auf, prüft Richtlinie) und führt `work` aus; schließt danach. Fehler werden zu `MailError` mit Code. `deps.signal`: bricht ab (Sockets zerstört, `MailError("timeout")`). */
async function withTransport<T>(connection: MailConnection, fromAddress: string, deps: Deps, work: (transport: Transporter<SMTPTransport.SentMessageInfo>) => Promise<T>): Promise<T> {
  if (deps.signal?.aborted) throw new MailError("timeout");
  const target = await resolveMailTarget(connection.host, { allowPrivate: connection.allowPrivate }, deps.lookup ?? mailTestHooks.lookup);
  const sockets = new Set<net.Socket>();
  const options = transportOptions(connection, target, heloNameFor(fromAddress), deps.tls ?? mailTestHooks.tls);
  const transport = nodemailer.createTransport({ ...options, getSocket: ownSocketProvider(target, connection.port, sockets, options.connectionTimeout ?? 15_000) });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    for (const socket of sockets) socket.destroy();
  };
  deps.signal?.addEventListener("abort", onAbort, { once: true });
  if (deps.signal?.aborted) onAbort();
  try {
    return await work(transport);
  } catch (error) {
    throw aborted ? new MailError("timeout") : wrap(error);
  } finally {
    deps.signal?.removeEventListener("abort", onAbort);
    for (const socket of sockets) socket.destroy();
    transport.close();
  }
}

/** Nur Handshake und Anmeldung (EHLO, STARTTLS, AUTH) – es wird nichts gesendet. */
export async function verifyMailConnection(connection: MailConnection, fromAddress: string, deps: Deps = {}): Promise<void> {
  await withTransport(connection, fromAddress, deps, async (transport) => {
    await transport.verify();
  });
}

/**
 * Sendet eine Nachricht. Alle Kopfzeilenwerte sind bereits bereinigt (`lib/mail.ts`); Adressen gehen als Objekte an nodemailer, nie als zusammengesetzter Text.
 * Nimmt der Server nur einen Teil der Empfänger an, ist das **kein Fehler**: Die Nachricht ist dann hinaus, das Ergebnis nennt, wer sie hat und wer nicht (und ob die Absage endgültig ist) – der Aufrufer
 * behält die Angenommenen und wiederholt nur für die übrigen. Lehnt der Server **alle** ab, wirft es (`recipient` endgültig bei 5xx, `rejected` wiederholbar bei 4xx).
 */
export async function sendMailNow(connection: MailConnection, mail: MailPayload, deps: Deps = {}): Promise<MailSendResult> {
  return withTransport(connection, mail.from.address, deps, async (transport) => {
    const result = await transport.sendMail({
      from: { name: sanitizeDisplayName(mail.from.name), address: mail.from.address },
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      to: mail.to.map((address) => ({ name: "", address })),
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, contentDisposition: "attachment" as const })),
      ...(mail.messageId ? { messageId: `<${mail.messageId}@${heloNameFor(mail.from.address)}>` } : {}),
    });
    const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "object" && value && typeof (value as { address?: unknown }).address === "string" ? (value as { address: string }).address : "");
    const errors = ((result as { rejectedErrors?: Array<{ recipient?: unknown; responseCode?: unknown }> }).rejectedErrors ?? []);
    const rejected = result.rejected.map(text).filter(Boolean).map((address) => {
      const error = errors.find((e) => text(e.recipient).toLowerCase() === address.toLowerCase());
      // ohne erkennbaren Code gilt die Absage als endgültig (nicht endlos wiederholen)
      const code = typeof error?.responseCode === "number" ? error.responseCode : 550;
      return { address, permanent: code >= 500 };
    });
    return { accepted: result.accepted.map(text).filter(Boolean), rejected };
  });
}
