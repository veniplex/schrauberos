export const DEVICE_TYPES = [
  "server",
  "switch",
  "router",
  "firewall",
  "access_point",
  "patch_panel",
  "workstation",
  "laptop",
  "printer",
  "nas",
  "phone",
  "camera",
  "other",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_STATUSES = ["active", "planned", "spare", "retired"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const IP_KINDS = ["static", "dhcp_reservation", "reserved", "gateway"] as const;
export type IpKind = (typeof IP_KINDS)[number];
