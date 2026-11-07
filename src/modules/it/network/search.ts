import "server-only";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import type { SearchProviderDef } from "@/modules/types";

/** Schnellsuche: Geräte (Name, Hersteller, Modell, Seriennummer, Zuordnung) und IP-Adressen (Adresse, Hostname, MAC). */
export const searchProviders: SearchProviderDef[] = [
  {
    id: "network.devices",
    feature: "it.network",
    permission: "network.view",
    groupKey: "network.search.devices",
    order: 70,
    async search(q, { limit }) {
      const rows = await db.netDevice.findMany({
        where: { OR: [{ name: contains(q) }, { manufacturer: contains(q) }, { model: contains(q) }, { serialNumber: contains(q) }, { assignedTo: contains(q) }] },
        orderBy: { name: "asc" },
        take: limit,
        select: { id: true, name: true, manufacturer: true, model: true },
      });
      return rows.map((d) => ({ id: d.id, title: d.name, subtitle: [d.manufacturer, d.model].filter(Boolean).join(" ") || undefined, href: `/network/devices/${d.id}` }));
    },
  },
  {
    id: "network.ips",
    feature: "it.network",
    permission: "network.view",
    groupKey: "network.search.ips",
    order: 71,
    async search(q, { limit }) {
      const rows = await db.netIp.findMany({
        where: { OR: [{ address: contains(q) }, { hostname: contains(q) }, { mac: contains(q) }] },
        orderBy: { address: "asc" },
        take: limit,
        select: { id: true, address: true, hostname: true, subnetId: true },
      });
      return rows.map((i) => ({ id: i.id, title: i.address, subtitle: i.hostname ?? undefined, href: `/network/ip/${i.subnetId}?edit=${i.id}` }));
    },
  },
];
