import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isForbiddenMonitorHost } from "@/lib/monitor/target";
import { canonicalHost } from "@/lib/offsite/host-policy";
import { Semaphore } from "@/lib/semaphore";
import { isAllowedTarget } from "@/server/host-gateway";

/**
 * Ziel einer Erreichbarkeitsprüfung beim **Verbinden**: Name **einmal** auflösen, **jede** Antwort gegen die Zielsperre prüfen (`lib/offsite/host-policy.ts`), danach nur mit den geprüften Adressen
 * verbinden – zwischen Prüfung und Verbindung gibt es keine zweite Auflösung (DNS-Rebinding). Anders als bei Webhooks sind **private Adressen erlaubt** (das interne Netz ist gerade das Ziel);
 * gesperrt bleiben Loopback, die eigenen Schnittstellen und im Container das Host-Gateway, „dieses Netz“, Link-Local samt Metadaten-Diensten, Multicast und Reserviertes – für jeden, auch für Administratoren.
 *
 * Namensauflösung belegt einen Thread des libuv-Pools (derselbe Pool wie scrypt und Dateizugriffe): höchstens zwei Auflösungen gleichzeitig, jede mit Zeitlimit.
 */
export class MonitorBlocked extends Error {
  constructor(readonly code: "blocked" | "dns") {
    super(`Überwachung: ${code}`);
    this.name = "MonitorBlocked";
  }
}

export type PinnedAddress = { address: string; family: 4 | 6 };
export type Lookup = (name: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;

const dnsLane = new Semaphore(2, 16);

/** Erlaubt: nicht in einem gesperrten Bereich und nicht das Host-Gateway des Containers (der Docker-Host ist „der eigene Rechner“, `server/host-gateway.ts`) */
const allowed = (address: string): boolean => isAllowedTarget(address);

/** Nur für Tests: vorgegebene Namensauflösung (Rebinding, mehrere Antworten). Im Betrieb wirkungslos – es wirft. */
export const monitorTestHooks: { lookup?: Lookup } = {};
export function setMonitorTestHooks(hooks: { lookup?: Lookup }): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("setMonitorTestHooks: nur in Tests");
  monitorTestHooks.lookup = hooks.lookup;
}

export async function resolveMonitorTarget(host: string, timeoutMs: number, lookupImpl: Lookup = monitorTestHooks.lookup ?? (lookup as Lookup)): Promise<{ addresses: PinnedAddress[]; servername: string | null }> {
  const canonical = canonicalHost(host);
  if (!canonical || isForbiddenMonitorHost(host)) throw new MonitorBlocked("blocked");
  if (canonical.kind === "ip") {
    if (!allowed(canonical.ip)) throw new MonitorBlocked("blocked");
    return { addresses: [{ address: canonical.ip, family: isIP(canonical.ip) as 4 | 6 }], servername: null };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const answers = await Promise.race([
      dnsLane.run(() => lookupImpl(canonical.name, { all: true, verbatim: true }), { bounded: true }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new MonitorBlocked("dns")), Math.max(1, timeoutMs)))),
    ]);
    if (answers.length === 0) throw new MonitorBlocked("dns");
    // Jede Antwort muss erlaubt sein: ein Name mit einer erlaubten und einer verbotenen Adresse wäre ein Umlenkversuch
    if (answers.some((answer) => !allowed(answer.address))) throw new MonitorBlocked("blocked");
    return { addresses: answers.map((a) => ({ address: a.address, family: (a.family === 6 ? 6 : 4) as 4 | 6 })), servername: canonical.name };
  } catch (error) {
    throw error instanceof MonitorBlocked ? error : new MonitorBlocked("dns");
  } finally {
    clearTimeout(timer);
  }
}
