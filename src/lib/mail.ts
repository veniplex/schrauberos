import { domainToASCII } from "node:url";

/**
 * E-Mail-Versand: die reinen Regeln (Adressen, Kopfzeilen ohne Einschleusen, Fehlerarten, Versandlimits) ohne Netzwerk und ohne Datenbank. Die Anbindung steht in `src/server/mail`.
 */

export const MAIL_SECURITY = ["starttls", "smtps", "none"] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];
export const MAIL_STATUSES = ["queued", "sent", "failed"] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

export const MAIL_MAX_RECIPIENTS = 10;
export const MAIL_MAX_SUBJECT = 200;
export const MAIL_MAX_BODY = 200_000;
export const MAIL_MAX_ATTACHMENTS = 5;
/** Gesamtgröße der Anhänge in Byte (viele Server lehnen mehr als 20–25 MB ab; Base64 macht aus 15 MB rund 20 MB) */
export const MAIL_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Steuerzeichen (auch Zeilenumbrüche), Zeichen zur Umkehr der Schreibrichtung und unsichtbare Trenner – aus Zahlenbereichen gebaut, damit im Quelltext kein unsichtbares Zeichen steht. */
const CONTROL = new RegExp(`[${[[0x0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('')}]`, 'g');

/** Kopfzeilenwert aus Fremdeingabe: ohne Steuerzeichen und Zeilenumbrüche (kein Einschleusen weiterer Kopfzeilen), Leerraum zusammengezogen, nach Zeichen gekürzt. */
export function sanitizeHeaderText(value: string, max: number): string {
  return [...value.replace(CONTROL, " ").replace(/\s+/g, " ").trim()].slice(0, max).join("").toWellFormed().trim();
}

/** Anzeigename eines Absenders/Empfängers: zusätzlich ohne Anführungszeichen, Klammern und spitze Klammern (sie würden die Adresse im Kopf verändern). */
export function sanitizeDisplayName(value: string, max = 80): string {
  return sanitizeHeaderText(value.replace(/["<>\\;,@]/g, " "), max);
}

export const sanitizeSubject = (value: string): string => sanitizeHeaderText(value, MAIL_MAX_SUBJECT);

/** Dateiname eines Anhangs: nur ein Name (kein Pfad), ohne Steuerzeichen, Anführungszeichen und Trenner; nie leer. */
export function sanitizeAttachmentName(value: string, fallback = "anhang"): string {
  const cleaned = sanitizeHeaderText(value.replace(/[\\/"<>:*?|;]/g, "_"), 120).replace(/^\.+/, "");
  return cleaned || fallback;
}

const LOCAL = /^[A-Za-z0-9._%+'-]{1,64}$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * Normalisiert eine Adresse (`name@firma.de`) oder liefert `null`. Streng mit Absicht: genau ein `@`, ein Teil vor dem `@` aus Buchstaben, Ziffern und `._%+'-` (ohne führenden, doppelten oder
 * abschließenden Punkt), eine Domain mit mindestens einem Punkt (Internationalisierte Namen werden in Punycode umgewandelt), insgesamt höchstens 254 Zeichen. Keine Leerzeichen, Anführungszeichen,
 * Klammern oder Zeilenumbrüche – die Adresse landet in `RCPT TO:<…>` und in Kopfzeilen. Der Domainteil wird kleingeschrieben, der Teil davor bleibt (er kann unterscheiden).
 */
export function normalizeMailAddress(input: string): string | null {
  const text = input.trim();
  // Jedes Leer- und Steuerzeichen schon vor der Umwandlung ablehnen: `domainToASCII` (URL-Regeln) entfernt Tabulatoren und Zeilenumbrüche stillschweigend und machte aus „a@b.de<Zeilenumbruch>x“ die Adresse „a@b.dex“
  if (!text || text.length > 320 || /\s/.test(text) || new RegExp(CONTROL.source).test(text)) return null;
  const at = text.indexOf("@");
  if (at < 1 || at !== text.lastIndexOf("@")) return null;
  const local = text.slice(0, at);
  const domain = domainToASCII(text.slice(at + 1)).toLowerCase();
  if (!LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)) || /^\d+$/.test(labels.at(-1)!)) return null;
  const address = `${local}@${domain}`;
  return address.length <= 254 ? address : null;
}

export const isValidMailAddress = (input: string): boolean => normalizeMailAddress(input) !== null;

/** Empfängerliste prüfen: jede Adresse gültig, keine doppelt (ohne Rücksicht auf Groß-/Kleinschreibung der Domain), 1 … `MAIL_MAX_RECIPIENTS`. */
export function parseRecipients(list: readonly string[]): { ok: true; addresses: string[] } | { ok: false; reason: "empty" | "tooMany" | "invalid"; bad?: string } {
  const addresses: string[] = [];
  for (const raw of list) {
    const address = normalizeMailAddress(raw);
    if (!address) return { ok: false, reason: "invalid", bad: sanitizeHeaderText(raw, 60) };
    if (!addresses.some((known) => known.toLowerCase() === address.toLowerCase())) addresses.push(address);
  }
  if (addresses.length === 0) return { ok: false, reason: "empty" };
  if (addresses.length > MAIL_MAX_RECIPIENTS) return { ok: false, reason: "tooMany" };
  return { ok: true, addresses };
}

/** Anhänge im Datenbanktext: eine Zeile je Anhang `relativer Pfad|Dateiname|Typ` (Pfade und Typen enthalten nie `|` oder Zeilenumbrüche, Namen werden bereinigt). */
export type MailAttachmentRef = { path: string; filename: string; contentType: string };
export const serializeAttachments = (list: readonly MailAttachmentRef[]): string | null => (list.length ? list.map((a) => `${a.path}|${sanitizeAttachmentName(a.filename).replace(/\|/g, "_")}|${a.contentType}`).join("\n") : null);
export function parseAttachments(text: string | null): MailAttachmentRef[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.split("|"))
    .filter((parts) => parts.length === 3 && parts[0] && parts[1] && /^[\w.+-]+\/[\w.+-]+$/.test(parts[2]))
    .map(([path, filename, contentType]) => ({ path, filename, contentType }));
}

/* ------------------------------------------------------------------ Fehlerarten */

/** Fehlercodes des Versands (nur diese Wörter gelangen in Protokoll, Audit und Oberfläche – nie die Antwort des Servers, die Zugangsdaten oder Adressen enthalten könnte). */
export const MAIL_ERROR_CODES = ["config", "forbiddenHost", "dns", "connect", "timeout", "tls", "auth", "recipient", "rejected", "tooLarge", "protocol", "keyUnavailable", "failed"] as const;
export type MailErrorCode = (typeof MAIL_ERROR_CODES)[number];

const TLS_CODES = new Set(["ETLS", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID", "CERT_UNTRUSTED", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PROTOCOL_VERSION", "EPROTO"]);

const TLS_MESSAGE = /certificate|self[- ]signed|altnames|issuer|unable to verify|\btls\b|\bssl\b|handshake|wrong version number|protocol version/i;

/**
 * Ordnet einen Fehler von nodemailer/Node einem Code zu und sagt, ob ein weiterer Versuch sinnlos ist (`permanent`): Ein vom Server **endgültig** abgelehnter Empfänger (5xx) oder eine zu große Nachricht
 * wird nicht wiederholt, alles andere (Netz, Zeit, Anmeldung, Zertifikat, vorübergehende 4xx) schon – mit Wartezeit, bis es klappt oder aufgegeben wird.
 */
export function classifyMailError(error: unknown): { code: MailErrorCode; permanent: boolean } {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const response = typeof e.responseCode === "number" ? e.responseCode : 0;
  const command = typeof e.command === "string" ? e.command : "";
  const message = typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : "";
  if (TLS_CODES.has(code)) return { code: "tls", permanent: false };
  // nodemailer meldet Fehler beim Aushandeln von TLS (Zertifikat nicht vertrauenswürdig, falscher Name, Gegenstelle spricht kein TLS) als allgemeinen Socket-Fehler (`ESOCKET`) – nur der Text unterscheidet sie.
  // Er wird hier nur zum Einordnen gelesen, nie gespeichert oder angezeigt.
  if ((code === "ESOCKET" || code === "ECONNECTION" || code === "") && TLS_MESSAGE.test(message)) return { code: "tls", permanent: false };
  if (code === "EAUTH") return { code: "auth", permanent: false };
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return { code: "timeout", permanent: false };
  if (code === "EDNS" || code === "ENOTFOUND" || code === "EAI_AGAIN") return { code: "dns", permanent: false };
  if (code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ESOCKET") return { code: "connect", permanent: false };
  if (response === 552) return { code: "tooLarge", permanent: true };
  if (code === "EENVELOPE" || command === "RCPT TO") return response >= 500 || response === 0 ? { code: "recipient", permanent: true } : { code: "rejected", permanent: false };
  if (response >= 500) return { code: "rejected", permanent: true };
  if (response >= 400) return { code: "rejected", permanent: false };
  if (code === "EPROTOCOL" || code === "EMESSAGE") return { code: "protocol", permanent: false };
  return { code: "failed", permanent: false };
}

/* ------------------------------------------------------------------ Versandlimits */

export type MailLimits = { hour: number; day: number; userHour: number; userDay: number };
export const DEFAULT_MAIL_LIMITS: MailLimits = { hour: 60, day: 300, userHour: 20, userDay: 100 };
export const MAX_MAIL_LIMIT = 100_000;
export type MailCounts = { hour: number; day: number; userHour: number; userDay: number };
export type MailLimitHit = "hour" | "day" | "userHour" | "userDay";

/**
 * Prüft, ob **eine weitere** Nachricht (`adding` Stück, bei mehreren Empfängern je Nachricht eine) noch in die Limits passt. Zählt, was in der jeweiligen Zeitspanne **angenommen** wurde (auch
 * Wartendes und Fehlgeschlagenes – sonst ließe sich ein Limit mit Fehlern umgehen). Ein Limit von 0 bedeutet „aus“. Liefert den ersten überschrittenen Wert (Benutzer vor Gesamt: Er soll wissen, dass es an ihm liegt).
 */
export function checkMailLimits(counts: MailCounts, limits: MailLimits, adding = 1): MailLimitHit | null {
  const over = (count: number, limit: number) => limit > 0 && count + adding > limit;
  if (over(counts.userHour, limits.userHour)) return "userHour";
  if (over(counts.userDay, limits.userDay)) return "userDay";
  if (over(counts.hour, limits.hour)) return "hour";
  if (over(counts.day, limits.day)) return "day";
  return null;
}
