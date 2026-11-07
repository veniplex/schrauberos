import type { StatusTone } from "@/lib/status-tone";
import type { MovementKind } from "./constants";

/** Art der Bewegung → Ton: Zugang grün, Abgang blau, Korrektur gelb (Aufmerksamkeit), Rückbuchung grau. */
export const MOVEMENT_TONE: Record<MovementKind, StatusTone> = { receipt: "success", order: "info", correction: "warning", reversal: "neutral" };

/** Bestandszustand eines Artikels: negativ (rot), unter Mindestbestand (gelb), in Ordnung (grün). */
export const STOCK_TONE: Record<"negative" | "low" | "ok", StatusTone> = { negative: "danger", low: "warning", ok: "success" };
