export type LinkState = "online" | "degraded" | "offline" | "unknown";

export type DeviceCheck = {
  state: LinkState;
  latencyMs: number | null;
  checkedAt: Date;
  /** true = simulierter Wert, kein echter Netzwerkzugriff */
  demo: boolean;
};

export type MonitoredDevice = { id: string; monitorEnabled: boolean };

/**
 * Quelle für den Erreichbarkeitsstatus. Aktuell gibt es nur den Demo-Anbieter (keine Netzwerkzugriffe).
 * Später: einen `PingStatusProvider` (ICMP/TCP-Check, Zeitplan, Verlauf) implementieren und in
 * `getStatusProvider()` auswählen (z. B. per Umgebungsvariable NETWORK_MONITOR=ping).
 */
export interface StatusProvider {
  id: "demo";
  isDemo: boolean;
  check(devices: MonitoredDevice[], now?: Date): Promise<Map<string, DeviceCheck>>;
}

/** Stabiler Hash (FNV-1a) -> Zahl in [0, 1). */
export function hash01(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

/** Je Gerät dauerhaft derselbe Demo-Zustand: ca. 78 % online, 12 % langsam, 10 % offline. */
export function demoState(deviceId: string): Exclude<LinkState, "unknown"> {
  const h = hash01(`state:${deviceId}`);
  return h < 0.78 ? "online" : h < 0.9 ? "degraded" : "offline";
}

export const demoProvider: StatusProvider = {
  id: "demo",
  isDemo: true,
  async check(devices, now = new Date()) {
    const bucket = Math.floor(now.getTime() / (5 * 60_000)); // Latenz ändert sich alle 5 Minuten leicht
    const result = new Map<string, DeviceCheck>();
    for (const d of devices) {
      if (!d.monitorEnabled) {
        result.set(d.id, { state: "unknown", latencyMs: null, checkedAt: now, demo: true });
        continue;
      }
      const state = demoState(d.id);
      const jitter = hash01(`lat:${d.id}:${bucket}`);
      const latencyMs = state === "offline" ? null : state === "online" ? Math.round(1 + jitter * 24) : Math.round(90 + jitter * 220);
      result.set(d.id, { state, latencyMs, checkedAt: now, demo: true });
    }
    return result;
  },
};

export function getStatusProvider(): StatusProvider {
  return demoProvider;
}
