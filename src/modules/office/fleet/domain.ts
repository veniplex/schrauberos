import { dueState, type DueState } from "@/lib/due";
import { addMonths, dayKey } from "@/lib/zone";

export const FLEET_STATUSES = ["active", "in_service", "reserve", "sold"] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];

export const FUEL_TYPES = ["petrol", "diesel", "electric", "hybrid", "other"] as const;
export const COST_CATEGORIES = ["fuel", "service", "repair", "tires", "tax", "insurance", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Führerscheinkontrolle: Halter müssen sie regelmäßig durchführen (üblich: halbjährlich). */
export const LICENSE_CHECK_MONTHS = 6;
export const nextLicenseCheck = (checkedAt: Date) => addMonths(checkedAt, LICENSE_CHECK_MONTHS);

/** Wie früh vor der Fälligkeit gewarnt wird (Tage). */
export const FLEET_WARN_DAYS = 60;
/** Wartung nach Kilometerstand: Warnung, wenn weniger als so viele km übrig sind. */
export const SERVICE_WARN_KM = 1500;

export type FleetDueKind = "hu" | "service" | "serviceKm" | "insurance" | "leasing";

export type FleetDue = {
  kind: FleetDueKind;
  /** Fälligkeitsdatum (bei serviceKm nicht gesetzt) */
  date: Date | null;
  /** Verbleibende Kilometer (nur serviceKm; negativ = überschritten) */
  kmLeft: number | null;
  state: DueState;
};

/** Alle Fälligkeiten eines Firmenfahrzeugs, die abgelaufen sind oder bald ablaufen (sortiert: dringendste zuerst). */
export function fleetDues(
  v: { huDue: Date | null; serviceDue: Date | null; serviceDueKm: number | null; insuranceUntil: Date | null; leasingUntil: Date | null },
  currentKm: number | null,
  now = new Date(),
): FleetDue[] {
  const out: FleetDue[] = [];
  const dated: Array<[FleetDueKind, Date | null]> = [
    ["hu", v.huDue],
    ["service", v.serviceDue],
    ["insurance", v.insuranceUntil],
    ["leasing", v.leasingUntil],
  ];
  for (const [kind, date] of dated) {
    const state = dueState(date, FLEET_WARN_DAYS, now);
    if (date && state && state !== "ok") out.push({ kind, date, kmLeft: null, state });
  }
  if (v.serviceDueKm != null && currentKm != null) {
    const left = v.serviceDueKm - currentKm;
    if (left <= SERVICE_WARN_KM) out.push({ kind: "serviceKm", date: null, kmLeft: left, state: left < 0 ? "expired" : "soon" });
  }
  return out.sort((a, b) => (a.state === b.state ? (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) : a.state === "expired" ? -1 : 1));
}

/**
 * Der **Kostenzeitraum** der Kosten pro Kilometer: vom Tag des ersten bis zum Tag des letzten erfassten Kilometerstands (nach Datum, nicht nach Höhe), mit den dabei gefahrenen Kilometern.
 * Nur innerhalb dieses Zeitraums sind Kosten und Kilometer vergleichbar – Kosten davor (etwa die Anschaffung) oder danach gehören nicht zu den erfassten Kilometern. Kein Zeitraum (`null`),
 * wenn weniger als zwei Stände an verschiedenen Tagen vorliegen oder nichts gefahren wurde.
 */
export type CostPeriod = { from: Date; to: Date; km: number };

export function costPeriod(mileage: ReadonlyArray<{ date: Date; km: number }>): CostPeriod | null {
  if (mileage.length < 2) return null;
  const sorted = [...mileage].sort((a, b) => a.date.getTime() - b.date.getTime() || a.km - b.km);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const km = last.km - first.km;
  return dayKey(first.date) !== dayKey(last.date) && km > 0 ? { from: first.date, to: last.date, km } : null;
}

/** Liegt der Tag der Kosten im Zeitraum (beide Tage eingeschlossen, Kalendertage der Werkstatt)? */
export function inCostPeriod(date: Date, period: CostPeriod): boolean {
  const day = dayKey(date);
  return day >= dayKey(period.from) && day <= dayKey(period.to);
}

/** Summe der Kosten im Zeitraum. */
export function costsInPeriod(costs: ReadonlyArray<{ date: Date; amountCents: number }>, period: CostPeriod): number {
  return costs.filter((c) => inCostPeriod(c.date, period)).reduce((sum, c) => sum + c.amountCents, 0);
}

/** Kosten pro Kilometer: nur die Kosten **im Kostenzeitraum** geteilt durch die Kilometer **im selben Zeitraum** (null ohne Zeitraum). */
export function costPerKm(costs: ReadonlyArray<{ date: Date; amountCents: number }>, period: CostPeriod | null): number | null {
  return period ? costsInPeriod(costs, period) / period.km : null;
}

/** Aktueller Kilometerstand = höchster erfasster Wert. */
export function currentMileage(mileage: Array<{ km: number }>): number | null {
  return mileage.length ? Math.max(...mileage.map((m) => m.km)) : null;
}

/**
 * Löschschutz (Z7): Ein Firmenfahrzeug mit Kilometerständen oder Kosten ist **nicht löschbar** (Historie; im Schema `Restrict`) – es wird auf „Verkauft“ gesetzt. Ein versehentlich angelegtes
 * Fahrzeug ohne Verlauf lässt sich löschen.
 */
export type FleetDeletionDeps = { mileage: number; costs: number };

export const fleetVehicleDeletable = (deps: FleetDeletionDeps): boolean => deps.mileage === 0 && deps.costs === 0;
