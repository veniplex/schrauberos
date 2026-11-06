import "server-only";
import path from "node:path";
import { readMeta, versionsDir } from "@/lib/updates/store";
import type { VersionMeta } from "@/lib/updates/state";
import { getSecret } from "@/server/settings";
import { RELEASE_PUBLIC_KEY, ROOT_PUBLIC_KEY } from "./release-key";

export const UPDATE_TOKEN_KEY = "update.token";

/** Token aus den Einstellungen (verschlüsselt in der Datenbank); UPDATE_GITHUB_TOKEN bleibt als Rückfall nutzbar. */
export async function updateConfig() {
  const repo = process.env.UPDATE_REPO ?? "veniplex/schrauberos";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("UPDATE_REPO muss die Form <besitzer>/<repo> haben.");
  return {
    repo,
    token: (await getSecret(UPDATE_TOKEN_KEY)) || process.env.UPDATE_GITHUB_TOKEN || null,
    // Nur für Tests/Spiegel: Basis-URL der GitHub-API
    apiUrl: (process.env.UPDATE_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
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
