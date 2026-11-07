/**
 * Erreichbarkeit der Geräte. **Es gibt noch keine Überwachung**: Die Anwendung prüft nichts und zeigt deshalb keinen Zustand an – jedes Gerät hat den Status „unbekannt“ (früher gab es erfundene
 * Demo-Werte; sie sind entfernt, damit niemand sich auf einen Zustand verlässt, den es nicht gibt). Echte Werte liefert später die Netzwerk-Überwachung (F12): ein anderer `StatusProvider`
 * in `getStatusProvider()`; die Zustände `online`/`degraded`/`offline` sind dafür schon im Typ.
 */
export type LinkState = "online" | "degraded" | "offline" | "unknown";

export type DeviceCheck = {
  state: LinkState;
  latencyMs: number | null;
  checkedAt: Date;
};

export type MonitoredDevice = { id: string; monitorEnabled: boolean };

export interface StatusProvider {
  /** `none`: keine Überwachung eingerichtet; später z. B. `ping` */
  id: "none";
  check(devices: MonitoredDevice[], now?: Date): Promise<Map<string, DeviceCheck>>;
}

/** Ohne Überwachung ist der Zustand jedes Geräts unbekannt – auch wenn „Erreichbarkeit überwachen“ gesetzt ist. */
export const noMonitoring: StatusProvider = {
  id: "none",
  async check(devices, now = new Date()) {
    return new Map(devices.map((d) => [d.id, { state: "unknown" as const, latencyMs: null, checkedAt: now }]));
  },
};

export function getStatusProvider(): StatusProvider {
  return noMonitoring;
}
