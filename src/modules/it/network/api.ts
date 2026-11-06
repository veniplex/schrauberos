import { z } from "zod";
import type { NetConnection, NetDevice, NetIp, NetLocation, NetSubnet, NetVlan } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { dayOrNull, iso, optionalDate } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
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
 * wie in der Oberfläche (IP im Subnetz, Adresse eindeutig, MAC normalisiert, Port nicht doppelt belegt). Standorte, VLANs, Subnetze und Verbindungen haben keine
 * Version (kein `If-Match`).
 */
const text = (max: number) => z.string().max(max).nullable().optional();
const nullableString = z.string().nullable();
const ref = z.string().max(64).nullable().optional();
const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);

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
const locationItem = z.object({ id: z.string(), name: z.string(), description: nullableString, sortOrder: z.number().int() });

export const locationEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-locations",
  singular: "location",
  path: "/network-locations",
  read: "network.view",
  model: db.netLocation as unknown as Delegate<NetLocation>,
  item: locationItem,
  toItem: (l): z.input<typeof locationItem> => ({ id: l.id, name: l.name, description: l.description, sortOrder: l.sortOrder }),
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
    toInput: (merged, { id }) => ({ ...merged, id }),
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
const vlanItem = z.object({ id: z.string(), number: z.number().int(), name: z.string(), description: nullableString });
const vlanInput = ({ number, ...rest }: Record<string, unknown>): Record<string, unknown> => ({ ...rest, vlanId: number });

export const vlanEndpoints = defineResource({
  feature: "it.network",
  tag: "Network",
  name: "network-vlans",
  singular: "VLAN",
  path: "/network-vlans",
  read: "network.view",
  model: db.netVlan as unknown as Delegate<NetVlan>,
  item: vlanItem,
  toItem: (v): z.input<typeof vlanItem> => ({ id: v.id, number: v.vlanId, name: v.name, description: v.description }),
  list: {
    filters: z.strictObject({}),
    sorts: { number: (dir) => ({ vlanId: dir }), name: (dir) => ({ name: dir }) },
    defaultSort: [{ key: "number", dir: "asc" }],
  },
  create: { permission: "network.edit", operation: saveVlanOperation, body: vlanBody, toInput: vlanInput, rename: { vlanId: "number" } },
  update: {
    permission: "network.edit",
    operation: saveVlanOperation,
    current: (v) => ({ number: v.vlanId, name: v.name, description: v.description }),
    toInput: (merged, { id }) => ({ ...vlanInput(merged), id }),
    rename: { vlanId: "number" },
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
});
const subnetItem = z.object({
  id: z.string(),
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
  toItem: (s): z.input<typeof subnetItem> => ({ id: s.id, name: s.name, cidr: s.cidr, vlanId: s.vlanId, gateway: s.gateway, dnsServers: s.dnsServers, dhcpStart: s.dhcpStart, dhcpEnd: s.dhcpEnd, description: s.description }),
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
    toInput: (merged, { id }) => ({ ...merged, id }),
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

export const endpoints = [...deviceEndpoints, ...locationEndpoints, ...vlanEndpoints, ...subnetEndpoints, ...ipEndpoints, ...connectionEndpoints];
