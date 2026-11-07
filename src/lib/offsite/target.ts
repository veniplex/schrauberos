/**
 * Ziel des Off-Site-Backups (SFTP oder WebDAV) – reine Prüf- und Planungslogik ohne Netzwerk, Datei- und Datenbankzugriff.
 */
import { canonicalHost, isForbiddenHost, isLoopbackHost, offsiteNetwork } from "./host-policy";

export const OFFSITE_PROTOCOLS = ["sftp", "webdav"] as const;
export type OffsiteProtocol = (typeof OFFSITE_PROTOCOLS)[number];

/** Welche Arten lokaler Backups zum Ziel gehen (Sicherungen vor Update/Wiederherstellung/Migration und Hochgeladenes bleiben lokal). */
export const OFFSITE_KINDS = ["auto", "manual"] as const;

export const OFFSITE_KEEP_DEFAULT = 14;
export const OFFSITE_KEEP_MAX = 365;

/** Dateiname einer Sicherung am Ziel: eigener Präfix und eigene Endung – nur solche Dateien werden je gelöscht. */
export const OFFSITE_NAME = /^schrauberos-\d{8}T\d{6}Z-(auto|manual|pre-update|pre-restore|pre-migration|upload)\.sobk$/;
/** Unfertige Übertragung (wird nach dem Hochladen umbenannt) */
export const OFFSITE_PART = /^schrauberos-\d{8}T\d{6}Z-(auto|manual|pre-update|pre-restore|pre-migration|upload)\.sobk\.part$/;

export const offsiteFileName = (backupName: string): string => `${backupName}.sobk`;
/** Name der lokalen Sicherung zu einer Datei am Ziel (`schrauberos-…-auto.sobk` → `schrauberos-…-auto`) */
export const backupNameOf = (remote: string): string => remote.replace(/\.sobk$/, "");

/** Fingerabdruck eines SSH-Hostschlüssels im OpenSSH-Format: `SHA256:` + 43 Zeichen Base64 ohne Füllzeichen. */
export const HOST_KEY_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

/** Hexadezimaler SHA-256-Wert → `SHA256:<Base64 ohne Füllzeichen>` (wie `ssh-keygen -l`). */
export const fingerprintFromHex = (hex: string): string => `SHA256:${Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "")}`;

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

// Welche Adressen erlaubt sind (Richtlinie, kanonische Schreibweise, IPv4-in-IPv6 …), steht in `host-policy.ts`
export { isForbiddenHost, isLoopbackHost };

export type TargetProblem = "host" | "port" | "path" | "url" | "scheme" | "credentialsInUrl" | "forbiddenHost" | "hostKey";

/** Ein Host (Name oder Adresse in beliebiger Schreibweise) für SFTP: gültig und nicht verboten. Ohne Namensauflösung – die geschieht beim Verbinden (`resolvePinned`). */
export function validateHost(host: string): TargetProblem | null {
  const canonical = canonicalHost(host);
  if (!canonical) return "host";
  if (canonical.kind === "name" && !HOSTNAME.test(canonical.name)) return "host";
  return isForbiddenHost(host) ? "forbiddenHost" : null;
}

export const validatePort = (port: number): TargetProblem | null => (Number.isInteger(port) && port >= 1 && port <= 65535 ? null : "port");

/** Verzeichnis am Ziel: nicht leer, ohne Steuerzeichen und ohne `..`. Schrägstriche am Rand sind egal. */
export function normalizeRemotePath(input: string): string | null {
  const path = input.trim().replace(/\\/g, "/");
  if (!path || /[\x00-\x1f\x7f]/.test(path) || path.length > 300) return null;
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) return null;
  const absolute = path.startsWith("/");
  return (absolute ? "/" : "") + parts.join("/") || (absolute ? "/" : null);
}

/**
 * WebDAV-Adresse: **nur HTTPS** (Klartext-HTTP nur für den eigenen Rechner in Tests), ohne Zugangsdaten, Abfrage und Anker in der Adresse, kein Metadaten-/Verbindungs-lokal-Ziel.
 * Gibt die bereinigte Adresse (ohne abschließenden Schrägstrich) zurück.
 */
export function normalizeWebdavUrl(input: string): { ok: true; url: string } | { ok: false; problem: TargetProblem } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, problem: "url" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && offsiteNetwork.allowLoopback && isLoopbackHost(url.hostname))) return { ok: false, problem: "scheme" };
  if (url.username || url.password) return { ok: false, problem: "credentialsInUrl" };
  if (url.search || url.hash) return { ok: false, problem: "url" };
  if (isForbiddenHost(url.hostname)) return { ok: false, problem: "forbiddenHost" };
  return { ok: true, url: url.href.replace(/\/+$/, "") };
}

export type RemoteEntry = { name: string; size: number; modifiedAt: Date | null };

/**
 * Was ist hochzuladen? Von den lokalen Backups der Arten `OFFSITE_KINDS` die neuesten `keep` (neueste zuerst), soweit sie am Ziel noch fehlen. `have` sind die Namen
 * der Backups, die schon am Ziel liegen (aus der Auflistung des Ziels bzw. dem Merker des letzten Laufs).
 */
export function planUploads(local: ReadonlyArray<{ name: string; kind: string; createdAt: Date }>, have: ReadonlySet<string>, keep: number): string[] {
  return local
    .filter((b) => (OFFSITE_KINDS as readonly string[]).includes(b.kind))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, keep)
    .map((b) => b.name)
    .filter((name) => !have.has(name));
}

/**
 * Was ist am Ziel zu löschen? Nur **eigene** Sicherungsdateien (Muster `OFFSITE_NAME`) jenseits der neuesten `keep`; fremde Dateien bleiben unberührt. Unfertige Übertragungen
 * (`.part`), die älter als einen Tag sind, werden mit aufgeräumt.
 */
export function planDeletions(remote: readonly RemoteEntry[], keep: number, now: Date): string[] {
  const own = remote.filter((e) => OFFSITE_NAME.test(e.name)).sort((a, b) => (a.name < b.name ? 1 : -1)); // der Zeitstempel im Namen sortiert nach Alter
  const stale = remote.filter((e) => OFFSITE_PART.test(e.name) && e.modifiedAt && now.getTime() - e.modifiedAt.getTime() > 86_400_000);
  return [...own.slice(keep), ...stale].map((e) => e.name);
}
