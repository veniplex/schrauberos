import type { StatusTone } from "@/lib/status-tone";

export type DueState = "expired" | "soon" | "ok";

/** Fälligkeit: abgelaufen, läuft in den nächsten `soonDays` Tagen ab, oder in Ordnung. null = kein Datum. */
export function dueState(until: Date | null | undefined, soonDays = 60, now = new Date()): DueState | null {
  if (!until) return null;
  const days = (until.getTime() - now.getTime()) / 86_400_000;
  return days < 0 ? "expired" : days <= soonDays ? "soon" : "ok";
}

/** Fälligkeits-Zustand -> Badge-Farbe. */
export const DUE_TONE: Record<DueState, StatusTone> = { expired: "danger", soon: "warning", ok: "neutral" };
