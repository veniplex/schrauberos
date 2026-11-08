import "server-only";
import { deviceStatus } from "@/lib/monitor/model";
import { db } from "@/server/db";
import { isMonitoringEnabled } from "@/server/monitor/run";
import { noMonitoring, type DeviceCheck, type StatusProvider } from "./monitoring";

/**
 * Der Anbieter für den Gerätestatus: liest die **gemessenen** Werte der Überwachungsziele eines Geräts (`lib/monitor/model.ts` rechnet sie zusammen). Bei ausgeschalteter Überwachung ist
 * jeder Zustand unbekannt; eine Messung, die älter als drei Intervalle ist, zählt nicht (nie grün aus alten Werten).
 */
export const reachabilityProvider: StatusProvider = {
  id: "reachability",
  async check(devices, now = new Date()) {
    if (devices.length === 0 || !(await isMonitoringEnabled())) return noMonitoring.check(devices);
    const targets = await db.netMonitorTarget.findMany({
      where: { deviceId: { in: devices.map((d) => d.id) }, enabled: true },
      select: { deviceId: true, state: true, lastCheckAt: true, lastLatencyMs: true, intervalSec: true },
    });
    const byDevice = new Map<string, typeof targets>();
    for (const t of targets) if (t.deviceId) byDevice.set(t.deviceId, [...(byDevice.get(t.deviceId) ?? []), t]);
    return new Map(
      devices.map((d): [string, DeviceCheck] => {
        const status = deviceStatus(byDevice.get(d.id) ?? [], now);
        return [d.id, { state: status.state, latencyMs: status.latencyMs, checkedAt: status.checkedAt, stale: status.stale, targets: status.targets }];
      }),
    );
  },
};

export function getStatusProvider(): StatusProvider {
  return reachabilityProvider;
}
