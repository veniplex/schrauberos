import type { OrderStatus } from "./constants";

/**
 * Erlaubte Schritte der Statuskette (ohne „Abgeholt“, das nur `orders.close` setzt, und ohne „Wieder öffnen“, das nur `orders.reopen` kann).
 * Zurück ist erlaubt (versehentlich „Fertig“ gedrückt); ein stornierter Auftrag lässt sich wieder aufnehmen.
 */
export const STATUS_STEPS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  accepted: ["in_progress", "ready", "cancelled"],
  in_progress: ["accepted", "ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  picked_up: [],
  cancelled: ["accepted"],
};

export const canStep = (from: string, to: string): boolean => (STATUS_STEPS[from as OrderStatus] ?? []).includes(to as OrderStatus);

/** Aus diesen Zuständen lässt sich der Auftrag abschließen („Abgeholt“). */
export const CLOSABLE: readonly OrderStatus[] = ["in_progress", "ready"];

/** Ein offener Auftrag lässt sich bearbeiten (Positionen, Befunde, Freigaben); abgeschlossen oder storniert nicht. */
export const isOpen = (status: string): boolean => status === "accepted" || status === "in_progress" || status === "ready";

/** Auftragsnummer `A-JJJJ-NNNN` (mindestens vier Stellen; darüber wächst sie, ohne abzuschneiden). */
export function formatOrderNumber(year: number, value: number): string {
  return `A-${year}-${String(value).padStart(4, "0")}`;
}

/**
 * Kilometerstand bei Annahme gegen den Stand des Fahrzeugs: `write` = höher (oder noch keiner) → ins Fahrzeug schreiben; `keep` = niedriger oder gleich → Fahrzeug bleibt,
 * der Auftrag behält seinen Wert (Hinweis, kein Fehler: der Tacho kann getauscht oder falsch abgelesen worden sein).
 */
export function mileageDecision(vehicleKm: number | null, orderKm: number | null | undefined): "none" | "write" | "keep" {
  if (orderKm == null) return "none";
  if (vehicleKm == null || orderKm > vehicleKm) return "write";
  return orderKm === vehicleKm ? "none" : "keep";
}

/** Name zum Vergleichen: Unicode-Normalform (NFKC), Leerraum zusammengefasst und getrimmt, Groß-/Kleinschreibung egal. */
export const nameKey = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** Ist der getippte Name der freigebenden Person der Name im Feld „freigebende Person“? (Das Tippen des Namens ersetzt die Unterschrift – es muss dieselbe Person meinen.) */
export const sameName = (typed: string, approver: string): boolean => nameKey(typed) !== "" && nameKey(typed) === nameKey(approver);
