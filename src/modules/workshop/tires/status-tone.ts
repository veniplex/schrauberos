import type { StatusTone } from "@/lib/status-tone";
import type { TireSeason, TireSetStatus } from "./constants";
import type { Health } from "./domain";

/** Reifenzustand (aus Profil, Alter, Zustand berechnet). */
export const HEALTH_TONE: Record<Health, StatusTone> = { ok: "success", warn: "warning", replace: "danger", unknown: "neutral" };
export const SEASON_TONE: Record<TireSeason, StatusTone> = { summer: "warning", winter: "info", allseason: "neutral" };
export const TIRE_SET_STATUS_TONE: Record<TireSetStatus, StatusTone> = { stored: "info", mounted: "neutral", disposed: "neutral" };
