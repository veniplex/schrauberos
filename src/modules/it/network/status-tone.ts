import type { StatusTone } from "@/lib/status-tone";
import type { DeviceStatus, IpKind } from "./constants";
import type { LinkState } from "./monitoring";

export const LINK_STATE_TONE: Record<LinkState, StatusTone> = { online: "success", degraded: "warning", offline: "danger", unknown: "neutral" };
export const DEVICE_STATUS_TONE: Record<DeviceStatus, StatusTone> = { active: "success", planned: "info", spare: "neutral", retired: "neutral" };
export const IP_KIND_TONE: Record<IpKind, StatusTone> = { static: "neutral", dhcp_reservation: "neutral", reserved: "neutral", gateway: "accent" };
