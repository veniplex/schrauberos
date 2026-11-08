import "server-only";
import { versionOf } from "@/lib/concurrency";
import { HOURLY_KEEP_DAYS, availability, compactSamples, viewOf } from "@/lib/monitor/model";
import { db } from "@/server/db";
import { isMonitoringEnabled } from "@/server/monitor/run";
import { compareIPv4 } from "@/modules/it/network/domain";
import type { DeviceCheck } from "./monitoring";
import { getStatusProvider } from "./status-provider";

export const deviceInclude = {
  location: true,
  ips: true,
} as const;

export async function listDevices(where: object = {}) {
  const devices = await db.netDevice.findMany({ where, include: deviceInclude, orderBy: { name: "asc" } });
  return devices.map((d) => ({ ...d, ips: [...d.ips].sort((a, b) => compareIPv4(a.address, b.address)) }));
}

export type DeviceRow = Awaited<ReturnType<typeof listDevices>>[number];

/** Erreichbarkeitsstatus für Geräte: nur Gemessenes (siehe monitoring.ts, status-provider.ts), sonst „unbekannt“. */
export async function checkDevices(devices: Array<{ id: string; monitorEnabled: boolean }>): Promise<Map<string, DeviceCheck>> {
  return getStatusProvider().check(devices);
}

/** Subnetze mit Anzahl belegter Adressen. */
export async function listSubnets() {
  return db.netSubnet.findMany({
    include: { vlan: true, _count: { select: { ips: true } } },
    orderBy: { cidr: "asc" },
  });
}

/* ───────────── Netzwerk-Überwachung (F12) ───────────── */

export type MonitorViewer = { canManage: boolean };

/** Was jeder mit `network.view` sieht: Name, Gerät, Zustand, Latenz, Statusklasse, Zeitpunkte – nie die Zieladresse (Host, Port, Pfad); die sieht nur, wer Ziele verwalten darf (`network.monitor`). */
export type MonitorTargetRow = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  intervalSec: number;
  state: string;
  stateSince: Date | null;
  lastCheckAt: Date | null;
  lastLatencyMs: number | null;
  lastClass: string | null;
  device: { id: string; name: string } | null;
  /** nur mit `network.monitor` gelesen */
  address?: { host: string; port: number; path: string | null; method: string; ignoreTlsErrors: boolean };
};

const targetBaseSelect = {
  id: true,
  name: true,
  kind: true,
  enabled: true,
  intervalSec: true,
  state: true,
  stateSince: true,
  lastCheckAt: true,
  lastLatencyMs: true,
  lastClass: true,
  device: { select: { id: true, name: true } },
} as const;
// Sensible Spalten werden ohne das Recht gar nicht erst aus der Datenbank gelesen (nicht nachträglich maskiert)
const targetSelect = (viewer: MonitorViewer) => (viewer.canManage ? { ...targetBaseSelect, host: true, port: true, path: true, method: true, ignoreTlsErrors: true } : targetBaseSelect);

type RawTarget = Omit<MonitorTargetRow, "address"> & { host?: string; port?: number; path?: string | null; method?: string; ignoreTlsErrors?: boolean };
const toRow = ({ host, port, path, method, ignoreTlsErrors, ...rest }: RawTarget): MonitorTargetRow =>
  host === undefined ? rest : { ...rest, address: { host, port: port as number, path: path ?? null, method: method as string, ignoreTlsErrors: ignoreTlsErrors === true } };

export async function listMonitorTargets(viewer: MonitorViewer): Promise<MonitorTargetRow[]> {
  const rows = await db.netMonitorTarget.findMany({ select: targetSelect(viewer), orderBy: { name: "asc" } });
  return rows.map((r) => toRow(r as RawTarget));
}

export async function getMonitorTarget(id: string, viewer: MonitorViewer): Promise<(MonitorTargetRow & { version: string }) | null> {
  const row = await db.netMonitorTarget.findUnique({ where: { id }, select: { ...targetSelect(viewer), updatedAt: true } });
  if (!row) return null;
  const { updatedAt, ...rest } = row as RawTarget & { updatedAt: Date };
  return { ...toRow(rest), version: versionOf({ updatedAt }) };
}

/** Die Überwachungsziele eines Geräts (Abschnitt „Überwachung“ der Geräteseite): wie die Liste – ohne Zieladresse, wenn die Person keine Ziele verwalten darf. */
export async function deviceMonitorTargets(deviceId: string, viewer: MonitorViewer): Promise<MonitorTargetRow[]> {
  const rows = await db.netMonitorTarget.findMany({ where: { deviceId }, select: targetSelect(viewer), orderBy: { name: "asc" } });
  return rows.map((r) => toRow(r as RawTarget));
}

export type MonitorHistory = {
  /** Stundenwerte der letzten 30 Tage (Rohwerte der letzten 7 Tage, zu Stunden verdichtet, plus gespeicherte Stundenwerte), aufsteigend */
  hours: Array<{ hour: Date; checks: number; failures: number; latencyAvgMs: number | null }>;
  /** die letzten Einzelmessungen (neueste zuletzt) für die Balkenreihe */
  recent: Array<{ at: Date; ok: boolean; statusClass: string; latencyMs: number | null }>;
  events: Array<{ id: string; at: Date; kind: string; downSeconds: number | null }>;
  availability30d: number | null;
};

/** Obergrenze gelesener Rohwerte je Ziel (acht Tage bei 60 s Takt sind rund 11 500) */
const RAW_HISTORY_ROWS = 20_000;

export async function monitorHistory(targetId: string, now: Date): Promise<MonitorHistory> {
  const DAY = 86_400_000;
  const [raw, stored, recent, events] = await Promise.all([
    // Alle noch nicht verdichteten Rohwerte: nicht nur die der letzten 7 Tage – zwischen dem nächtlichen Aufräumen und `jetzt − 7 Tage` liegen bis zu 24 Stunden Rohwerte, die weder in den Stundenwerten noch
    // sonst stünden (Lücke am Rand; ein gestoppter Job verlängert sie). Verdichtete sind gelöscht – keine Doppelzählung. Nach oben begrenzt auf die neuesten und auf 30 Tage.
    db.netMonitorSample.findMany({ where: { targetId, at: { gte: new Date(now.getTime() - HOURLY_KEEP_DAYS * DAY) } }, orderBy: { at: "desc" }, select: { at: true, ok: true, latencyMs: true }, take: RAW_HISTORY_ROWS }),
    db.netMonitorHour.findMany({ where: { targetId, hour: { gte: new Date(now.getTime() - HOURLY_KEEP_DAYS * DAY) } }, orderBy: { hour: "asc" } }),
    db.netMonitorSample.findMany({ where: { targetId }, orderBy: { at: "desc" }, take: 48, select: { at: true, ok: true, statusClass: true, latencyMs: true } }),
    db.netMonitorEvent.findMany({ where: { targetId }, orderBy: { at: "desc" }, take: 20, select: { id: true, at: true, kind: true, downSeconds: true } }),
  ]);
  const merged = new Map<number, { hour: Date; checks: number; failures: number; latencySum: number; latencyCount: number }>();
  const add = (hour: Date, checks: number, failures: number, latencySum: number, latencyCount: number) => {
    const entry = merged.get(hour.getTime()) ?? { hour, checks: 0, failures: 0, latencySum: 0, latencyCount: 0 };
    entry.checks += checks;
    entry.failures += failures;
    entry.latencySum += latencySum;
    entry.latencyCount += latencyCount;
    merged.set(hour.getTime(), entry);
  };
  for (const h of stored) add(h.hour, h.checks, h.failures, h.latencySumMs, h.latencyCount);
  for (const b of compactSamples(raw)) add(b.hour, b.checks, b.failures, b.latencySumMs, b.latencyCount);
  const hours = [...merged.values()]
    .sort((a, b) => a.hour.getTime() - b.hour.getTime())
    .map((h) => ({ hour: h.hour, checks: h.checks, failures: h.failures, latencyAvgMs: h.latencyCount ? Math.round(h.latencySum / h.latencyCount) : null }));
  const checks = hours.reduce((n, h) => n + h.checks, 0);
  const failures = hours.reduce((n, h) => n + h.failures, 0);
  return { hours, recent: recent.reverse(), events, availability30d: availability(checks, failures) };
}

/** Zusammenfassung für Übersicht und Dashboard: nur Gemessenes. `configured`: es gibt Ziele UND die Überwachung ist eingeschaltet. */
export type MonitorSummary = { enabled: boolean; targets: number; up: number; warn: number; down: number; unknown: number; stale: number; downNames: string[] };

export async function monitorSummary(now: Date): Promise<MonitorSummary> {
  const [enabled, targets] = await Promise.all([isMonitoringEnabled(), db.netMonitorTarget.findMany({ where: { enabled: true }, select: { name: true, state: true, lastCheckAt: true, intervalSec: true }, orderBy: { name: "asc" } })]);
  const summary: MonitorSummary = { enabled, targets: targets.length, up: 0, warn: 0, down: 0, unknown: 0, stale: 0, downNames: [] };
  if (!enabled) return summary;
  for (const t of targets) {
    const view = viewOf(t, now);
    if (view.state === "unknown") {
      summary.unknown++;
      if (view.stale) summary.stale++;
    } else {
      summary[view.state]++;
      if (view.state === "down") summary.downNames.push(t.name);
    }
  }
  return summary;
}

/** Ist die Überwachung eingeschaltet? (Standard: aus.) */
export const monitoringEnabled = (): Promise<boolean> => isMonitoringEnabled();

/** Auswahl im Formular eines Überwachungsziels: Geräte und vergebene IP-Adressen (nur IPv4 der IP-Verwaltung) */
export async function monitorFormChoices() {
  const [devices, ips] = await Promise.all([
    db.netDevice.findMany({ where: { status: { not: "retired" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.netIp.findMany({ where: { deviceId: { not: null } }, select: { id: true, address: true, deviceId: true, device: { select: { name: true } } } }),
  ]);
  return {
    devices,
    ips: ips
      .sort((a, b) => compareIPv4(a.address, b.address))
      .map((ip) => ({ id: ip.id, address: ip.address, deviceId: ip.deviceId, label: `${ip.device?.name ?? "–"} · ${ip.address}` })),
  };
}
