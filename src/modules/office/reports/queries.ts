import "server-only";
import { addMonths } from "@/lib/month";
import { addDaysToKey, daysBetweenKeys, startOfDay } from "@/lib/zone";
import { fleetDeadlines, type FleetDeadline } from "@/modules/office/fleet/public";
import { openItems, paymentsDue, revenueByMonth, type OpenItemsData, type PaymentsDue, type RevenueMonth } from "@/modules/office/invoices/public";
import type { Viewer } from "@/modules/types";
import { utilizationSource } from "@/modules/workshop/appointments/public";
import { storageOverview, type StorageOverview } from "@/modules/workshop/tires/public";
import { vehicleInspectionOverview, type VehicleInspectionOverview } from "@/modules/workshop/vehicles/public";
import { getHolidays } from "@/server/holidays";
import { getWorkshop } from "@/server/workshop";
import { MAX_REVENUE_MONTHS, REPORT_LIST_LIMIT, daysOf, lastDayOfMonth, monthKeys, monthOfDay, openingIntervals, overlapMinutes, snapToMonths, totalMinutes, utilizationPercent } from "./domain";

/**
 * Berichte (F9): Die Daten kommen **aus den Quellfunktionen** (jeweils über deren `public.ts`: Rechnungen, Termine, Reifenlager, Fahrzeuge, Fuhrpark – mit eigenem Recht, explizitem `select` und den Regeln zu
 * Art. 18); dieser Teil setzt sie nur zu Berichten zusammen und rechnet, was nicht in der Datenbank steht (Öffnungszeiten, Summen). Jede Funktion liefert `null`, wenn der Betrachter das Leserecht der Quelle nicht
 * hat – der Aufrufer prüft zusätzlich `reports.view` (`access.ts`).
 */

/* ───────────── Umsatz je Monat ───────────── */

export type RevenueReport = { from: string; to: string; months: RevenueMonth[]; total: { count: number; netCents: number; vatCents: number; grossCents: number; incomplete: number; derived: number } };

/** Der Umsatz der Monate, die der Zeitraum berührt (auf ganze Monate gerundet), höchstens `MAX_REVENUE_MONTHS`. */
export async function revenueReport(viewer: Viewer, period: { from: string; to: string }): Promise<RevenueReport | null> {
  const snapped = snapToMonths(period.from, period.to);
  const months = monthKeys(snapped.from, snapped.to);
  if (months.length > MAX_REVENUE_MONTHS) throw new Error("Zeitraum zu lang");
  const rows = await revenueByMonth(viewer, months);
  if (!rows) return null;
  const total = rows.reduce((sum, r) => ({ count: sum.count + r.count, netCents: sum.netCents + r.netCents, vatCents: sum.vatCents + r.vatCents, grossCents: sum.grossCents + r.grossCents, incomplete: sum.incomplete + r.incomplete, derived: sum.derived + r.derived }), { count: 0, netCents: 0, vatCents: 0, grossCents: 0, incomplete: 0, derived: 0 });
  return { from: snapped.from, to: snapped.to, months: rows, total };
}

/* ───────────── Offene Posten ───────────── */

export type OpenItemsReport = OpenItemsData & { today: string };

export async function openItemsReport(viewer: Viewer, options: { direction: "outgoing" | "incoming"; today: string }): Promise<OpenItemsReport | null> {
  const data = await openItems(viewer, { ...options, limit: REPORT_LIST_LIMIT });
  return data ? { ...data, today: options.today } : null;
}

/* ───────────── Auslastung ───────────── */

export type UtilizationRow = { id: string | null; name: string | null; active: boolean; appointments: number; bookedMinutes: number; utilization: number | null };
export type UtilizationReport = { from: string; to: string; capacityMinutes: number; rows: UtilizationRow[]; truncated: boolean };

/**
 * Auslastung je Arbeitsplatz im Zeitraum: Die **Öffnungszeit** je Tag kommt aus dem Werkstattprofil (Wochentag, ohne ganze Feiertage, halbe zählen zur Hälfte), **gebucht** ist die Zeit der Termine
 * innerhalb davon (`overlapMinutes`). Termine ohne Arbeitsplatz stehen in einer eigenen Zeile ohne Prozent (sie haben keine Kapazität, an der man sie messen könnte).
 */
export async function utilizationReport(viewer: Viewer, period: { from: string; to: string }): Promise<UtilizationReport | null> {
  const source = await utilizationSource(viewer, startOfDay(period.from), startOfDay(addDaysToKey(period.to, 1)));
  if (!source) return null;
  const [workshop, holidays] = await Promise.all([getWorkshop(), getHolidays()]);
  const intervals = openingIntervals(daysOf(period.from, period.to), workshop.hours, holidays);
  const capacityMinutes = totalMinutes(intervals);
  const perBay = new Map<string | null, { appointments: number; booked: number }>();
  for (const booking of source.bookings) {
    const entry = perBay.get(booking.bayId) ?? { appointments: 0, booked: 0 };
    entry.appointments += 1;
    entry.booked += overlapMinutes(booking.startsAt.getTime(), booking.endsAt.getTime(), intervals);
    perBay.set(booking.bayId, entry);
  }
  const rows: UtilizationRow[] = source.bays.map((bay) => {
    const entry = perBay.get(bay.id) ?? { appointments: 0, booked: 0 };
    return { id: bay.id, name: bay.name, active: bay.active, appointments: entry.appointments, bookedMinutes: entry.booked, utilization: utilizationPercent(entry.booked, capacityMinutes) };
  });
  const none = perBay.get(null);
  if (none) rows.push({ id: null, name: null, active: true, appointments: none.appointments, bookedMinutes: none.booked, utilization: null });
  return { from: period.from, to: period.to, capacityMinutes, rows, truncated: source.truncated };
}

/**
 * Die Kennzahlen über der Tabelle, in **einer** Rechenregel (die Seite zeigt sie, der Test prüft sie): **Kapazität je Arbeitsplatz** = Öffnungszeit im Zeitraum (`capacityMinutes`); **Kapazität gesamt** = Kapazität je
 * Arbeitsplatz × Zahl der aufgeführten Arbeitsplätze (Zeilen mit Arbeitsplatz, auch archivierte mit Terminen – sie haben gebuchte Zeit); **gebucht gesamt** = alle Termine inklusive derer ohne Arbeitsplatz,
 * **davon ohne Arbeitsplatz** = nur diese. Die Gesamtauslastung (Zeit mit Arbeitsplatz / Kapazität gesamt) fehlt bewusst: Termine ohne Arbeitsplatz haben keine Kapazität, an der man sie messen könnte.
 */
export function utilizationTotals(report: Pick<UtilizationReport, "capacityMinutes" | "rows">) {
  const withBay = report.rows.filter((r) => r.id !== null);
  const bookedTotal = report.rows.reduce((sum, r) => sum + r.bookedMinutes, 0);
  const unassigned = report.rows.find((r) => r.id === null)?.bookedMinutes ?? 0;
  return { bays: withBay.length, capacityPerBay: report.capacityMinutes, capacityTotal: report.capacityMinutes * withBay.length, bookedTotal, bookedUnassigned: unassigned, bookedAssigned: bookedTotal - unassigned };
}

/* ───────────── Einlagerungsbestand ───────────── */

export const storageReport = (viewer: Viewer): Promise<StorageOverview | null> => storageOverview(viewer);

/* ───────────── Fälligkeiten ───────────── */

export type DueReport = {
  today: string;
  months: number;
  untilMonth: string;
  /** Tage von heute bis zum letzten Tag der Vorschau */
  days: number;
  /** Prüffristen der Kundenfahrzeuge; `null`: kein Recht an den Fahrzeugen */
  inspection: VehicleInspectionOverview | null;
  /** Fristen im Fuhrpark (nach Tag); `null`: kein Recht oder Funktion aus */
  fleet: FleetDeadline[] | null;
  /** Zahlungsziele der Vorschau; `null`: kein Recht an den Rechnungen */
  payments: { outgoing: PaymentsDue; incoming: PaymentsDue } | null;
};

export const DUE_MONTH_CHOICES = [1, 3, 6, 12] as const;

/**
 * Fälligkeiten für die nächsten `months` Monate (der laufende Monat zählt als erster): Prüffristen der Kundenfahrzeuge (überfällige und kommende, je Monat gezählt), Fristen im Fuhrpark (auch die der
 * letzten zwölf Monate, die noch offen sein können) und Zahlungsziele. **Jeder Teil nur mit dem Recht seiner Quelle**; ein Teil ohne Recht ist `null`.
 */
export async function dueReport(viewer: Viewer, options: { today: string; months: number }): Promise<DueReport> {
  const currentMonth = monthOfDay(options.today);
  const untilMonth = addMonths(currentMonth, options.months - 1);
  const lastDay = lastDayOfMonth(untilMonth);
  const [inspection, fleet, outgoing, incoming] = await Promise.all([
    vehicleInspectionOverview(viewer, { currentMonth, untilMonth, limit: REPORT_LIST_LIMIT }),
    fleetDeadlines(viewer, addDaysToKey(options.today, -365), lastDay).then((rows) => (viewer.can("fleet.view") ? rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.plate.localeCompare(b.plate))) : null)),
    paymentsDue(viewer, { direction: "outgoing", today: options.today, days: Math.max(0, daysBetweenKeys(options.today, lastDay)), limit: 10 }),
    paymentsDue(viewer, { direction: "incoming", today: options.today, days: Math.max(0, daysBetweenKeys(options.today, lastDay)), limit: 10 }),
  ]);
  return { today: options.today, months: options.months, untilMonth, days: Math.max(0, daysBetweenKeys(options.today, lastDay)), inspection, fleet, payments: outgoing && incoming ? { outgoing, incoming } : null };
}

/** Der laufende Monat `JJJJ-MM` zum Tag. */
export const currentMonthOf = (today: string): string => today.slice(0, 7);

/** Erster und letzter Tag des Monats `JJJJ-MM` als Zeitraum (für das Widget „Umsatz im laufenden Monat“). */
export const monthPeriod = (today: string): { from: string; to: string } => ({ from: `${today.slice(0, 7)}-01`, to: lastDayOfMonth(today.slice(0, 7)) });
