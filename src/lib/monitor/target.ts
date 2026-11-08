import { canonicalHost, isForbiddenHost } from "@/lib/offsite/host-policy";
import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, MONITOR_KINDS, MONITOR_METHODS, type MonitorKind, type MonitorMethod } from "./model";

/**
 * Prüfung und Vereinheitlichung der Eingabe eines Überwachungsziels (rein, ohne Netzwerk). Dieselbe Prüfung gilt beim Speichern und – gegen eine veränderte Datenbank – noch einmal
 * beim Prüfen (`server/monitor/resolve.ts`). Festgelegt (Tests in `target.test.ts`):
 *  - **Host** nur als Name oder Adresse in einfacher Schreibweise (Buchstaben, Ziffern, `.`, `-`, `_`, IPv6 mit `:`): kein `@`, `/`, `?`, `#`, kein Leerraum; jede Schreibweise einer Adresse
 *    (Dezimal, Hex, Oktal, IPv4-in-IPv6) wird vereinheitlicht und wie die kanonische Adresse bewertet. **Verboten** (auch für Administratoren): der eigene Rechner (Loopback, eigene
 *    Schnittstellen, im Container das Host-Gateway und `host.docker.internal`), „dieses Netz“, Link-Local samt Metadaten-Diensten, Multicast und Reserviertes. **Erlaubt**: private Netze (RFC 1918, ULA) – das interne Netz ist gerade das Ziel.
 *  - **Port** 1–65535; bei HTTP(S) Standard 80/443.
 *  - **Pfad** nur bei HTTP(S): beginnt mit `/`, höchstens 300 Zeichen, ohne Leerraum und Steuerzeichen, kann den Host nicht wechseln (`//host`); **keine Zugangsdaten** in der Adresse (`user:pass@`).
 *    Der Benutzer setzt keine Kopfzeilen – die Anfrage trägt nur `Host`, einen festen `User-Agent`, `Accept` und `Connection: close` (vier Kopfzeilen).
 *  - Eine eingefügte Adresse (`https://host:8443/pfad`) wird in Art, Host, Port und Pfad zerlegt.
 */
export type TargetInput = { kind: string; host: string; port?: number | null; path?: string | null; method?: string | null; intervalSec?: number | null };
export type NormalizedTarget = { kind: MonitorKind; host: string; port: number; path: string | null; method: MonitorMethod; intervalSec: number };
export type TargetProblem = { field: "kind" | "host" | "port" | "path" | "method" | "intervalSec"; key: "invalid" | "forbiddenHost" | "credentials" | "port" | "path" | "interval" };

/** Ist dieser Host (ohne Namensauflösung) als Ziel der Überwachung verboten? Die allgemeine Zielsperre (`isForbiddenHost`, samt den Namen des Docker-Hosts); die Adresse dahinter sperrt `server/host-gateway.ts`. */
export const isForbiddenMonitorHost = isForbiddenHost;

const HOST_CHARS = /^[A-Za-z0-9._:[\]-]+$/;
const DEFAULT_PORT: Record<MonitorKind, number | null> = { tcp: null, http: 80, https: 443 };
const PLACEHOLDER = "placeholder.invalid";

export function normalizeTarget(input: TargetInput): { ok: true; value: NormalizedTarget } | { ok: false; problem: TargetProblem } {
  const bad = (field: TargetProblem["field"], key: TargetProblem["key"]) => ({ ok: false as const, problem: { field, key } });
  let kind = input.kind as MonitorKind;
  let host = (input.host ?? "").trim();
  let port: number | null | undefined = input.port;
  let rawPath = input.path?.trim() || null;

  // Eine eingefügte Adresse zerlegen (nur http und https; Zugangsdaten sind nie erlaubt)
  if (host.includes("://")) {
    let url: URL;
    try {
      url = new URL(host);
    } catch {
      return bad("host", "invalid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return bad("host", "invalid");
    if (url.username || url.password) return bad("host", "credentials");
    kind = url.protocol === "https:" ? "https" : "http";
    host = url.hostname;
    if (url.port) port = Number(url.port);
    rawPath = `${url.pathname}${url.search}`;
  }
  if (!MONITOR_KINDS.includes(kind)) return bad("kind", "invalid");
  if (host.includes("@")) return bad("host", "credentials");
  if (!host || host.length > 253 || !HOST_CHARS.test(host)) return bad("host", "invalid");
  const canonical = canonicalHost(host);
  if (!canonical) return bad("host", "invalid");
  if (isForbiddenMonitorHost(host)) return bad("host", "forbiddenHost");

  const resolvedPort = port === undefined || port === null ? DEFAULT_PORT[kind] : port;
  if (resolvedPort === null || !Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65_535) return bad("port", "port");

  let path: string | null = null;
  if (kind !== "tcp") {
    const wanted = rawPath ?? "/";
    if (wanted.length > 300 || !wanted.startsWith("/") || /[\u0000- \u007f-\u009f#\\]/.test(wanted)) return bad("path", "path");
    let url: URL;
    try {
      url = new URL(wanted, `http://${PLACEHOLDER}`);
    } catch {
      return bad("path", "path");
    }
    if (url.hostname !== PLACEHOLDER || url.username || url.password) return bad("path", "path");
    path = `${url.pathname}${url.search}`;
    if (!/^\/[\x21-\x7e]*$/.test(path) || path.length > 600) return bad("path", "path");
  }

  const method = (input.method ?? "HEAD") as MonitorMethod;
  if (!MONITOR_METHODS.includes(method)) return bad("method", "invalid");
  const intervalSec = input.intervalSec ?? 300;
  if (!Number.isInteger(intervalSec) || intervalSec < MIN_INTERVAL_SECONDS || intervalSec > MAX_INTERVAL_SECONDS) return bad("intervalSec", "interval");

  return { ok: true, value: { kind, host: canonical.kind === "ip" ? normalizeIp(canonical.ip) : canonical.name, port: resolvedPort, path, method: kind === "tcp" ? "HEAD" : method, intervalSec } };
}

/** IPv6 in der kanonischen Kleinschreibweise der URL-Klasse (`FD12::1` → `fd12::1`); IPv4 bleibt, wie sie ist. */
function normalizeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return ip.toLowerCase();
  }
}

/** Schlüssel zum Erkennen doppelter Ziele (gleiche Art, gleicher Host, Port und Pfad) */
export const targetKey = (t: { kind: string; host: string; port: number; path: string | null }): string => `${t.kind}|${t.host.toLowerCase()}|${t.port}|${t.path ?? ""}`;

/** Wert für die `Host`-Kopfzeile: IPv6 in Klammern, Port nur wenn er vom Standard abweicht */
export function hostHeader(kind: MonitorKind, host: string, port: number): string {
  const bare = host.includes(":") ? `[${host}]` : host;
  return port === DEFAULT_PORT[kind] ? bare : `${bare}:${port}`;
}

/** Lesbare Zieladresse für die Oberfläche (nur für Personen mit dem Recht, Ziele zu verwalten): `tcp://host:22`, `https://host/pfad` */
export function targetLabel(t: { kind: string; host: string; port: number; path: string | null }): string {
  const bare = t.host.includes(":") ? `[${t.host}]` : t.host;
  const kind = t.kind as MonitorKind;
  if (kind === "tcp") return `tcp://${bare}:${t.port}`;
  return `${kind}://${hostHeader(kind, t.host, t.port)}${t.path ?? "/"}`;
}
