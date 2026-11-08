/**
 * Erreichbarkeit der Geräte – der **Vertrag** zwischen Geräteseiten und Messung. Die Anwendung zeigt nie einen Zustand, den sie nicht gemessen hat (P4b-6): Ohne Überwachung (Standard: aus), ohne
 * Ziel für das Gerät, vor der ersten Messung und bei einer **veralteten** Messung (älter als drei Intervalle) ist der Zustand „unbekannt“. Die Messung selbst (TCP/HTTP, kein ICMP) steht in
 * `src/server/monitor`, der datenbankgestützte Anbieter in `status-provider.ts`.
 */
export type LinkState = "online" | "degraded" | "offline" | "unknown";

export type DeviceCheck = {
  state: LinkState;
  latencyMs: number | null;
  /** Zeitpunkt der letzten Messung (null: nie gemessen) */
  checkedAt: Date | null;
  /** Es gibt Messungen, sie sind aber zu alt: der Zustand ist deshalb „unbekannt“ */
  stale?: boolean;
  /** Zahl der Überwachungsziele, die auf das Gerät verweisen */
  targets?: number;
};

export type MonitoredDevice = { id: string; monitorEnabled: boolean };

export interface StatusProvider {
  /** `none`: keine Überwachung; `reachability`: gemessene Erreichbarkeit (TCP/HTTP) */
  id: "none" | "reachability";
  check(devices: MonitoredDevice[], now?: Date): Promise<Map<string, DeviceCheck>>;
}

/** Ohne Überwachung ist der Zustand jedes Geräts unbekannt – auch wenn „Erreichbarkeit überwachen“ gesetzt ist. */
export const noMonitoring: StatusProvider = {
  id: "none",
  async check(devices) {
    return new Map(devices.map((d) => [d.id, { state: "unknown" as const, latencyMs: null, checkedAt: null }]));
  },
};
