import { defineFeature } from "@/modules/define";

export const networkFeature = defineFeature({
  id: "network",
  module: "it",
  nameKey: "network.feature.name",
  descriptionKey: "network.feature.description",
  order: 60,
  // network.monitor: Überwachungsziele anlegen und ändern (der Server baut Verbindungen ins eigene Netz auf) – gekennzeichnet (Regel 9), in keiner Standardrolle und in keinem API-Token
  permissions: { group: "network", keys: ["network.view", "network.edit", "network.delete", "network.monitor"], marked: { sensitive: ["network.monitor"] } },
  nav: [
    { id: "network", href: "/network", labelKey: "nav.network", icon: "network", permission: "network.view", order: 60 },
    { id: "network-devices", href: "/network/devices", labelKey: "nav.devices", icon: "server", permission: "network.view", order: 61 },
    { id: "network-ip", href: "/network/ip", labelKey: "nav.ipam", icon: "ip", permission: "network.view", order: 62 },
    { id: "network-cabling", href: "/network/cabling", labelKey: "nav.cabling", icon: "cabling", permission: "network.view", order: 63 },
    { id: "network-monitoring", href: "/network/monitoring", labelKey: "nav.monitoring", icon: "network", permission: "network.view", order: 63.5 },
  ],
  quickActions: [{ id: "network.newDevice", labelKey: "network.quick.newDevice", href: "/network/devices/new", icon: "server", permission: "network.edit", order: 70 }],
  routes: ["network"],
  auditActions: ["network.create", "network.update", "network.delete", "network.monitorCreate", "network.monitorUpdate", "network.monitorDelete", "network.monitorSwitch"],
});
