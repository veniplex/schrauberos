import type { StatusTone } from "@/lib/status-tone";
import type { FleetStatus } from "./domain";

export const FLEET_STATUS_TONE: Record<FleetStatus, StatusTone> = { active: "success", in_service: "warning", reserve: "neutral", sold: "neutral" };
