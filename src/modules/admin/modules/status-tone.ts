import type { StatusTone } from "@/lib/status-tone";

/** Zustand einer Funktion auf der Seite „Module & Funktionen“ (`featureStatus`). */
export const FEATURE_STATE_TONE: Record<"on" | "off" | "module-off" | "blocked", StatusTone> = { on: "success", off: "neutral", "module-off": "neutral", blocked: "warning" };
