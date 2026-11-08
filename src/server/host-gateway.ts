import { existsSync, readFileSync } from "node:fs";
import { addressKey, canonicalHost } from "@/lib/offsite/host-policy";

/**
 * Das **Host-Gateway des Containers** gilt für die Überwachung als „der eigene Rechner“: Im Container ist die Standardroute (`/proc/net/route`) die Brücke zum Docker-Host (`172.17.0.1`, `172.18.0.1` …) –
 * ein Ziel dort wäre ein Dienst auf dem Server selbst (zum Beispiel eine unverschlüsselte Docker-Schnittstelle oder eine Datenbank auf `0.0.0.0`), nicht ein Gerät im Firmennetz. Dieselbe Regel wie für
 * Loopback und die eigenen Schnittstellenadressen (`lib/offsite/host-policy.ts`), **für jede ausgehende Verbindung der Anwendung** (Überwachung, Webhooks, Off-Site-Backup, E-Mail-Versand; Block 13d): Die Freigabe `allowPrivate` der Administration öffnet private Netze, nie den Server selbst.
 *
 * (Ohne `server-only`: auch `server/backup/offsite/resolve.ts` nutzt es, und dessen Test läuft ohne Harness; die Datei liest nur `/proc` und enthält nichts Geheimes.)
 *
 * Gesperrt wird nur **im Container** (Datei `/.dockerenv`, `/run/.containerenv` oder Kubernetes) und nur für **IPv4** – läuft die Anwendung ohne Container, ist die Standardroute der echte Router des
 * Firmennetzes und ein erlaubtes Ziel. Die Namen `host.docker.internal` & Co. sperrt `lib/offsite/host-policy.ts` (`isForbiddenHost`). Das Ergebnis wird kurz zwischengespeichert (die Route ändert sich praktisch nie).
 */
const CACHE_MS = 60_000;

/** Nur für Tests: feste Gateways (im Betrieb wirkungslos – es wirft). */
export const gatewayTestHooks: { gateways?: readonly string[] } = {};
export function setGatewayTestHooks(hooks: { gateways?: readonly string[] }): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("setGatewayTestHooks: nur in Tests");
  gatewayTestHooks.gateways = hooks.gateways;
  cache = null;
}

/** Standard-Gateways aus dem Text von `/proc/net/route` (Spalten `Iface Destination Gateway Flags …`, Adressen als little-endian Hex): Route `0.0.0.0/0` mit gesetztem Gateway-Flag. Rein. */
export function parseDefaultGateways(routeTable: string): string[] {
  const found: string[] = [];
  for (const line of routeTable.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8) continue;
    const [, destination, gateway, flags, , , , mask] = cols;
    if (!/^[0-9A-Fa-f]{8}$/.test(destination) || !/^[0-9A-Fa-f]{8}$/.test(gateway) || !/^[0-9A-Fa-f]{8}$/.test(mask)) continue;
    if (parseInt(destination, 16) !== 0 || parseInt(mask, 16) !== 0) continue;
    if ((parseInt(flags, 16) & 0x2) === 0) continue; // RTF_GATEWAY
    const value = parseInt(gateway, 16);
    if (value === 0) continue;
    found.push([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join("."));
  }
  return [...new Set(found)];
}

const inContainer = (): boolean => existsSync("/.dockerenv") || existsSync("/run/.containerenv") || Boolean(process.env.KUBERNETES_SERVICE_HOST);

let cache: { at: number; gateways: Set<string> } | null = null;

/** Die Adressen (IPv4, kanonisch) des Host-Gateways; leer außerhalb eines Containers und wenn die Routentabelle nicht lesbar ist. */
export function hostGatewayAddresses(): ReadonlySet<string> {
  if (gatewayTestHooks.gateways) return new Set(gatewayTestHooks.gateways);
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.gateways;
  let gateways = new Set<string>();
  try {
    if (inContainer()) gateways = new Set(parseDefaultGateways(readFileSync("/proc/net/route", "utf8")));
  } catch {
    /* ohne Routentabelle bleibt es bei der übrigen Zielsperre */
  }
  cache = { at: now, gateways };
  return gateways;
}

/** Ist diese Adresse (Literal, auch IPv4-in-IPv6) das Host-Gateway des Containers? */
export function isHostGateway(address: string): boolean {
  const gateways = hostGatewayAddresses();
  if (gateways.size === 0) return false;
  const key = addressKey(address.trim().replace(/^\[|\]$/g, ""));
  return key !== null && gateways.has(key);
}

/** Ist dieser Host (Name oder Adresse, ohne Namensauflösung) ein Literal des Host-Gateways? Für Eingabeprüfungen auf dem Server; beim Verbinden prüft `isHostGateway` jede aufgelöste Adresse. */
export function isHostGatewayHost(host: string): boolean {
  const canonical = canonicalHost(host);
  return canonical?.kind === "ip" && isHostGateway(canonical.ip);
}
