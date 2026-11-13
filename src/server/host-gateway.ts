import { existsSync, readFileSync } from "node:fs";
import { addressKey, canonicalHost, isAllowedAddress, isForbiddenHost, isPrivateAddress } from "@/lib/offsite/host-policy";

/**
 * Die **Gateways des Containers** gelten als „der eigene Rechner“ (der Docker-Host): Im Container führt jede Route zum Host über die Brücke (`172.17.0.1`, `172.18.0.1` …) – ein Ziel dort wäre ein Dienst auf dem
 * Server selbst (zum Beispiel eine unverschlüsselte Docker-Schnittstelle oder eine Datenbank auf `0.0.0.0`), nicht ein Gerät im Firmennetz. Dieselbe Regel wie für Loopback und die eigenen Schnittstellenadressen
 * (`lib/offsite/host-policy.ts`), **für jede ausgehende Verbindung der Anwendung** (Überwachung, Webhooks, E-Mail-Versand und Off-Site-Backup; Block 13d): Die Freigabe `allowPrivate` der Administration öffnet
 * private Netze, nie den Server selbst. Off-Site-Ziele haben kein `allowPrivate` (ein NAS im LAN ist dort der Normalfall); der Host bleibt auch dort gesperrt.
 *
 * Gesperrt werden (Z7: nicht nur die Standardroute):
 *  - **alle Gateways aller Routen** aus `/proc/net/route` (IPv4) und `/proc/net/ipv6_route` (IPv6), nicht nur das der Standardroute,
 *  - die **erste Adresse jedes direkt verbundenen IPv4-Netzes** (`x.y.z.1` – so legt Docker die Brücke an): ein Container, der in zwei Netzen hängt (App- und Proxy-Netz), hat nur für eines eine Standardroute, das
 *    Gateway des zweiten steht in keiner Route.
 *
 * Was sich **nicht** erkennen lässt: die LAN-Adresse des Servers selbst (zum Beispiel `192.168.1.10`, auf der auch die Anwendung lauscht) – sie gehört weder dem Container noch einer Route. Bei Webhooks, E-Mail
 * und Überwachung entscheidet darüber die Freigabe privater Netze (`allowPrivate`; die Überwachung hat sie nicht, sie lässt private Ziele zu); die Doku sagt deshalb: Der Docker-Host und die Gateways der
 * Container-Netze sind gesperrt, andere Rechner im LAN sind erreichbar, wenn privat erlaubt.
 *
 * (Ohne `server-only`: auch `server/backup/offsite/resolve.ts` nutzt es, und dessen Test läuft ohne Harness; die Datei liest nur `/proc` und enthält nichts Geheimes.)
 *
 * Gesperrt wird nur **im Container** (Datei `/.dockerenv`, `/run/.containerenv` oder Kubernetes) – läuft die Anwendung ohne Container, ist die Standardroute der echte Router des Firmennetzes und ein erlaubtes
 * Ziel. Die Namen `host.docker.internal` & Co. sperrt `lib/offsite/host-policy.ts` (`isForbiddenHost`). Das Ergebnis wird kurz zwischengespeichert (die Routen ändern sich praktisch nie).
 */
const CACHE_MS = 60_000;

/** Nur für Tests: feste Gateways (im Betrieb wirkungslos – es wirft). */
export const gatewayTestHooks: { gateways?: readonly string[] } = {};
export function setGatewayTestHooks(hooks: { gateways?: readonly string[] }): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("setGatewayTestHooks: nur in Tests");
  gatewayTestHooks.gateways = hooks.gateways;
  cache = null;
}

const HEX8 = /^[0-9A-Fa-f]{8}$/;
const RTF_GATEWAY = 0x2;
const dotted = (value: number): string => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join(".");

type RouteRow = { destination: number; gateway: number; flags: number; mask: number };

/** Zeilen aus dem Text von `/proc/net/route` (Spalten `Iface Destination Gateway Flags … Mask …`, Adressen als little-endian Hex); Müll wird übersprungen. Rein. */
function routeRows(routeTable: string): RouteRow[] {
  const rows: RouteRow[] = [];
  for (const line of routeTable.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8) continue;
    const [, destination, gateway, flags, , , , mask] = cols;
    if (!HEX8.test(destination!) || !HEX8.test(gateway!) || !HEX8.test(mask!)) continue;
    rows.push({ destination: parseInt(destination!, 16), gateway: parseInt(gateway!, 16), flags: parseInt(flags!, 16) || 0, mask: parseInt(mask!, 16) });
  }
  return rows;
}

/** Alle Gateways aller Routen (Gateway-Flag gesetzt, Adresse ≠ 0.0.0.0) – Standardroute und Netzrouten. Rein. */
export function parseGateways(routeTable: string): string[] {
  return [...new Set(routeRows(routeTable).filter((r) => (r.flags & RTF_GATEWAY) !== 0 && r.gateway !== 0).map((r) => dotted(r.gateway)))];
}

/** Nur die Gateways der Standardroute `0.0.0.0/0` (Teilmenge von `parseGateways`; für die Anzeige und Tests). Rein. */
export function parseDefaultGateways(routeTable: string): string[] {
  return [...new Set(routeRows(routeTable).filter((r) => r.destination === 0 && r.mask === 0 && (r.flags & RTF_GATEWAY) !== 0 && r.gateway !== 0).map((r) => dotted(r.gateway)))];
}

/** Die erste Adresse jedes direkt verbundenen Netzes (Route ohne Gateway, Ziel ≠ 0, Präfix 8 bis 30): bei Docker die Brücke zum Host. Rein. */
export function parseConnectedFirstHosts(routeTable: string): string[] {
  const found: string[] = [];
  for (const r of routeRows(routeTable)) {
    if (r.gateway !== 0 || r.destination === 0 || (r.flags & RTF_GATEWAY) !== 0) continue;
    // little-endian: das niedrigste Byte ist das erste Oktett; die Maske ist zusammenhängend, wenn ihre Umkehrung (big-endian) ein Präfix ergibt
    const be = (((r.mask & 0xff) << 24) | (((r.mask >>> 8) & 0xff) << 16) | (((r.mask >>> 16) & 0xff) << 8) | ((r.mask >>> 24) & 0xff)) >>> 0;
    const prefix = be === 0 ? 0 : 32 - Math.log2((~be >>> 0) + 1);
    if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) continue;
    found.push(dotted((r.destination + 0x01000000) >>> 0)); // + 1 im ersten (niedrigsten, little-endian: höchsten) Byte der Adresse = Hostteil .1
  }
  return [...new Set(found)];
}

/** Gateways aus `/proc/net/ipv6_route` (Spalten: Ziel, Präfixlänge, Quelle, Präfixlänge, nächster Hop, Metrik, Zähler, Zähler, Flags, Gerät; Adressen als 32 Hex-Ziffern). Rein. */
export function parseIpv6Gateways(routeTable: string): string[] {
  const found: string[] = [];
  for (const line of routeTable.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const nextHop = cols[4]!;
    const flags = parseInt(cols[8]!, 16);
    if (!/^[0-9A-Fa-f]{32}$/.test(nextHop) || !Number.isInteger(flags) || (flags & RTF_GATEWAY) === 0 || /^0+$/.test(nextHop)) continue;
    found.push(nextHop.toLowerCase().match(/.{4}/g)!.map((g) => g.replace(/^0+(?=.)/, "")).join(":"));
  }
  return [...new Set(found)];
}

const inContainer = (): boolean => existsSync("/.dockerenv") || existsSync("/run/.containerenv") || Boolean(process.env.KUBERNETES_SERVICE_HOST);

let cache: { at: number; gateways: Set<string> } | null = null;

/** Quellen der Routen; in Tests austauschbar. */
export const routeSources = {
  ipv4: () => readFileSync("/proc/net/route", "utf8"),
  ipv6: () => readFileSync("/proc/net/ipv6_route", "utf8"),
  container: inContainer,
};

/** Die Gateway-Adressen (kanonische Schlüssel, IPv4 und IPv6); leer außerhalb eines Containers und wenn keine Routentabelle lesbar ist. */
export function hostGatewayAddresses(): ReadonlySet<string> {
  if (gatewayTestHooks.gateways) return new Set(gatewayTestHooks.gateways.map((g) => addressKey(g) ?? g));
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.gateways;
  const gateways = new Set<string>();
  if (routeSources.container()) {
    const add = (list: readonly string[]) => {
      for (const address of list) {
        const key = addressKey(address);
        if (key) gateways.add(key);
      }
    };
    try {
      const table = routeSources.ipv4();
      add(parseGateways(table));
      add(parseConnectedFirstHosts(table));
    } catch {
      /* ohne Routentabelle bleibt es bei der übrigen Zielsperre */
    }
    try {
      add(parseIpv6Gateways(routeSources.ipv6()));
    } catch {
      /* kein IPv6 im Container */
    }
  }
  cache = { at: now, gateways };
  return gateways;
}

/** Nur für Tests: den Zwischenspeicher verwerfen (nach dem Austausch von `routeSources`). */
export function resetGatewayCache(): void {
  cache = null;
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

/**
 * **Die eine Zielregel für jede ausgehende Verbindung** (Webhooks, Off-Site-Backup, E-Mail-Versand, Überwachung; Entscheid des Besitzers: einheitlich, auch mit `allowPrivate`): Eine aufgelöste Adresse ist nur dann
 * ein Ziel, wenn sie nicht in einem gesperrten Bereich liegt (Loopback, Verbindungs-lokal, Metadaten, eigene Schnittstellen: `isAllowedAddress`), **nicht das Host-Gateway des Containers ist** (der Docker-Host ist der
 * Server selbst) und – nur wenn die Verbindungsart private Netze von einer Freigabe abhängig macht (`allowPrivate: false`, Standard `true`) – nicht in einem privaten Netz liegt. `allowPrivate` öffnet also private Netze,
 * nie den Server selbst. **Jeder Resolver ruft diese Funktion für jede Antwort der Namensauflösung** (und für Literale), keiner baut eine eigene Bedingung (Test `outbound-targets.test.ts`).
 */
export function isAllowedTarget(address: string, options: { allowPrivate?: boolean } = {}): boolean {
  return isAllowedAddress(address) && !isHostGateway(address) && ((options.allowPrivate ?? true) || !isPrivateAddress(address));
}

/** Eingabeprüfung für jede Verbindungsart (ohne Namensauflösung): der Host ist als Ziel verboten (Name oder Adresse des eigenen Rechners, Metadaten-Dienste, Docker-Host-Namen) oder ein Literal des Host-Gateways. */
export function isForbiddenTargetHost(host: string): boolean {
  return isForbiddenHost(host) || isHostGatewayHost(host);
}
