import { definePages } from "@/modules/types";

/** Seiten dieser Funktion für die Browser-CI (Routen-Inventur, siehe README „Browser-CI“): jede Route mit Recht, Art und Seed-Verweisen. */
export const pages = definePages("it.network", [
  { path: "/network", kind: "other", permission: "network.view" },
  { path: "/network/devices", kind: "list", permission: "network.view" },
  { path: "/network/devices/new", kind: "new", permission: "network.edit" },
  { path: "/network/devices/[id]", kind: "detail", permission: "network.view", params: { id: { table: "NetDevice" } } },
  { path: "/network/devices/[id]/edit", kind: "edit", permission: "network.edit", params: { id: { table: "NetDevice" } } },
  { path: "/network/ip", kind: "list", permission: "network.view" },
  { path: "/network/ip/new", kind: "new", permission: "network.edit" },
  { path: "/network/ip/[subnetId]", kind: "detail", permission: "network.view", params: { subnetId: { table: "NetSubnet" } } },
  { path: "/network/ip/[subnetId]/edit", kind: "edit", permission: "network.edit", params: { subnetId: { table: "NetSubnet" } } },
  { path: "/network/ip/[subnetId]", kind: "modal", permission: "network.edit", params: { subnetId: { table: "NetSubnet" } }, query: "?new=1" },
  { path: "/network/cabling", kind: "other", permission: "network.view" },
]);
