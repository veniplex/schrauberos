import type { StatusTone } from "@/lib/status-tone";
import type { AppointmentStatus } from "./constants";

/** Ton der `StatusBadge` je Terminstatus (typisiert über alle Zustände, geprüft in `status-tone.test.ts`). */
export const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  scheduled: "neutral",
  confirmed: "info",
  in_progress: "accent",
  done: "success",
  cancelled: "danger",
  no_show: "warning",
};
