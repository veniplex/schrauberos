import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_MAIL_LIMITS, MAIL_SECURITY, MAX_MAIL_LIMIT, normalizeMailAddress, type MailLimits, type MailSecurity } from "@/lib/mail";
import { db } from "@/server/db";
import { getSecret, setSecret, setSetting } from "@/server/settings";

/**
 * Einstellungen des E-Mail-Versands (Verwaltung → Einstellungen → E-Mail). Alles in `AppSetting` (Schlüssel `mail.*`); das **Passwort** liegt als Geheimnis verschlüsselt (`setSecret`, `secret.key`,
 * nicht im Backup; Verbraucher in `src/modules/admin/mail/secrets.ts`). Die Plattform kennt nur diese Werte – wer Mail verschickt, fragt `mailConfigured()` (die Oberfläche der Funktion zeigt „Per E-Mail
 * senden“ nur dann).
 */
export const MAIL_PASSWORD_SECRET = "mail.password";

type Reader = Pick<PrismaClient | Prisma.TransactionClient, "appSetting">;

export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  /** Ziel in einem privaten Netz erlaubt (interner Relay) – ausdrückliche Freigabe */
  allowPrivate: boolean;
  /** Unverschlüsselte Verbindung (`security: "none"`) ausdrücklich bestätigt – nur zusammen mit `allowPrivate` und einem privaten Ziel wirksam */
  plainConfirmed: boolean;
  limits: MailLimits;
};

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  user: "",
  fromAddress: "",
  fromName: "",
  replyTo: "",
  allowPrivate: false,
  plainConfirmed: false,
  limits: DEFAULT_MAIL_LIMITS,
};

const KEYS = ["enabled", "host", "port", "security", "user", "fromAddress", "fromName", "replyTo", "allowPrivate", "plainConfirmed", "limitHour", "limitDay", "limitUserHour", "limitUserDay"] as const;
const key = (name: (typeof KEYS)[number]) => `mail.${name}`;

const limit = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && Number.isInteger(n) && n >= 0 && n <= MAX_MAIL_LIMIT ? n : fallback;
};

/** Liest die Einstellungen. In einer Operation den Client der Transaktion übergeben (SQLite hat nur einen Schreiber). */
export async function getMailSettings(client: Reader = db): Promise<MailSettings> {
  const rows = await client.appSetting.findMany({ where: { key: { in: KEYS.map(key) } } });
  const v = new Map(rows.map((row) => [row.key, row.value]));
  const get = (name: (typeof KEYS)[number]) => v.get(key(name));
  const security = get("security");
  const port = Number(get("port"));
  return {
    enabled: get("enabled") === "true",
    host: get("host") ?? "",
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_MAIL_SETTINGS.port,
    security: (MAIL_SECURITY as readonly string[]).includes(security ?? "") ? (security as MailSecurity) : DEFAULT_MAIL_SETTINGS.security,
    user: get("user") ?? "",
    fromAddress: get("fromAddress") ?? "",
    fromName: get("fromName") ?? "",
    replyTo: get("replyTo") ?? "",
    allowPrivate: get("allowPrivate") === "true",
    plainConfirmed: get("plainConfirmed") === "true",
    limits: {
      hour: limit(get("limitHour"), DEFAULT_MAIL_LIMITS.hour),
      day: limit(get("limitDay"), DEFAULT_MAIL_LIMITS.day),
      userHour: limit(get("limitUserHour"), DEFAULT_MAIL_LIMITS.userHour),
      userDay: limit(get("limitUserDay"), DEFAULT_MAIL_LIMITS.userDay),
    },
  };
}

export async function saveMailSettings(settings: MailSettings, tx: Parameters<typeof setSetting>[2]): Promise<void> {
  const values: Record<(typeof KEYS)[number], string> = {
    enabled: String(settings.enabled),
    host: settings.host,
    port: String(settings.port),
    security: settings.security,
    user: settings.user,
    fromAddress: settings.fromAddress,
    fromName: settings.fromName,
    replyTo: settings.replyTo,
    allowPrivate: String(settings.allowPrivate),
    plainConfirmed: String(settings.plainConfirmed),
    limitHour: String(settings.limits.hour),
    limitDay: String(settings.limits.day),
    limitUserHour: String(settings.limits.userHour),
    limitUserDay: String(settings.limits.userDay),
  };
  for (const name of KEYS) await setSetting(key(name), values[name], tx);
}

export async function setMailPassword(password: string | null, tx: Parameters<typeof setSecret>[2]): Promise<void> {
  await setSecret(MAIL_PASSWORD_SECRET, password, tx);
}

export const getMailPassword = (): Promise<string | null> => getSecret(MAIL_PASSWORD_SECRET);

/** Ist der Versand eingerichtet und eingeschaltet? Verbindungsdaten und gültige Absenderadresse vorhanden; ohne Verschlüsselung nur mit bestätigter Freigabe. */
export function isMailConfigured(settings: MailSettings): boolean {
  return settings.enabled && settings.host.trim() !== "" && normalizeMailAddress(settings.fromAddress) !== null && (settings.security !== "none" || (settings.plainConfirmed && settings.allowPrivate));
}

/**
 * Darf die Oberfläche „Per E-Mail senden“ anbieten? Nur wenn der Versand eingerichtet und eingeschaltet ist (**das Mail-Feature erscheint in der UI nur dann**). In einer Operation den Client der Transaktion
 * übergeben.
 */
export async function mailConfigured(client: Reader = db): Promise<boolean> {
  return isMailConfigured(await getMailSettings(client));
}
