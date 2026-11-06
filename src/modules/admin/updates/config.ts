import "server-only";
import path from "node:path";
import { readMeta, versionsDir } from "@/lib/updates/store";
import type { VersionMeta } from "@/lib/updates/state";
import { GITHUB_ASSET_HOSTS, type FetchPolicy } from "@/lib/updates/safe-fetch";
import { getSecret } from "@/server/settings";
import { RELEASE_PUBLIC_KEY, ROOT_PUBLIC_KEY } from "./release-key";

export const UPDATE_TOKEN_KEY = "update.token";

const updateApiUrl = () => (process.env.UPDATE_API_URL ?? "https://api.github.com").replace(/\/$/, "");

/** Token aus den Einstellungen (verschlüsselt in der Datenbank); UPDATE_GITHUB_TOKEN bleibt als Rückfall nutzbar. */
export async function updateConfig() {
  const repo = process.env.UPDATE_REPO ?? "veniplex/schrauberos";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("UPDATE_REPO muss die Form <besitzer>/<repo> haben.");
  return {
    repo,
    token: (await getSecret(UPDATE_TOKEN_KEY)) || process.env.UPDATE_GITHUB_TOKEN || null,
    // Nur für Tests/Spiegel: Basis-URL der GitHub-API
    apiUrl: updateApiUrl(),
    /** Eingebauter Release-Schlüssel und Wurzelschlüssel der Schlüsselkette (Forks: Umgebungsvariablen, siehe release-key.ts) */
    builtInKey: process.env.UPDATE_PUBLIC_KEY || RELEASE_PUBLIC_KEY,
    rootKey: process.env.UPDATE_ROOT_PUBLIC_KEY || process.env.UPDATE_PUBLIC_KEY || ROOT_PUBLIC_KEY,
  };
}

/** Web-Updates gibt es nur, wenn der Launcher die App startet (Docker). Ohne ihn fehlt der Neustart-Mechanismus. */
export const updaterEnabled = () => process.env.APP_UPDATER === "1";

/** Version des laufenden Codes (version.json im App-Verzeichnis); in der Entwicklung ohne Datei ein Platzhalter. */
export function runningMeta(): VersionMeta {
  return readMeta(process.cwd()) ?? { version: "0.0.0-dev", base: 0 };
}

/** Läuft der Code aus dem Update-Volume (statt aus dem Image)? */
export const runsFromVolume = () => process.cwd().startsWith(path.resolve(versionsDir()) + path.sep);

/**
 * Regeln für Abrufe bei GitHub (siehe `lib/updates/safe-fetch.ts`): Das Token geht nur an die API-Herkunft, Weiterleitungen nur auf HTTPS und die Content-Server von GitHub
 * (`GITHUB_ASSET_HOSTS`; für Spiegel/Tests zusätzlich `UPDATE_REDIRECT_HOSTS`, durch Komma getrennt).
 */
export async function fetchPolicy(overrides: Partial<FetchPolicy> = {}): Promise<FetchPolicy> {
  const { apiUrl, token } = await updateConfig();
  const extra = (process.env.UPDATE_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return {
    apiOrigin: new URL(apiUrl).origin,
    token,
    redirectHosts: [...GITHUB_ASSET_HOSTS, ...extra],
    // eine API im Klartext (nur Spiegel/Tests) leitet auch im Klartext weiter; die echte GitHub-API nie
    requireHttps: new URL(apiUrl).protocol === "https:",
    ...overrides,
  };
}
