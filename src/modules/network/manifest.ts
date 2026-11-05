import type { ModuleManifest } from "../types";
import { NetworkStatusWidget } from "./widgets";

/** IT & Netzwerk: Inventar, IP-Verwaltung, Verkabelung, (Demo-)Status. */
export const networkModule: ModuleManifest = {
  id: "network",
  nav: [
    { id: "network", href: "/network", labelKey: "nav.network", icon: "network", permission: "network.view", section: "it", order: 60 },
    { id: "network-devices", href: "/network/devices", labelKey: "nav.devices", icon: "server", permission: "network.view", section: "it", order: 61 },
    { id: "network-ip", href: "/network/ip", labelKey: "nav.ipam", icon: "ip", permission: "network.view", section: "it", order: 62 },
    { id: "network-cabling", href: "/network/cabling", labelKey: "nav.cabling", icon: "cabling", permission: "network.view", section: "it", order: 63 },
  ],
  widgets: [{ id: "network-status", permission: "network.view", span: 1, order: 30, Component: NetworkStatusWidget }],
};
