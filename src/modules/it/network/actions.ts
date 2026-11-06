"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject, safeReturn } from "@/lib/forms";
import { DEVICE_STATUSES, DEVICE_TYPES, IP_KINDS } from "@/modules/it/network/constants";
import { formatIPv4, ipInCidr, normalizeMac, parseCidr, parseIPv4 } from "@/modules/it/network/domain";
import { audit } from "@/server/audit";

function refresh(...extra: string[]) {
  for (const p of ["/network", "/network/devices", "/network/ip", "/network/cabling", "/", ...extra]) revalidatePath(p);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

/* ───────────── Geräte ───────────── */

const deviceSchema = z.object({
  id: z.string().optional(),
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
  notes: z.string().max(2000).optional(),
});

export async function saveDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("network.edit");
  const { t } = await getI18n();
  const parsed = deviceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, purchaseDate, warrantyUntil, ...d } = parsed.data;

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
    monitorEnabled: formData.get("monitorEnabled") === "on",
    notes: d.notes ?? null,
  };
  const saved = id ? await db.netDevice.update({ where: { id }, data }) : await db.netDevice.create({ data });

  refresh();
  redirect(`/network/devices/${saved.id}`);
}

export async function deleteDevice(formData: FormData) {
  await requirePermission("network.delete");
  const id = String(formData.get("id") ?? "");
  const device = id ? await db.netDevice.findUnique({ where: { id }, select: { name: true } }) : null;
  if (id) await db.netDevice.deleteMany({ where: { id } });
  if (device) await audit("network.delete", { target: device.name, entityId: id });
  refresh();
  redirect("/network/devices");
}

/* ───────────── VLANs ───────────── */

const vlanSchema = z.object({
  id: z.string().optional(),
  vlanId: z.coerce.number().int().min(1).max(4094),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200).optional(),
});

export async function saveVlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("network.edit");
  const { t } = await getI18n();
  const parsed = vlanSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, ...d } = parsed.data;

  const dup = await db.netVlan.findFirst({ where: { vlanId: d.vlanId, ...(id ? { id: { not: id } } : {}) } });
  if (dup) return { fieldErrors: { vlanId: t("network.errors.vlanExists") } };

  const data = { vlanId: d.vlanId, name: d.name, description: d.description ?? null };
  if (id) await db.netVlan.update({ where: { id }, data });
  else await db.netVlan.create({ data });
  refresh();
  return { ok: true, message: t("common.saved") };
}

export async function deleteVlan(formData: FormData) {
  await requirePermission("network.delete");
  const id = String(formData.get("id") ?? "");
  if (id) await db.netVlan.deleteMany({ where: { id } });
  refresh();
}

/* ───────────── Subnetze ───────────── */

const subnetSchema = z.object({
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

export async function saveSubnet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("network.edit");
  const { t } = await getI18n();
  const parsed = subnetSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, ...d } = parsed.data;

  const net = parseCidr(d.cidr);
  if (!net) return { fieldErrors: { cidr: t("network.errors.cidr") } };
  const cidr = `${formatIPv4(net.network)}/${net.prefix}`;

  const errors: Record<string, string> = {};
  const inside = (value: string | undefined, key: string) => {
    if (value && !ipInCidr(value, cidr)) errors[key] = t("network.errors.notInSubnet");
  };
  inside(d.gateway, "gateway");
  inside(d.dhcpStart, "dhcpStart");
  inside(d.dhcpEnd, "dhcpEnd");
  if (d.dhcpStart && d.dhcpEnd && !errors.dhcpStart && !errors.dhcpEnd && parseIPv4(d.dhcpStart)! > parseIPv4(d.dhcpEnd)!) {
    errors.dhcpEnd = t("network.errors.dhcpOrder");
  }
  const dns = (d.dnsServers ?? "").split(/[,;\s]+/).filter(Boolean);
  if (dns.some((x) => parseIPv4(x) === null)) errors.dnsServers = t("network.errors.dns");
  if (Object.keys(errors).length) return { fieldErrors: errors };

  const dup = await db.netSubnet.findFirst({ where: { cidr, ...(id ? { id: { not: id } } : {}) } });
  if (dup) return { fieldErrors: { cidr: t("network.errors.subnetExists") } };

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
  const saved = id ? await db.netSubnet.update({ where: { id }, data }) : await db.netSubnet.create({ data });
  refresh();
  redirect(`/network/ip/${saved.id}`);
}

export async function deleteSubnet(formData: FormData) {
  await requirePermission("network.delete");
  const id = String(formData.get("id") ?? "");
  if (id) await db.netSubnet.deleteMany({ where: { id } });
  refresh();
  redirect("/network/ip");
}

/* ───────────── IP-Adressen ───────────── */

const ipSchema = z.object({
  id: z.string().optional(),
  subnetId: z.string(),
  address: z.string().max(15),
  deviceId: z.string().optional(),
  hostname: z.string().max(100).optional(),
  kind: z.enum(IP_KINDS).default("static"),
  mac: z.string().max(30).optional(),
  notes: z.string().max(300).optional(),
  returnTo: z.string().optional(),
});

export async function saveIp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("network.edit");
  const { t } = await getI18n();
  const parsed = ipSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, returnTo, ...d } = parsed.data;

  const subnet = await db.netSubnet.findUnique({ where: { id: d.subnetId } });
  if (!subnet) return { error: t("validation.invalid") };
  if (parseIPv4(d.address) === null) return { fieldErrors: { address: t("network.errors.ip") } };
  if (!ipInCidr(d.address, subnet.cidr)) return { fieldErrors: { address: t("network.errors.notInSubnet") } };

  const address = formatIPv4(parseIPv4(d.address)!);
  const dup = await db.netIp.findFirst({ where: { address, ...(id ? { id: { not: id } } : {}) }, include: { device: true } });
  if (dup) return { fieldErrors: { address: t("network.errors.ipTaken", { who: dup.device?.name ?? dup.hostname ?? "–" }) } };

  let mac: string | null = null;
  if (d.mac) {
    mac = normalizeMac(d.mac);
    if (!mac) return { fieldErrors: { mac: t("network.errors.mac") } };
  }

  const data = {
    address,
    subnetId: subnet.id,
    deviceId: d.deviceId ?? null,
    hostname: d.hostname ?? null,
    kind: d.kind,
    mac,
    notes: d.notes ?? null,
  };
  if (id) await db.netIp.update({ where: { id }, data });
  else await db.netIp.create({ data });
  refresh();
  redirect(safeReturn(returnTo, "/network/ip", `/network/ip/${subnet.id}`));
}

export async function deleteIp(formData: FormData) {
  await requirePermission("network.delete");
  const id = String(formData.get("id") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""), "/network/ip", "/network/ip");
  if (id) await db.netIp.deleteMany({ where: { id } });
  refresh();
  redirect(returnTo);
}

/* ───────────── Standorte/Räume ───────────── */

const locationSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function saveLocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("network.edit");
  const { t } = await getI18n();
  const parsed = locationSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const { id, ...d } = parsed.data;
  const data = { name: d.name, description: d.description ?? null, sortOrder: d.sortOrder };
  if (id) await db.netLocation.update({ where: { id }, data });
  else await db.netLocation.create({ data });
  refresh();
  return { ok: true, message: t("common.saved") };
}

export async function deleteLocation(formData: FormData) {
  await requirePermission("network.delete");
  const id = String(formData.get("id") ?? "");
  if (id) await db.netLocation.deleteMany({ where: { id } });
  refresh();
}

/* ───────────── Verbindungen (Kabel) ───────────── */

const connectionSchema = z.object({
  fromDeviceId: z.string().min(1),
  fromPort: z.string().max(30).optional(),
  toDeviceId: z.string().min(1),
  toPort: z.string().max(30).optional(),
  cableLabel: z.string().max(60).optional(),
  notes: z.string().max(200).optional(),
});

/** Ist der Port am Gerät schon durch ein anderes Kabel belegt? */
async function portBusy(deviceId: string, port: string | undefined) {
  if (!port) return false;
  const n = await db.netConnection.count({
    where: { OR: [{ fromDeviceId: deviceId, fromPort: port }, { toDeviceId: deviceId, toPort: port }] },
  });
  return n > 0;
}

export async function saveConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("network.edit");
  const { t } = await getI18n();
  const parsed = connectionSchema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  if (d.fromDeviceId === d.toDeviceId) return { fieldErrors: { toDeviceId: t("network.errors.sameDevice") } };
  if (await portBusy(d.fromDeviceId, d.fromPort)) return { fieldErrors: { fromPort: t("network.errors.portBusy") } };
  if (await portBusy(d.toDeviceId, d.toPort)) return { fieldErrors: { toPort: t("network.errors.portBusy") } };

  await db.netConnection.create({
    data: {
      fromDeviceId: d.fromDeviceId,
      fromPort: d.fromPort ?? null,
      toDeviceId: d.toDeviceId,
      toPort: d.toPort ?? null,
      cableLabel: d.cableLabel ?? null,
      notes: d.notes ?? null,
    },
  });
  refresh();
  return { ok: true, message: t("common.saved") };
}

export async function deleteConnection(formData: FormData) {
  await requirePermission("network.delete");
  const id = String(formData.get("id") ?? "");
  if (id) await db.netConnection.deleteMany({ where: { id } });
  refresh();
}
