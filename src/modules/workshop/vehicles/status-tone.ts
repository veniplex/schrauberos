import type { StatusTone } from "@/lib/status-tone";
import type { InspectionState } from "./domain";

/** Farbe einer Prüffrist: überfällig rot, im laufenden Monat oder bald gelb, sonst neutral. */
export const INSPECTION_TONE: Record<InspectionState, StatusTone> = { overdue: "danger", thisMonth: "warning", soon: "warning", ok: "neutral" };
