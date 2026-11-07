/**
 * Content-Security-Policy (P1b-1) – ohne Abhängigkeiten, damit Proxy, `next.config.ts`, Dateirouten und Tests dieselben Werte nutzen.
 *
 * **Wer setzt welchen Header?** Genau eine Stelle je Antwort – zwei CSP-Köpfe würden sich im Browser überlagern (die strengere gewinnt) und Next
 * verwirft den Kopf einer Route still, wenn der Server den Namen schon gesetzt hat (`sendResponse` hängt Kopfzeilen nur an, wenn sie fehlen):
 *   - **Seiten, Server Actions, JSON-Routen** (alles, was durch `src/proxy.ts` läuft): der Proxy, je Anfrage mit eigenem Nonce.
 *   - **Dateirouten** (Rechnungsbeleg, Doku-Bilder, Logo; `ROUTE_OWNED_PATHS`): die Route selbst (`lib/file-delivery.ts`: Bilder `sandbox; default-src 'none'`, PDF nur
 *     `frame-ancestors 'self'`). Der Proxy fasst den Kopf dort nicht an, `next.config` auch nicht.
 *   - **Alles außerhalb des Proxys** (Statik, Icons, Manifest, Service Worker, Health, Backup-Upload): `next.config.ts` mit der Richtlinie ohne Nonce (`script-src 'self'`).
 *   Dass sich die Zuständigkeiten nicht überschneiden, prüft `csp.test.ts` gegen den Matcher des Proxys und die Regeln der Konfiguration.
 *
 * **Skripte:** `'nonce-…' 'strict-dynamic'` – nur Skripte mit dem Nonce der Anfrage laufen (Next trägt ihn aus dem Kopf der Anfrage in alle eigenen Skripte ein) und
 * was diese nachladen; `'self'` steht nur als Rückfall für Browser ohne `strict-dynamic`. Kein `'unsafe-inline'`, im Betrieb kein `'unsafe-eval'`.
 * **Stile:** `style-src` mit Nonce für `<style>`-Elemente; **`style-src-attr 'unsafe-inline'` ist bewusst erlaubt** – React schreibt `style="…"` in das HTML (Kalender,
 * Layout-Variablen wie `--workshop-accent`); das ergibt keine Skriptausführung, und Daten lassen sich über CSS nicht nach außen tragen, weil `img-src`, `font-src` und
 * `connect-src` bei `'self'` bleiben.
 *
 * Kein `upgrade-insecure-requests` (die App läuft im LAN auch über HTTP). In der Entwicklung braucht React `eval` (Fehlerstapel) und der Entwicklungsserver einen
 * WebSocket – nur dort kommen sie hinzu.
 */

/** Zustand der Richtlinie: erzwungen oder (Notschalter in den Einstellungen) nur gemeldet. */
export type CspMode = "enforce" | "report-only";
export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const cspHeaderName = (mode: CspMode) => (mode === "report-only" ? CSP_REPORT_ONLY_HEADER : CSP_HEADER);

/** Zufälliger Nonce je Anfrage: 128 Bit, Base64 (passt in das Muster, das Next aus dem Kopf liest). */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function contentSecurityPolicy(options: { dev: boolean; nonce?: string }): string {
  const nonce = options.nonce ? [`'nonce-${options.nonce}'`] : [];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...nonce, ...(options.nonce ? ["'strict-dynamic'"] : []), ...(options.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", ...nonce]],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(options.dev ? ["ws:", "wss:"] : [])]],
    ["frame-src", ["'self'"]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** JSON-/Feed-Antworten (`/api/v1`, `/api/ical`): nichts darf geladen, nichts eingebettet werden. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** PDF-Antworten (Beleg-Vorschau im `<iframe>` derselben Herkunft): nur das Einbetten regeln, **kein** `sandbox` und kein `object-src 'none'` (der PDF-Betrachter des Browsers würde sonst nicht anzeigen). */
export const PDF_CONTENT_SECURITY_POLICY = "frame-ancestors 'self'";

/** Bilder und alles andere, was nie ausgeführt werden soll: selbst bei direktem Aufruf läuft nichts. */
export const SANDBOX_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'";

/**
 * Kamera nur für die eigene Herkunft (Foto aufnehmen), alles andere gesperrt, was die App nicht braucht. Kein pauschales `camera=()`.
 */
export const PERMISSIONS_POLICY = "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()";

/** HSTS nur bei erkanntem HTTPS (sonst sperrt man sich im LAN über HTTP aus): ein halbes Jahr, ohne Unterdomänen und ohne Preload. */
export const HSTS_VALUE = "max-age=15552000";

/** Pfade, deren Antwort den CSP-Kopf selbst setzt (Dateirouten, `lib/file-delivery.ts`). Der Proxy lässt sie unangetastet. */
export const ROUTE_OWNED_PATHS: readonly RegExp[] = [/^\/api\/invoices\/[^/]+\/file$/, /^\/api\/docs\/images\/[^/]+$/, /^\/api\/logo$/, /^\/api\/orders\/approvals\/[^/]+\/signature$/];

export type CspKind = "page" | "api" | "route";

/** Welche Richtlinie gilt für diesen Pfad? `route`: die Route setzt sie selbst. */
export function cspKind(pathname: string): CspKind {
  if (ROUTE_OWNED_PATHS.some((p) => p.test(pathname))) return "route";
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/") || pathname === "/api/ical" || pathname.startsWith("/api/ical/")) return "api";
  return "page";
}

export type RequestPolicy = { kind: "page" | "api"; nonce: string; headerName: string; value: string } | null;

/** Richtlinie für eine Anfrage durch den Proxy; `null` für Dateirouten (die Route entscheidet). Der Nonce wird auch für die API erzeugt (kostet nichts, Next liest ihn nur bei Seiten). */
export function requestPolicy(pathname: string, options: { dev: boolean; mode: CspMode; nonce?: string }): RequestPolicy {
  const kind = cspKind(pathname);
  if (kind === "route") return null;
  const nonce = options.nonce ?? createNonce();
  return {
    kind,
    nonce,
    headerName: cspHeaderName(options.mode),
    value: kind === "api" ? API_CONTENT_SECURITY_POLICY : contentSecurityPolicy({ dev: options.dev, nonce }),
  };
}
