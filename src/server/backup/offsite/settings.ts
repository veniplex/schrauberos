import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { OFFSITE_KEEP_DEFAULT, OFFSITE_PROTOCOLS, type OffsiteProtocol } from "@/lib/offsite/target";
import { getSecret, getSetting, setSecret, setSetting } from "@/server/settings";

/**
 * Einstellungen des Off-Site-Backups (Tabelle `AppSetting`; die Zugangsdaten sind ein Geheimnis und liegen verschlüsselt darin, siehe `getSecret/setSecret`).
 * Der Hostschlüssel-Fingerabdruck (SFTP) ist fest hinterlegt: Er ändert sich nur, wenn ein Administrator ihn ausdrücklich neu abruft und bestätigt.
 */
type Writer = Pick<PrismaClient | Prisma.TransactionClient, "appSetting">;

export type OffsiteSettings = {
  enabled: boolean;
  protocol: OffsiteProtocol;
  /** SFTP */
  host: string;
  port: number;
  /** SFTP: Verzeichnis am Ziel; WebDAV: nicht benutzt (die Adresse nennt es) */
  path: string;
  /** WebDAV: Adresse des Verzeichnisses (HTTPS) */
  url: string;
  username: string;
  /** SFTP: bestätigter Fingerabdruck des Hostschlüssels (`SHA256:…`) */
  hostKey: string;
  /** Wie viele der neuesten Sicherungen am Ziel bleiben */
  keep: number;
};

export type OffsiteCredentials = { password?: string; privateKey?: string; passphrase?: string };

export const OFFSITE_DEFAULTS: OffsiteSettings = { enabled: false, protocol: "sftp", host: "", port: 22, path: "", url: "", username: "", hostKey: "", keep: OFFSITE_KEEP_DEFAULT };

/** Geheimnisse (verschlüsselt in `AppSetting`) */
export const OFFSITE_CREDENTIALS_SECRET = "offsite.credentials";
const UPLOADED = "offsite.uploaded";

const key = (name: keyof OffsiteSettings) => `offsite.${name}`;

export async function getOffsiteSettings(): Promise<OffsiteSettings> {
  const [enabled, protocol, host, port, path, url, username, hostKey, keep] = await Promise.all(
    (["enabled", "protocol", "host", "port", "path", "url", "username", "hostKey", "keep"] as const).map((name) => getSetting(key(name))),
  );
  const portNumber = Number.parseInt(port ?? "", 10);
  const keepNumber = Number.parseInt(keep ?? "", 10);
  return {
    enabled: enabled === "true",
    protocol: (OFFSITE_PROTOCOLS as readonly string[]).includes(protocol ?? "") ? (protocol as OffsiteProtocol) : OFFSITE_DEFAULTS.protocol,
    host: host ?? "",
    port: Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536 ? portNumber : OFFSITE_DEFAULTS.port,
    path: path ?? "",
    url: url ?? "",
    username: username ?? "",
    hostKey: hostKey ?? "",
    keep: Number.isInteger(keepNumber) && keepNumber > 0 ? keepNumber : OFFSITE_DEFAULTS.keep,
  };
}

export async function saveOffsiteSettings(settings: OffsiteSettings, client?: Writer): Promise<void> {
  for (const name of Object.keys(OFFSITE_DEFAULTS) as Array<keyof OffsiteSettings>) await setSetting(key(name), String(settings[name]), client);
}

/** Zugangsdaten (Passwort, privater Schlüssel, Passphrase); null, wenn keine hinterlegt oder nicht lesbar sind. */
export async function getOffsiteCredentials(): Promise<OffsiteCredentials | null> {
  const raw = await getSecret(OFFSITE_CREDENTIALS_SECRET);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as OffsiteCredentials;
    return {
      ...(typeof value.password === "string" && value.password ? { password: value.password } : {}),
      ...(typeof value.privateKey === "string" && value.privateKey ? { privateKey: value.privateKey } : {}),
      ...(typeof value.passphrase === "string" && value.passphrase ? { passphrase: value.passphrase } : {}),
    };
  } catch {
    return null;
  }
}

export const saveOffsiteCredentials = (credentials: OffsiteCredentials | null, client?: Writer): Promise<void> =>
  setSecret(OFFSITE_CREDENTIALS_SECRET, credentials ? JSON.stringify(credentials) : null, client);

export async function hasOffsiteCredentials(): Promise<boolean> {
  const credentials = await getOffsiteCredentials();
  return !!credentials && !!(credentials.password || credentials.privateKey);
}

/** Merker: Namen der Backups, die zuletzt am Ziel lagen (spart die Auflistung des Ziels bei jedem Takt des Jobs). */
export async function getUploadedNames(): Promise<Set<string>> {
  try {
    const value = JSON.parse((await getSetting(UPLOADED)) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

export const saveUploadedNames = (names: ReadonlySet<string>, client?: Writer): Promise<void> => setSetting(UPLOADED, JSON.stringify([...names].sort()), client);

/** Das Ziel ist vollständig eingerichtet (Verbindungsdaten, bei SFTP der Hostschlüssel)? */
export function isConfigured(settings: OffsiteSettings): boolean {
  if (!settings.username) return false;
  return settings.protocol === "sftp" ? !!settings.host && !!settings.path && !!settings.hostKey : !!settings.url;
}
