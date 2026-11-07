import { defineFeature } from "@/modules/define";

export const networkFeature = defineFeature({
  id: "network",
  module: "it",
  nameKey: "network.feature.name",
  descriptionKey: "network.feature.description",
  order: 60,
  permissions: { group: "network", keys: ["network.view", "network.edit", "network.delete"] },
  nav: [
    { id: "network", href: "/network", labelKey: "nav.network", icon: "network", permission: "network.view", order: 60 },
    { id: "network-devices", href: "/network/devices", labelKey: "nav.devices", icon: "server", permission: "network.view", order: 61 },
    { id: "network-ip", href: "/network/ip", labelKey: "nav.ipam", icon: "ip", permission: "network.view", order: 62 },
    { id: "network-cabling", href: "/network/cabling", labelKey: "nav.cabling", icon: "cabling", permission: "network.view", order: 63 },
  ],
  quickActions: [{ id: "network.newDevice", labelKey: "network.quick.newDevice", href: "/network/devices/new", icon: "server", permission: "network.edit", order: 70 }],
  routes: ["network"],
});
