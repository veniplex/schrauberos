import { isMonth, monthsBetween, monthOf } from "@/lib/month";

/**
 * Fachlogik der Fahrzeuge (rein, ohne Datenbank und Uhr): Kraftstoffarten, weitere Prüfungen, Schlüsselnummern und die Prüffrist (HU) als **Monat**.
 *
 * Die Prüffrist heißt neutral „Hauptuntersuchung/Prüfung fällig“ (`inspectionDue`, „JJJJ-MM“): Gemeint ist die nächste wiederkehrende Hauptprüfung – in Deutschland die HU, in Österreich
 * das „Pickerl“, in der Schweiz die MFK. Ein Monat genügt (Plakette/Pickerl gelten bis Monatsende). Daneben kann **eine weitere Prüfung** mit Datum stehen (Sicherheitsprüfung, Gasanlage …).
 */

export const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric", "lpg", "cng", "hydrogen", "other"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const EXTRA_INSPECTION_KINDS = ["sp", "gas", "other"] as const;
export type ExtraInspectionKind = (typeof EXTRA_INSPECTION_KINDS)[number];

/** Wie viele Monate im Voraus das Dashboard-Fenster „bald fällig“ reicht (der laufende Monat und die folgenden). */
/** Halterwechsel in der Halter-Historie: beendete Einträge und jeder Eintrag neben dem einen aktuellen (der erste Halter allein ist kein Wechsel). */
export const ownershipTransfers = (ownerships: ReadonlyArray<{ toDate: Date | null }>): number => ownerships.filter((o) => o.toDate !== null).length + Math.max(ownerships.filter((o) => o.toDate === null).length - 1, 0);

/**
 * Darf ein Fahrzeug gelöscht werden? Nur ohne Geschichte: keine Termine, keine Reifensätze, keine Aufträge (Aufträge werden nie gelöscht) und kein Halterwechsel (`transfers`, siehe `ownershipTransfers`). Sonst wird es
 * archiviert. Der erste Halter-Eintrag allein zählt nicht (er fällt mit dem Fahrzeug weg).
 */
export const vehicleDeletable = (links: { appointments: number; tireSets: number; orders: number; transfers: number; /** Dokumente & Fotos (F6), Checklisten (F7) und Belege der Rechnungen/Angebote (F3, auch Entwürfe); fehlt die Angabe, zählt sie nicht */ files?: number; checklists?: number; invoices?: number }): boolean =>
  links.appointments === 0 && links.tireSets === 0 && links.orders === 0 && links.transfers === 0 && (links.files ?? 0) === 0 && (links.checklists ?? 0) === 0 && (links.invoices ?? 0) === 0;

export const INSPECTION_SOON_MONTHS = 2;

/** Herstellerschlüsselnummer (HSN, Feld 2.1: vier Zeichen) und Typschlüsselnummer (TSN, Feld 2.2: drei Zeichen) – Großbuchstaben und Ziffern, ohne Leerzeichen. */
export const HSN_PATTERN = /^[0-9A-Z]{4}$/;
export const TSN_PATTERN = /^[0-9A-Z]{3}$/;
export { MONTH_PATTERN, addMonths, isMonth, monthOf, monthsBetween } from "@/lib/month";

export type InspectionState = "overdue" | "thisMonth" | "soon" | "ok";

/**
 * Stand der Prüffrist: `overdue` = der Monat ist vorbei, `thisMonth` = fällig im laufenden Monat (läuft Ende des Monats ab), `soon` = in den nächsten `soonMonths` Monaten, sonst `ok`.
 * `null` = keine Frist erfasst.
 */
export function inspectionState(due: string | null | undefined, currentMonth: string, soonMonths = INSPECTION_SOON_MONTHS): InspectionState | null {
  if (!due || !isMonth(due) || !isMonth(currentMonth)) return null;
  const diff = monthsBetween(currentMonth, due);
  return diff < 0 ? "overdue" : diff === 0 ? "thisMonth" : diff <= soonMonths ? "soon" : "ok";
}

/** Gilt die Frist als „bald fällig“ (überfällig, laufender Monat oder in den nächsten Monaten)? Grundlage von Dashboard-Baustein und Listenfilter. */
export const isInspectionAttention = (due: string | null | undefined, currentMonth: string, soonMonths = INSPECTION_SOON_MONTHS): boolean => {
  const state = inspectionState(due, currentMonth, soonMonths);
  return state !== null && state !== "ok";
};

/** Die weitere Prüfung (SP, Gasanlage …) wird nach dem Monat ihres Datums bewertet (Monatsgenauigkeit wie die HU). */
export const extraInspectionState = (due: Date | null | undefined, currentMonth: string, soonMonths = INSPECTION_SOON_MONTHS): InspectionState | null =>
  due ? inspectionState(monthOf(due), currentMonth, soonMonths) : null;

/** Kilometerstand-Eingabe: ganze Zahl ohne Tausenderpunkte (`123.456` und `123 456` gelten als 123456). */
export function parseMileage(value: string): number | null {
  const digits = value.replace(/[.\s']/g, "");
  return /^\d{1,7}$/.test(digits) ? Number(digits) : null;
}

/** Schlüsselnummern: Eingabe vereinheitlichen (Leerzeichen entfernen, Großbuchstaben). */
export const normalizeKey = (value: string): string => value.replace(/\s+/g, "").toUpperCase();
