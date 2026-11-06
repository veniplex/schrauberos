import "server-only";
import { db } from "@/server/db";
import { compareIPv4 } from "@/modules/it/network/domain";
import { getStatusProvider, type DeviceCheck } from "./monitoring";

export const deviceInclude = {
  location: true,
  ips: true,
} as const;

export async function listDevices(where: object = {}) {
  const devices = await db.netDevice.findMany({ where, include: deviceInclude, orderBy: { name: "asc" } });
  return devices.map((d) => ({ ...d, ips: [...d.ips].sort((a, b) => compareIPv4(a.address, b.address)) }));
}

export type DeviceRow = Awaited<ReturnType<typeof listDevices>>[number];

/** Erreichbarkeitsstatus für Geräte (aktuell Demo-Werte, siehe monitoring.ts). */
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
