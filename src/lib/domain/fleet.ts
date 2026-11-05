import { addMonths } from "date-fns";
import { dueState, type DueState } from "./due";

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

/** Kosten pro Kilometer aus Kilometerstand-Verlauf und Kosten (null, wenn nicht berechenbar). */
export function costPerKm(totalCents: number, mileage: Array<{ km: number }>): number | null {
  if (mileage.length < 2) return null;
  const kms = mileage.map((m) => m.km);
  const driven = Math.max(...kms) - Math.min(...kms);
  return driven > 0 ? totalCents / driven : null;
}

/** Aktueller Kilometerstand = höchster erfasster Wert. */
export function currentMileage(mileage: Array<{ km: number }>): number | null {
  return mileage.length ? Math.max(...mileage.map((m) => m.km)) : null;
}
