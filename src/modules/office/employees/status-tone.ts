import type { StatusTone } from "@/lib/status-tone";
import type { AbsenceType } from "./domain";

/** Art der Abwesenheit; `masked` = ohne das Recht „Sensible Mitarbeiterdaten“ (der Grund bleibt verborgen). */
export const ABSENCE_TONE: Record<AbsenceType | "masked", StatusTone> = { vacation: "info", sick: "danger", training: "accent", other: "neutral", masked: "neutral" };
