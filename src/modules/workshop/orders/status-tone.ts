import type { StatusTone } from "@/lib/status-tone";
import type { OrderStatus } from "./constants";

/** Zustand → Ton der `StatusBadge`: blau = in Arbeit, gelb = wartet auf Abholung, grün = abgeschlossen, grau = neutral/storniert. */
export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  accepted: "neutral",
  in_progress: "info",
  ready: "warning",
  picked_up: "success",
  cancelled: "neutral",
};
