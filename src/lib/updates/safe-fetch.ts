/**
 * Abruf von GitHub für Updates – mit dem Update-Token (`Authorization`) nur an den erwarteten Host und mit überwachten Weiterleitungen.
 *
 * Hintergrund: Der Download eines Release-Pakets geht an die API (`api.github.com/repos/…/releases/assets/<id>`), und GitHub antwortet darauf mit einer Weiterleitung auf
 * einen Content-Server (`release-assets.githubusercontent.com`, früher `objects.githubusercontent.com`). Ein Token, das dorthin (oder an einen beliebigen anderen
 * Host) mitgeschickt wird, wäre verraten. Deshalb:
 *  - die Anfrage geht nur an die **API-Herkunft** (Schema + Host + Port der konfigurierten API-Adresse); jede andere Adresse wird gar nicht erst angefragt,
 *  - Weiterleitungen werden **von Hand** verfolgt (höchstens 5), nur auf **HTTPS** und nur auf Hosts aus der **Allowlist** der GitHub-Content-Server,
 *  - der `Authorization`-Kopf geht **nie** an ein Weiterleitungsziel. Einzige Ausnahme, nur auf Wunsch (`sameOriginRedirectKeepsAuth`, für die Metadaten-Abfragen
 *    der API, z. B. nach Umbenennen eines Repositories): ein Ziel auf derselben Herkunft wie die API.
 * Die Content-Server prüfen ihre Berechtigung über die signierte Adresse selbst und brauchen das Token nicht.
 */

/**
 * Hosts, auf die der Asset-Download weitergeleitet werden darf. Quelle: Antwort von `api.github.com` auf einen Asset-Abruf (302 auf
 * `release-assets.githubusercontent.com`) und die Liste `domains.actions` der GitHub-Meta-API (`GET https://api.github.com/meta`) mit den Content-Servern für Releases.
 */
export const GITHUB_ASSET_HOSTS: readonly string[] = ["release-assets.githubusercontent.com", "objects.githubusercontent.com", "objects-origin.githubusercontent.com", "github-releases.githubusercontent.com"];

export type FetchPolicyErrorCode = "untrustedHost" | "badRedirect" | "tooManyRedirects";

export class FetchPolicyError extends Error {
  constructor(
    readonly code: FetchPolicyErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export type FetchPolicy = {
  /** Herkunft der API, z. B. "https://api.github.com" – nur dorthin geht das Token */
  apiOrigin: string;
  token: string | null;
  /** Hosts (Hostname ohne Port, klein geschrieben), auf die weitergeleitet werden darf */
  redirectHosts: readonly string[];
  /** Weiterleitungsziele müssen HTTPS sein (Standard: ja; nur für Spiegel/Tests im Klartext abschaltbar) */
  requireHttps?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
  /** Ein Ziel auf derselben Herkunft wie die API behält das Token (nur Metadaten-Abfragen) */
  sameOriginRedirectKeepsAuth?: boolean;
  fetchImpl?: typeof fetch;
};

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Ruft `url` ab (GET). `headers` enthalten kein `Authorization` – das setzt diese Funktion, und nur für die API-Herkunft. */
export async function fetchWithPolicy(url: string, headers: Record<string, string>, policy: FetchPolicy): Promise<Response> {
  const doFetch = policy.fetchImpl ?? fetch;
  const maxRedirects = policy.maxRedirects ?? 5;
  const requireHttps = policy.requireHttps ?? true;
  const signal = AbortSignal.timeout(policy.timeoutMs ?? 15 * 60_000);

  let current = new URL(url);
  if (current.origin !== policy.apiOrigin) throw new FetchPolicyError("untrustedHost", current.host);
  let withAuth = !!policy.token;

  for (let hop = 0; ; hop++) {
    const response = await doFetch(current, {
      headers: withAuth ? { ...headers, Authorization: `Bearer ${policy.token}` } : headers,
      redirect: "manual",
      signal,
    });
    if (!REDIRECT_STATUS.has(response.status)) return response;

    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get("location");
    if (!location) throw new FetchPolicyError("badRedirect", "ohne Ziel");
    if (hop >= maxRedirects) throw new FetchPolicyError("tooManyRedirects");
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new FetchPolicyError("badRedirect", "ungültiges Ziel");
    }
    if (next.username || next.password) throw new FetchPolicyError("badRedirect", "Zugangsdaten im Ziel");
    const sameOrigin = next.origin === policy.apiOrigin;
    if (requireHttps && next.protocol !== "https:") throw new FetchPolicyError("badRedirect", "kein HTTPS");
    if (!requireHttps && next.protocol !== "https:" && next.protocol !== "http:") throw new FetchPolicyError("badRedirect", next.protocol);
    if (!sameOrigin && !policy.redirectHosts.includes(next.hostname.toLowerCase())) throw new FetchPolicyError("untrustedHost", next.host);
    // Das Token bleibt nur, wenn es erlaubt ist, das Ziel dieselbe Herkunft wie die API hat und die Anfrage bisher eines trug
    withAuth = withAuth && sameOrigin && !!policy.sameOriginRedirectKeepsAuth;
    current = next;
  }
}
