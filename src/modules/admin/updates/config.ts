import "server-only";
import path from "node:path";
import { readMeta, versionsDir } from "@/lib/updates/store";
import type { VersionMeta } from "@/lib/updates/state";
import { GITHUB_ASSET_HOSTS, type FetchPolicy } from "@/lib/updates/safe-fetch";
import { getSecret } from "@/server/settings";
import { RELEASE_PUBLIC_KEY, ROOT_PUBLIC_KEY } from "./release-key";

export const UPDATE_TOKEN_KEY = "update.token";

/**
 * Vertrauensanker der App: **nur** aus dem Build (`release-key.ts`) – keine Umgebungsvariable überschreibt sie. Der Starter im Image trägt dieselben Schlüssel
 * (`scripts/gen-trust-header.mjs` erzeugt seinen Header aus derselben Datei); zwei Quellen könnten auseinanderlaufen, und eine Umgebungsvariable wäre ein
 * Schalter, mit dem sich die Prüfung aushebeln ließe (Betriebskonzept: kein Umgebungsschalter „unsigniert erlauben“). Forks tragen ihre Schlüssel in `release-key.ts` ein.
 * Nur Tests ersetzen sie über `setTrustAnchorsForTest` (im Betrieb, `NODE_ENV=production`, wirft das).
 */
let testAnchors: { builtInKey: string; rootKey: string } | null = null;
export function setTrustAnchorsForTest(anchors: { builtInKey: string; rootKey: string } | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("Die Vertrauensanker lassen sich im Betrieb nicht ersetzen.");
  testAnchors = anchors;
}

const updateApiUrl = () => (process.env.UPDATE_API_URL ?? "https://api.github.com").replace(/\/$/, "");

/**
 * Token aus den Einstellungen (verschlüsselt in der Datenbank). Es gibt bewusst **keine** Umgebungsvariable dafür (früher `UPDATE_GITHUB_TOKEN`, Z6-2 N9): Betriebsaufgaben laufen über die Weboberfläche
 * (Betriebskonzept), und ein Token in der Umgebung läge im Klartext in `docker inspect` und in Compose-Dateien.
 */
export async function updateConfig() {
  const repo = process.env.UPDATE_REPO ?? "veniplex/schrauberos";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("UPDATE_REPO muss die Form <besitzer>/<repo> haben.");
  return {
    repo,
    token: (await getSecret(UPDATE_TOKEN_KEY)) || null,
    // Nur für Tests/Spiegel: Basis-URL der GitHub-API
    apiUrl: updateApiUrl(),
    /** Eingebauter Release-Schlüssel und Wurzelschlüssel der Schlüsselkette (nur aus dem Build, siehe release-key.ts) */
    builtInKey: testAnchors?.builtInKey ?? RELEASE_PUBLIC_KEY,
    rootKey: testAnchors?.rootKey ?? ROOT_PUBLIC_KEY,
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
