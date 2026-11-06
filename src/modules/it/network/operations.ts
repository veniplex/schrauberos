import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { DEVICE_STATUSES, DEVICE_TYPES, IP_KINDS } from "@/modules/it/network/constants";
import { formatIPv4, ipInCidr, normalizeMac, parseCidr, parseIPv4 } from "@/modules/it/network/domain";
import { defineOperation, fail, failField, failFields, type FieldMessage, type Tx } from "@/server/operations";

const date = dateText().optional();
const idInput = z.object({ id: z.string().min(1) });

/* ───────────── Geräte ───────────── */

const deviceInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(DEVICE_TYPES),
  status: z.enum(DEVICE_STATUSES).default("active"),
  manufacturer: z.string().max(60).optional(),
  model: z.string().max(80).optional(),
  serialNumber: z.string().max(80).optional(),
  locationId: z.string().optional(),
  rackInfo: z.string().max(80).optional(),
  portCount: z.coerce.number().int().min(1).max(96).optional(),
  assignedTo: z.string().max(80).optional(),
  purchaseDate: date,
  warrantyUntil: date,
  monitorEnabled: z.boolean(),
  notes: z.string().max(2000).optional(),
});

export const saveDeviceOperation = defineOperation({
  name: "network.saveDevice",
  permission: "network.edit",
  input: deviceInput,
  audit: (input) => (input.id ? "network.update" : "network.create"),
  run: async ({ input: { id, version, purchaseDate, warrantyUntil, ...d }, tx, audit }) => {
    if (d.locationId && !(await tx.netLocation.findUnique({ where: { id: d.locationId }, select: { id: true } }))) failField("locationId", "validation.invalid");
    const data = {
      name: d.name,
      type: d.type,
      status: d.status,
      manufacturer: d.manufacturer ?? null,
      model: d.model ?? null,
      serialNumber: d.serialNumber ?? null,
      locationId: d.locationId ?? null,
      rackInfo: d.rackInfo ?? null,
      portCount: d.portCount ?? null,
      assignedTo: d.assignedTo ?? null,
      purchaseDate: purchaseDate ? new Date(`${purchaseDate}T12:00:00`) : null,
      warrantyUntil: warrantyUntil ? new Date(`${warrantyUntil}T12:00:00`) : null,
      monitorEnabled: d.monitorEnabled,
      notes: d.notes ?? null,
    };
    if (id && !(await claimRow(tx.netDevice, id, version))) fail("conflict");
    const saved = id ? await tx.netDevice.update({ where: { id }, data }) : await tx.netDevice.create({ data });
    audit({ target: `device: ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteDeviceOperation = defineOperation({
  name: "network.deleteDevice",
  permission: "network.delete",
  input: idInput,
  audit: "network.delete",
  run: async ({ input, tx, audit }) => {
    const device = await tx.netDevice.findUnique({ where: { id: input.id }, select: { name: true } });
    if (!device) fail("notFound");
    await tx.netDevice.delete({ where: { id: input.id } });
    audit({ target: `device: ${device.name}`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── VLANs ───────────── */

const vlanInput = z.object({
  id: z.string().optional(),
  vlanId: z.coerce.number().int().min(1).max(4094),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200).optional(),
});

export const saveVlanOperation = defineOperation({
  name: "network.saveVlan",
  permission: "network.edit",
  input: vlanInput,
  audit: (input) => (input.id ? "network.update" : "network.create"),
  run: async ({ input: { id, ...d }, tx, audit }) => {
    const dup = await tx.netVlan.findFirst({ where: { vlanId: d.vlanId, ...(id ? { id: { not: id } } : {}) } });
    if (dup) failField("vlanId", "network.errors.vlanExists");
    const data = { vlanId: d.vlanId, name: d.name, description: d.description ?? null };
    const saved = id ? await tx.netVlan.update({ where: { id }, data }) : await tx.netVlan.create({ data });
    audit({ target: `VLAN: ${saved.vlanId} ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteVlanOperation = defineOperation({
  name: "network.deleteVlan",
  permission: "network.delete",
  input: idInput,
  audit: "network.delete",
  run: async ({ input, tx, audit }) => {
    const vlan = await tx.netVlan.findUnique({ where: { id: input.id }, select: { vlanId: true, name: true } });
    if (!vlan) fail("notFound");
    await tx.netVlan.delete({ where: { id: input.id } });
    audit({ target: `VLAN: ${vlan.vlanId} ${vlan.name}`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Subnetze ───────────── */

const subnetInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  cidr: z.string().max(18),
  vlanId: z.string().optional(),
  gateway: z.string().max(15).optional(),
  dnsServers: z.string().max(100).optional(),
  dhcpStart: z.string().max(15).optional(),
  dhcpEnd: z.string().max(15).optional(),
  description: z.string().max(300).optional(),
});

export const saveSubnetOperation = defineOperation({
  name: "network.saveSubnet",
  permission: "network.edit",
  input: subnetInput,
  audit: (input) => (input.id ? "network.update" : "network.create"),
  run: async ({ input: { id, ...d }, tx, audit }) => {
    const net = parseCidr(d.cidr);
    if (!net) failField("cidr", "network.errors.cidr");
    const cidr = `${formatIPv4(net.network)}/${net.prefix}`;

    const errors: Record<string, FieldMessage> = {};
    const inside = (value: string | undefined, key: string) => {
      if (value && !ipInCidr(value, cidr)) errors[key] = { key: "network.errors.notInSubnet" };
    };
    inside(d.gateway, "gateway");
    inside(d.dhcpStart, "dhcpStart");
    inside(d.dhcpEnd, "dhcpEnd");
    if (d.dhcpStart && d.dhcpEnd && !errors.dhcpStart && !errors.dhcpEnd && parseIPv4(d.dhcpStart)! > parseIPv4(d.dhcpEnd)!) errors.dhcpEnd = { key: "network.errors.dhcpOrder" };
    const dns = (d.dnsServers ?? "").split(/[,;\s]+/).filter(Boolean);
    if (dns.some((x) => parseIPv4(x) === null)) errors.dnsServers = { key: "network.errors.dns" };
    if (Object.keys(errors).length) failFields(errors);

    if (d.vlanId && !(await tx.netVlan.findUnique({ where: { id: d.vlanId }, select: { id: true } }))) failField("vlanId", "validation.invalid");
    const dup = await tx.netSubnet.findFirst({ where: { cidr, ...(id ? { id: { not: id } } : {}) } });
    if (dup) failField("cidr", "network.errors.subnetExists");

    const data = {
      name: d.name,
      cidr,
      vlanId: d.vlanId ?? null,
      gateway: d.gateway ?? null,
      dnsServers: dns.length ? dns.join(", ") : null,
      dhcpStart: d.dhcpStart ?? null,
      dhcpEnd: d.dhcpEnd ?? null,
      description: d.description ?? null,
    };
    const saved = id ? await tx.netSubnet.update({ where: { id }, data }) : await tx.netSubnet.create({ data });
    audit({ target: `subnet: ${saved.name} (${saved.cidr})`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteSubnetOperation = defineOperation({
  name: "network.deleteSubnet",
  permission: "network.delete",
  input: idInput,
  audit: "network.delete",
  run: async ({ input, tx, audit }) => {
    const subnet = await tx.netSubnet.findUnique({ where: { id: input.id }, select: { name: true, cidr: true } });
    if (!subnet) fail("notFound");
    await tx.netSubnet.delete({ where: { id: input.id } });
    audit({ target: `subnet: ${subnet.name} (${subnet.cidr})`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── IP-Adressen ───────────── */

const ipInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  subnetId: z.string(),
  address: z.string().max(15),
  deviceId: z.string().optional(),
  hostname: z.string().max(100).optional(),
  kind: z.enum(IP_KINDS).default("static"),
  mac: z.string().max(30).optional(),
  notes: z.string().max(300).optional(),
  returnTo: z.string().optional(),
});

export const saveIpOperation = defineOperation({
  name: "network.saveIp",
  permission: "network.edit",
  input: ipInput,
  audit: (input) => (input.id ? "network.update" : "network.create"),
  run: async ({ input: { id, version, ...d }, tx, audit }) => {
    const subnet = await tx.netSubnet.findUnique({ where: { id: d.subnetId } });
    if (!subnet) fail("invalid", "validation.invalid");
    const parsed = parseIPv4(d.address);
    if (parsed === null) failField("address", "network.errors.ip");
    if (!ipInCidr(d.address, subnet.cidr)) failField("address", "network.errors.notInSubnet");

    const address = formatIPv4(parsed);
    const dup = await tx.netIp.findFirst({ where: { address, ...(id ? { id: { not: id } } : {}) }, include: { device: true } });
    if (dup) failField("address", "network.errors.ipTaken", { who: dup.device?.name ?? dup.hostname ?? "–" });

    let mac: string | null = null;
    if (d.mac) {
      mac = normalizeMac(d.mac);
      if (!mac) failField("mac", "network.errors.mac");
    }
    if (d.deviceId && !(await tx.netDevice.findUnique({ where: { id: d.deviceId }, select: { id: true } }))) failField("deviceId", "validation.invalid");

    const data = { address, subnetId: subnet.id, deviceId: d.deviceId ?? null, hostname: d.hostname ?? null, kind: d.kind, mac, notes: d.notes ?? null };
    if (id && !(await claimRow(tx.netIp, id, version))) fail("conflict");
    const saved = id ? await tx.netIp.update({ where: { id }, data }) : await tx.netIp.create({ data });
    audit({ target: `IP: ${saved.address}`, entityId: saved.id });
    return { id: saved.id, subnetId: subnet.id };
  },
});

export const deleteIpOperation = defineOperation({
  name: "network.deleteIp",
  permission: "network.delete",
  input: z.object({ id: z.string().min(1), returnTo: z.string().optional() }),
  audit: "network.delete",
  run: async ({ input, tx, audit }) => {
    const ip = await tx.netIp.findUnique({ where: { id: input.id }, select: { address: true } });
    if (!ip) fail("notFound");
    await tx.netIp.delete({ where: { id: input.id } });
    audit({ target: `IP: ${ip.address}`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Standorte/Räume ───────────── */

const locationInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const saveLocationOperation = defineOperation({
  name: "network.saveLocation",
  permission: "network.edit",
  input: locationInput,
  audit: (input) => (input.id ? "network.update" : "network.create"),
  run: async ({ input: { id, ...d }, tx, audit }) => {
    const data = { name: d.name, description: d.description ?? null, sortOrder: d.sortOrder };
    const saved = id ? await tx.netLocation.update({ where: { id }, data }) : await tx.netLocation.create({ data });
    audit({ target: `location: ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteLocationOperation = defineOperation({
  name: "network.deleteLocation",
  permission: "network.delete",
  input: idInput,
  audit: "network.delete",
  run: async ({ input, tx, audit }) => {
    const location = await tx.netLocation.findUnique({ where: { id: input.id }, select: { name: true } });
    if (!location) fail("notFound");
    await tx.netLocation.delete({ where: { id: input.id } });
    audit({ target: `location: ${location.name}`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Verbindungen (Kabel) ───────────── */

const connectionInput = z.object({
  fromDeviceId: z.string().min(1),
  fromPort: z.string().max(30).optional(),
  toDeviceId: z.string().min(1),
  toPort: z.string().max(30).optional(),
  cableLabel: z.string().max(60).optional(),
  notes: z.string().max(200).optional(),
});

/** Ist der Port am Gerät schon durch ein anderes Kabel belegt? */
async function portBusy(tx: Tx, deviceId: string, port: string | undefined): Promise<boolean> {
  if (!port) return false;
  const n = await tx.netConnection.count({ where: { OR: [{ fromDeviceId: deviceId, fromPort: port }, { toDeviceId: deviceId, toPort: port }] } });
  return n > 0;
}

export const saveConnectionOperation = defineOperation({
  name: "network.saveConnection",
  permission: "network.edit",
  input: connectionInput,
  audit: "network.create",
  run: async ({ input: d, tx, audit }) => {
    if (d.fromDeviceId === d.toDeviceId) failField("toDeviceId", "network.errors.sameDevice");
    const [from, to] = await Promise.all([
      tx.netDevice.findUnique({ where: { id: d.fromDeviceId }, select: { name: true } }),
      tx.netDevice.findUnique({ where: { id: d.toDeviceId }, select: { name: true } }),
    ]);
    if (!from) failField("fromDeviceId", "validation.invalid");
    if (!to) failField("toDeviceId", "validation.invalid");
    if (await portBusy(tx, d.fromDeviceId, d.fromPort)) failField("fromPort", "network.errors.portBusy");
    if (await portBusy(tx, d.toDeviceId, d.toPort)) failField("toPort", "network.errors.portBusy");

    const row = await tx.netConnection.create({
      data: { fromDeviceId: d.fromDeviceId, fromPort: d.fromPort ?? null, toDeviceId: d.toDeviceId, toPort: d.toPort ?? null, cableLabel: d.cableLabel ?? null, notes: d.notes ?? null },
    });
    audit({ target: `connection: ${from.name} – ${to.name}`, entityId: row.id });
    return { id: row.id };
  },
});

export const deleteConnectionOperation = defineOperation({
  name: "network.deleteConnection",
  permission: "network.delete",
  input: idInput,
  audit: "network.delete",
  run: async ({ input, tx, audit }) => {
    const row = await tx.netConnection.findUnique({ where: { id: input.id }, include: { from: { select: { name: true } }, to: { select: { name: true } } } });
    if (!row) fail("notFound");
    await tx.netConnection.delete({ where: { id: input.id } });
    audit({ target: `connection: ${row.from.name} – ${row.to.name}`, entityId: input.id });
    return { id: input.id };
  },
});

