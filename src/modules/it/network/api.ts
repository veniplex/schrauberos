import { z } from "zod";
import type { NetConnection, NetDevice, NetMonitorTarget, NetIp, NetLocation, NetSubnet, NetVlan } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { MONITOR_KINDS, viewOf } from "@/lib/monitor/model";
import { dayOrNull, iso, nullableString, oneOf, optionalDate, optionalRef, text } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { isMonitoringEnabled } from "@/server/monitor/run";
import { contains } from "@/server/search";
import { DEVICE_STATUSES, DEVICE_TYPES, IP_KINDS } from "./constants";
import {
  deleteConnectionOperation,
  deleteDeviceOperation,
  deleteIpOperation,
  deleteLocationOperation,
  deleteSubnetOperation,
  deleteVlanOperation,
  saveConnectionOperation,
  saveDeviceOperation,
  saveIpOperation,
  saveLocationOperation,
  saveSubnetOperation,
  saveVlanOperation,
} from "./operations";

/**
 * API-Ressourcen „Netzwerk-Dokumentation“ unter `/api/v1/network-…`: Geräte, Standorte, VLANs, Subnetze, IP-Adressen und Kabelverbindungen. Dieselben Prüfungen
 * wie in der Oberfläche (IP im Subnetz, Adresse eindeutig, MAC normalisiert, Port nicht doppelt belegt). Geräte, Standorte, VLANs, Subnetze und IP-Adressen tragen eine
 * Version (`ETag`, Änderungen verlangen `If-Match`); Verbindungen haben keine Version.
 */
const ref = optionalRef;

/* ───────────── Geräte ───────────── */

const deviceBody = z.strictObject({
  name: z.string().trim().min(1).max(80),
  type: z.enum(DEVICE_TYPES),
  status: z.enum(DEVICE_STATUSES).optional(),
  manufacturer: text(60),
  model: text(80),
  serialNumber: text(80),
  locationId: ref,
  rackInfo: text(80),
  portCount: z.number().int().min(1).max(96).nullable().optional(),
  assignedTo: text(80),
  purchaseDate: optionalDate,
  warrantyUntil: optionalDate,
  monitorEnabled: z.boolean().optional(),
  notes: text(2000),
});
const deviceItem = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  type: z.enum(DEVICE_TYPES),
  status: z.enum(DEVICE_STATUSES),
  manufacturer: nullableString,
  model: nullableString,
  serialNumber: nullableString,
  locationId: nullableString,
  rackInfo: nullableString,
  portCount: z.number().int().nullable(),
  assignedTo: nullableString,
  purchaseDate: nullableString,
  warrantyUntil: nullableString,
  monitorEnabled: z.boolean(),
  notes: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const deviceEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-devices",
  singular: "network device",
  path: "/network-devices",
  read: "network.view",
  model: db.netDevice as unknown as Delegate<NetDevice>,
  item: deviceItem,
  version: versionOf,
  toItem: (d): z.input<typeof deviceItem> => ({
    id: d.id,
    version: versionOf(d),
    name: d.name,
    type: oneOf(DEVICE_TYPES, d.type, "other"),
    status: oneOf(DEVICE_STATUSES, d.status, "active"),
    manufacturer: d.manufacturer,
    model: d.model,
    serialNumber: d.serialNumber,
    locationId: d.locationId,
    rackInfo: d.rackInfo,
    portCount: d.portCount,
    assignedTo: d.assignedTo,
    purchaseDate: dayOrNull(d.purchaseDate),
    warrantyUntil: dayOrNull(d.warrantyUntil),
    monitorEnabled: d.monitorEnabled,
    notes: d.notes,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  }),
  list: {
    filters: z.strictObject({ q: z.string().max(100).optional(), type: z.enum(DEVICE_TYPES).optional(), status: z.enum(DEVICE_STATUSES).optional(), locationId: z.string().max(64).optional() }),
    where: ({ q, type, status, locationId }) => ({
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(locationId ? { locationId } : {}),
      ...(q ? { OR: [{ name: contains(q) }, { manufacturer: contains(q) }, { model: contains(q) }, { serialNumber: contains(q) }, { assignedTo: contains(q) }] } : {}),
    }),
    sorts: { name: (dir) => ({ name: dir }), type: (dir) => ({ type: dir }), createdAt: (dir) => ({ createdAt: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "name", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveDeviceOperation, body: deviceBody, toInput: (b) => ({ ...b, monitorEnabled: b.monitorEnabled ?? false }) },
  update: {
    permission: "network.edit",
    operation: saveDeviceOperation,
    current: (d) => ({
      name: d.name,
      type: d.type,
      status: d.status,
      manufacturer: d.manufacturer,
      model: d.model,
      serialNumber: d.serialNumber,
      locationId: d.locationId,
      rackInfo: d.rackInfo,
      portCount: d.portCount,
      assignedTo: d.assignedTo,
      purchaseDate: dayOrNull(d.purchaseDate),
      warrantyUntil: dayOrNull(d.warrantyUntil),
      monitorEnabled: d.monitorEnabled,
      notes: d.notes,
    }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "network.delete", operation: deleteDeviceOperation },
});

/* ───────────── Standorte ───────────── */

const locationBody = z.strictObject({ name: z.string().trim().min(1).max(80), description: text(200), sortOrder: z.number().int().min(0).max(999).optional() });
const locationItem = z.object({ id: z.string(), version: z.string(), name: z.string(), description: nullableString, sortOrder: z.number().int() });

export const locationEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-locations",
  singular: "location",
  path: "/network-locations",
  read: "network.view",
  model: db.netLocation as unknown as Delegate<NetLocation>,
  item: locationItem,
  version: versionOf,
  toItem: (l): z.input<typeof locationItem> => ({ id: l.id, version: versionOf(l), name: l.name, description: l.description, sortOrder: l.sortOrder }),
  list: {
    filters: z.strictObject({}),
    sorts: { name: (dir) => ({ name: dir }), sortOrder: (dir) => ({ sortOrder: dir }) },
    defaultSort: [{ key: "sortOrder", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveLocationOperation, body: locationBody, toInput: (b) => b },
  update: {
    permission: "network.edit",
    operation: saveLocationOperation,
    current: (l) => ({ name: l.name, description: l.description, sortOrder: l.sortOrder }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "network.delete", operation: deleteLocationOperation },
});

/* ───────────── VLANs ───────────── */

const vlanBody = z.strictObject({
  /** VLAN-Nummer (1–4094) */
  number: z.number().int().min(1).max(4094),
  name: z.string().trim().min(1).max(60),
  description: text(200),
});
const vlanItem = z.object({ id: z.string(), version: z.string(), number: z.number().int(), name: z.string(), description: nullableString });

export const vlanEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-vlans",
  singular: "VLAN",
  path: "/network-vlans",
  read: "network.view",
  model: db.netVlan as unknown as Delegate<NetVlan>,
  item: vlanItem,
  version: versionOf,
  toItem: (v): z.input<typeof vlanItem> => ({ id: v.id, version: versionOf(v), number: v.number, name: v.name, description: v.description }),
  list: {
    filters: z.strictObject({}),
    sorts: { number: (dir) => ({ number: dir }), name: (dir) => ({ name: dir }) },
    defaultSort: [{ key: "number", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveVlanOperation, body: vlanBody, toInput: (b) => b },
  update: {
    permission: "network.edit",
    operation: saveVlanOperation,
    current: (v) => ({ number: v.number, name: v.name, description: v.description }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "network.delete", operation: deleteVlanOperation },
});

/* ───────────── Subnetze ───────────── */

const subnetBody = z.strictObject({
  name: z.string().trim().min(1).max(80),
  /** IPv4 in CIDR-Schreibweise, z. B. 192.168.10.0/24 */
  cidr: z.string().max(18),
  /** Verweis auf ein VLAN (id aus `/network-vlans`) */
  vlanId: ref,
  gateway: text(15),
  dnsServers: text(100),
  dhcpStart: text(15),
  dhcpEnd: text(15),
  description: text(300),
  /** Überschneidung mit einem Netz in einem anderen VLAN trotz Warnung speichern (im selben VLAN nie) */
  allowOverlap: z.boolean().optional(),
});
const subnetItem = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  cidr: z.string(),
  vlanId: nullableString,
  gateway: nullableString,
  dnsServers: nullableString,
  dhcpStart: nullableString,
  dhcpEnd: nullableString,
  description: nullableString,
});

export const subnetEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-subnets",
  singular: "subnet",
  path: "/network-subnets",
  read: "network.view",
  model: db.netSubnet as unknown as Delegate<NetSubnet>,
  item: subnetItem,
  version: versionOf,
  toItem: (s): z.input<typeof subnetItem> => ({ id: s.id, version: versionOf(s), name: s.name, cidr: s.cidr, vlanId: s.vlanId, gateway: s.gateway, dnsServers: s.dnsServers, dhcpStart: s.dhcpStart, dhcpEnd: s.dhcpEnd, description: s.description }),
  list: {
    filters: z.strictObject({ vlanId: z.string().max(64).optional() }),
    where: ({ vlanId }) => (vlanId ? { vlanId } : {}),
    sorts: { name: (dir) => ({ name: dir }), cidr: (dir) => ({ cidr: dir }) },
    defaultSort: [{ key: "name", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveSubnetOperation, body: subnetBody, toInput: (b) => b },
  update: {
    permission: "network.edit",
    operation: saveSubnetOperation,
    current: (s) => ({ name: s.name, cidr: s.cidr, vlanId: s.vlanId, gateway: s.gateway, dnsServers: s.dnsServers, dhcpStart: s.dhcpStart, dhcpEnd: s.dhcpEnd, description: s.description }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "network.delete", operation: deleteSubnetOperation },
});

/* ───────────── IP-Adressen ───────────── */

const ipBody = z.strictObject({
  subnetId: z.string().min(1).max(64),
  address: z.string().max(15),
  deviceId: ref,
  hostname: text(100),
  kind: z.enum(IP_KINDS).optional(),
  mac: text(30),
  notes: text(300),
});
const ipItem = z.object({
  id: z.string(),
  version: z.string(),
  subnetId: z.string(),
  address: z.string(),
  deviceId: nullableString,
  hostname: nullableString,
  kind: z.enum(IP_KINDS),
  mac: nullableString,
  notes: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ipEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-ips",
  singular: "IP address",
  path: "/network-ips",
  read: "network.view",
  model: db.netIp as unknown as Delegate<NetIp>,
  item: ipItem,
  version: versionOf,
  toItem: (i): z.input<typeof ipItem> => ({
    id: i.id,
    version: versionOf(i),
    subnetId: i.subnetId,
    address: i.address,
    deviceId: i.deviceId,
    hostname: i.hostname,
    kind: oneOf(IP_KINDS, i.kind, "static"),
    mac: i.mac,
    notes: i.notes,
    createdAt: iso(i.createdAt),
    updatedAt: iso(i.updatedAt),
  }),
  list: {
    filters: z.strictObject({ subnetId: z.string().max(64).optional(), deviceId: z.string().max(64).optional(), q: z.string().max(100).optional() }),
    where: ({ subnetId, deviceId, q }) => ({
      ...(subnetId ? { subnetId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(q ? { OR: [{ address: contains(q) }, { hostname: contains(q) }, { mac: contains(q) }] } : {}),
    }),
    sorts: { address: (dir) => ({ address: dir }), hostname: (dir) => ({ hostname: dir }), createdAt: (dir) => ({ createdAt: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "address", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveIpOperation, body: ipBody, toInput: (b) => b },
  update: {
    permission: "network.edit",
    operation: saveIpOperation,
    current: (i) => ({ subnetId: i.subnetId, address: i.address, deviceId: i.deviceId, hostname: i.hostname, kind: i.kind, mac: i.mac, notes: i.notes }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  remove: { permission: "network.delete", operation: deleteIpOperation },
});

/* ───────────── Verbindungen ───────────── */

const connectionBody = z.strictObject({
  fromDeviceId: z.string().min(1).max(64),
  fromPort: text(30),
  toDeviceId: z.string().min(1).max(64),
  toPort: text(30),
  cableLabel: text(60),
  notes: text(200),
});
const connectionItem = z.object({
  id: z.string(),
  fromDeviceId: z.string(),
  fromPort: nullableString,
  toDeviceId: z.string(),
  toPort: nullableString,
  cableLabel: nullableString,
  notes: nullableString,
});

export const connectionEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-connections",
  singular: "connection",
  path: "/network-connections",
  read: "network.view",
  model: db.netConnection as unknown as Delegate<NetConnection>,
  item: connectionItem,
  toItem: (c): z.input<typeof connectionItem> => ({ id: c.id, fromDeviceId: c.fromDeviceId, fromPort: c.fromPort, toDeviceId: c.toDeviceId, toPort: c.toPort, cableLabel: c.cableLabel, notes: c.notes }),
  list: {
    filters: z.strictObject({ deviceId: z.string().max(64).optional() }),
    where: ({ deviceId }) => (deviceId ? { OR: [{ fromDeviceId: deviceId }, { toDeviceId: deviceId }] } : {}),
    sorts: { cableLabel: (dir) => ({ cableLabel: dir }) },
    defaultSort: [{ key: "cableLabel", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveConnectionOperation, body: connectionBody, toInput: (b) => b },
  remove: { permission: "network.delete", operation: deleteConnectionOperation },
});

/* ───────────── Überwachung (nur lesend) ───────────── */

/**
 * `GET /network-status` und `GET /network-status-events`: der **gemessene** Zustand der Überwachungsziele und ihre Ausfälle. Nur lesend und nur mit `network.view` – Ziele anzulegen oder zu ändern ist eine Handlung
 * mit dem gekennzeichneten Recht `network.monitor`, das kein Token tragen darf (`API_NEVER`; Begründung in `api-exceptions.ts`). Die Antwort enthält nie Host, Port, Pfad oder Antworttexte, nur Bezeichnung, Gerät,
 * Zustand, Latenz, Ergebnisklasse und Zeitpunkte. **Ist die Überwachung ausgeschaltet, liefert die API keine Ziele** (es gibt nichts Gemessenes); eine veraltete Messung steht als `unknown` mit `stale: true`.
 */
const statusItem = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(MONITOR_KINDS),
  deviceId: nullableString,
  state: z.enum(["up", "warn", "down", "unknown"]),
  stale: z.boolean(),
  latencyMs: z.number().int().nullable(),
  resultClass: nullableString,
  lastCheckAt: nullableString,
  stateSince: nullableString,
  intervalSeconds: z.number().int(),
});
const statusSelect = { id: true, name: true, kind: true, deviceId: true, state: true, lastCheckAt: true, stateSince: true, lastLatencyMs: true, lastClass: true, intervalSec: true } as const;
type StatusRow = Pick<NetMonitorTarget, keyof typeof statusSelect>;

export const statusEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-status",
  singular: "monitoring target status",
  path: "/network-status",
  read: "network.view",
  model: db.netMonitorTarget as unknown as Delegate<StatusRow>,
  select: statusSelect,
  scope: async () => ((await isMonitoringEnabled()) ? { enabled: true } : { AND: [{ enabled: true }, { enabled: false }] }),
  item: statusItem,
  toItem: (t): z.input<typeof statusItem> => {
    const view = viewOf(t, new Date());
    return {
      id: t.id,
      name: t.name,
      kind: oneOf(MONITOR_KINDS, t.kind, "tcp"),
      deviceId: t.deviceId,
      state: view.state,
      stale: view.stale,
      latencyMs: t.lastLatencyMs,
      resultClass: t.lastClass,
      lastCheckAt: t.lastCheckAt ? iso(t.lastCheckAt) : null,
      stateSince: t.stateSince ? iso(t.stateSince) : null,
      intervalSeconds: t.intervalSec,
    };
  },
  list: {
    filters: z.strictObject({ deviceId: z.string().max(64).optional(), state: z.enum(["up", "warn", "down", "unknown"]).optional() }),
    where: ({ deviceId, state }) => ({ ...(deviceId ? { deviceId } : {}), ...(state ? { state } : {}) }),
    sorts: { name: (dir) => ({ name: dir }) },
    defaultSort: [{ key: "name", dir: "asc" }],
  },
});

const eventItem = z.object({ id: z.string(), targetId: z.string(), at: z.string(), kind: z.enum(["down", "up"]), downSeconds: z.number().int().nullable() });
type EventRow = { id: string; targetId: string; at: Date; kind: string; downSeconds: number | null };

export const statusEventEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-status-events",
  singular: "monitoring event",
  path: "/network-status-events",
  read: "network.view",
  model: db.netMonitorEvent as unknown as Delegate<EventRow>,
  scope: async () => ((await isMonitoringEnabled()) ? {} : { AND: [{ kind: "down" }, { kind: "up" }] }),
  item: eventItem,
  toItem: (e): z.input<typeof eventItem> => ({ id: e.id, targetId: e.targetId, at: iso(e.at), kind: e.kind === "up" ? "up" : "down", downSeconds: e.downSeconds }),
  list: {
    filters: z.strictObject({ targetId: z.string().max(64).optional(), kind: z.enum(["down", "up"]).optional() }),
    where: ({ targetId, kind }) => ({ ...(targetId ? { targetId } : {}), ...(kind ? { kind } : {}) }),
    sorts: { at: (dir) => ({ at: dir }) },
    defaultSort: [{ key: "at", dir: "desc" }],
  },
});

export const endpoints = [...deviceEndpoints, ...locationEndpoints, ...vlanEndpoints, ...subnetEndpoints, ...ipEndpoints, ...connectionEndpoints, ...statusEndpoints, ...statusEventEndpoints];

