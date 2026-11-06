/**
 * Content-Security-Policy – Grundlage (P1a-7). Sie wird **erzwungen** (kein Report-Only) und gilt für jede Antwort, auch für Statik und den
 * Service Worker: Die Header kommen aus `next.config.ts` (`headers()`), nicht aus der Nonce-Logik des Proxys.
 *
 * Bewusst noch ohne Nonce: `script-src` erlaubt `'unsafe-inline'`, weil Next.js seine Start-Skripte inline einbettet; ein Nonce
 * (`'nonce-…' 'strict-dynamic'`, vom Proxy je Anfrage erzeugt) gehört zu P1b-1 und braucht den Browsertest über jede Route der Inventur. Alles andere
 * ist schon streng: nur die eigene Herkunft für Skripte, Verbindungen, Frames, Worker und Manifest, keine Plugins (`object-src 'none'`), kein
 * `<base>`, Formulare nur an die eigene Herkunft, Einbetten nur durch die eigene Herkunft (PDF-Vorschau). Kein `upgrade-insecure-requests`
 * (die App läuft im LAN auch über HTTP).
 *
 * In der Entwicklung braucht React `eval` (Fehlerstapel) und der Entwicklungsserver einen WebSocket – nur dort kommen sie hinzu.
 */
export function contentSecurityPolicy(options: { dev: boolean }): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(options.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
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
