import type { StatusTone } from "@/lib/status-tone";
import type { TireSeason, TireSetStatus } from "./constants";
import type { Health } from "./domain";

/** Reifenzustand (aus Profil, Alter, Zustand berechnet). */
export const HEALTH_TONE: Record<Health, StatusTone> = { ok: "success", warn: "warning", replace: "danger", unknown: "neutral" };
export const SEASON_TONE: Record<TireSeason, StatusTone> = { summer: "warning", winter: "info", allseason: "neutral" };
/** Im Lager = blau (Information), beim Kunden montiert = Akzent (gebucht, nicht mehr im Lager), entsorgt = grau; „falsche Saison“ ist keine Zustandsmarke, sondern ein Hinweis (`WRONG_SEASON_TONE`). */
export const TIRE_SET_STATUS_TONE: Record<TireSetStatus, StatusTone> = { stored: "info", mounted: "accent", disposed: "neutral" };
/** Hinweis „montiert, aber falsche Jahreszeit“ */
export const WRONG_SEASON_TONE: StatusTone = "warning";
