import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { archivedWhere, type ArchiveFilter } from "@/lib/archive-filter";
import { endOfDayIn, startOfDayIn } from "@/lib/dates";
import { addMonths } from "@/lib/month";
import { normalizePlate } from "@/lib/plate";
import { dayKey } from "@/lib/zone";
import type { Permission } from "@/modules/catalog";
import type { Viewer } from "@/modules/types";
import { customerContacts, customerNameSelect } from "@/modules/workshop/customers/public";
import { db } from "@/server/db";
import { keyContains, searchWhere } from "@/server/search";
import { INSPECTION_SOON_MONTHS } from "./domain";

/**
 * Suchbedingungen für Fahrzeuge (Liste, Schnellsuche, Auswahlfelder, API): Kennzeichen über `plateNorm` (ohne Trenner, Großschreibung), Marke/Modell/FIN über die normalisierte Spalte
 * `searchKey` und der Halter über seine `nameKey` (nur der Name, Richtlinie D7). Jedes Element ist eine ODER-Alternative.
 */
export function vehicleTextWhere(term: string): Prisma.VehicleWhereInput[] {
  const plate = normalizePlate(term);
  return [...(plate ? [{ plateNorm: { contains: plate } }] : []), keyContains("searchKey", term), { customer: { is: { ...keyContains("nameKey", term), processingRestrictedAt: null } } }];
}

/** Filter der Fahrzeugliste – dieselben für die Liste und die Druckliste. */
export type VehicleListFilters = {
  q: string;
  noOwnerOnly: boolean;
  /** `soon` = überfällig, im laufenden Monat oder in den nächsten Monaten fällig; `none` = keine Frist erfasst */
  inspection?: "soon" | "none";
  /** fällig in genau diesem Monat, „JJJJ-MM“ */
  month?: string;
  /** Archiv: Standard nur aktive Fahrzeuge (P4b-2) */
  archived?: ArchiveFilter;
};

/**
 * Suchbedingung der Fahrzeugliste. Der Anzeigename des Halters ist in der Liste sichtbar (Richtlinie D7), Kontaktdaten gehören nicht zum Suchumfang.
 * `currentMonth`: der laufende Monat „JJJJ-MM“ (von außen, damit die Funktion ohne Uhr bleibt).
 */
export function vehicleListWhere(filters: VehicleListFilters, can: (permission: Permission) => boolean, currentMonth: string): Prisma.VehicleWhereInput {
  const { q, noOwnerOnly, inspection, month, archived = "active" } = filters;
  const text = searchWhere<Prisma.VehicleWhereInput>(q, can, [{ where: (term) => ({ OR: vehicleTextWhere(term) }) }]);
  return {
    ...archivedWhere(archived),
    ...(noOwnerOnly ? { customerId: null } : {}),
    ...(inspection === "soon" ? { inspectionDue: { not: null, lte: addMonths(currentMonth, INSPECTION_SOON_MONTHS) } } : {}),
    ...(inspection === "none" ? { inspectionDue: null } : {}),
    ...(month ? { inspectionDue: month } : {}),
    ...(text ?? {}),
  };
}

/**
 * Kurzbeschreibung eines Fahrzeugs für Funktionen, die sich an es hängen (Dokumente & Fotos): Kennzeichen, ob es archiviert ist und ob sein Halter eingeschränkt verarbeitet wird (Art. 18 DSGVO).
 * Keine Kontaktdaten, kein Name des Halters. `client` darf die Transaktion einer Operation sein.
 */
export async function vehicleRef(vehicleId: string, client: Pick<Prisma.TransactionClient, "vehicle"> = db): Promise<{ id: string; plate: string; description: string; archived: boolean; restricted: boolean } | null> {
  const vehicle = await client.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, plate: true, make: true, model: true, archivedAt: true, customer: { select: { processingRestrictedAt: true } } },
  });
  return vehicle ? { id: vehicle.id, plate: vehicle.plate, description: [vehicle.make, vehicle.model].filter(Boolean).join(" "), archived: vehicle.archivedAt !== null, restricted: Boolean(vehicle.customer?.processingRestrictedAt) } : null;
}

/** Kennzeichen zu Fahrzeug-Kennungen (Anzeige von Dateien). */
export async function vehicleLabels(ids: readonly string[]): Promise<Map<string, { plate: string; description: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.vehicle.findMany({ where: { id: { in: [...ids] } }, select: { id: true, plate: true, make: true, model: true } });
  return new Map(rows.map((v) => [v.id, { plate: v.plate, description: [v.make, v.model].filter(Boolean).join(" ") }]));
}

/** Bald fällige Prüfungen (überfällig, laufender Monat, nächste Monate) – Grundlage des Dashboard-Bausteins. Nach Frist sortiert, älteste zuerst. */
export const attentionWhere = (currentMonth: string): Prisma.VehicleWhereInput => ({ archivedAt: null, inspectionDue: { not: null, lte: addMonths(currentMonth, INSPECTION_SOON_MONTHS) } });

/**
 * Fahrzeug für die Detailseite. Der Halter erscheint mit Anzeigename (Richtlinie D7), sein Telefon nur mit `customers.view`; Reifensätze samt Reifen nur mit `tires.view`, die
 * letzten Termine nur mit `appointments.view` – was der Betrachter nicht sehen darf, wird nicht gelesen.
 */
export async function getVehicleDetail(viewer: Viewer, id: string) {
  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: {
      customer: { select: customerNameSelect },
      ownerships: { include: { customer: { select: customerNameSelect } }, orderBy: { fromDate: "desc" } },
      _count: { select: { appointments: true, tireSets: true, orders: true, files: true, checklists: true, invoices: true } },
    },
  });
  if (!vehicle) return null;
  const [tireSets, appointments, contacts] = await Promise.all([
    viewer.can("tires.view") ? db.tireSet.findMany({ where: { vehicleId: id }, include: { tires: true } }) : [],
    viewer.can("appointments.view")
      ? db.appointment.findMany({ where: { vehicleId: id }, orderBy: { startsAt: "desc" }, take: 8, select: { id: true, title: true, startsAt: true, status: true } })
      : [],
    customerContacts(viewer, vehicle.customerId ? [vehicle.customerId] : []),
  ]);
  return { ...vehicle, tireSets, appointments, ownerPhone: contacts.get(vehicle.customerId ?? "")?.phone ?? null };
}

export type VehicleDeadline = { id: string; kind: "inspection" | "extra"; /** nur bei `extra`: sp | gas | other */ extraKind: string | null; plate: string; vehicleName: string; /** Kalendertag der Frist (`JJJJ-MM-TT`) */ day: string };

/**
 * Prüffristen der Kundenfahrzeuge für den Kalender-Abo (F10): die nächste Hauptuntersuchung (`inspectionDue` ist ein Monat – die Frist ist der **letzte Tag** dieses Monats) und die weitere Prüfung
 * (`extraInspectionDue`, ein Tag) im Zeitraum `from`…`to` (Kalendertage, einschließlich). Verlangt `vehicles.view`. Ohne archivierte Fahrzeuge und **ohne Fahrzeuge von Kunden mit eingeschränkter
 * Verarbeitung (Art. 18 DSGVO)**. Kein Halter, kein Kunde: nur Kennzeichen, Marke und Modell.
 */
export async function vehicleDeadlines(viewer: Viewer, from: string, to: string, take = 2000): Promise<VehicleDeadline[]> {
  if (!viewer.can("vehicles.view")) return [];
  const unrestricted = { OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] };
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const rows = await db.vehicle.findMany({
    where: {
      archivedAt: null,
      AND: [unrestricted, { OR: [{ inspectionDue: { gte: fromMonth, lte: toMonth } }, { extraInspectionDue: { gte: startOfDayIn(from), lte: endOfDayIn(to) } }] }],
    },
    orderBy: [{ plateNorm: "asc" }, { id: "asc" }],
    take,
    select: { id: true, plate: true, make: true, model: true, inspectionDue: true, extraInspectionKind: true, extraInspectionDue: true },
  });
  const out: VehicleDeadline[] = [];
  for (const v of rows) {
    const vehicleName = [v.make, v.model].filter(Boolean).join(" ");
    if (v.inspectionDue && v.inspectionDue >= fromMonth && v.inspectionDue <= toMonth) {
      const [y, m] = v.inspectionDue.split("-").map(Number);
      const day = `${v.inspectionDue}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
      if (day >= from && day <= to) out.push({ id: v.id, kind: "inspection", extraKind: null, plate: v.plate, vehicleName, day });
    }
    if (v.extraInspectionDue) {
      const day = dayKey(v.extraInspectionDue);
      if (day >= from && day <= to) out.push({ id: v.id, kind: "extra", extraKind: v.extraInspectionKind, plate: v.plate, vehicleName, day });
    }
  }
  return out;
}

export type InspectionMonth = { month: string; count: number };
export type VehicleInspectionOverview = {
  /** Fahrzeuge mit Frist vor dem laufenden Monat (überfällig) */
  overdue: number;
  /** Fristen vom laufenden Monat bis `untilMonth`, je Monat */
  months: InspectionMonth[];
  /** Die ältesten Fristen (Kennzeichen, Fahrzeug, Monat) – ohne Fahrzeuge von Kunden mit eingeschränkter Verarbeitung */
  items: Array<{ id: string; plate: string; vehicleName: string; month: string }>;
};

/**
 * **Prüffristen** der Kundenfahrzeuge für den Bericht (F9): überfällige und die Fristen bis `untilMonth` (`JJJJ-MM`), gezählt von der Datenbank (`groupBy` auf dem Monat). Ohne archivierte Fahrzeuge und **ohne Fahrzeuge von
 * Kunden mit eingeschränkter Verarbeitung (Art. 18 DSGVO)** – weder in den Zahlen noch in der Liste (so passen sie zusammen). Kein Halter, kein Kunde: Kennzeichen, Marke, Modell. Verlangt `vehicles.view`.
 */
export async function vehicleInspectionOverview(viewer: Viewer, options: { currentMonth: string; untilMonth: string; limit: number }): Promise<VehicleInspectionOverview | null> {
  if (!viewer.can("vehicles.view")) return null;
  const unrestricted = { OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] };
  const where: Prisma.VehicleWhereInput = { archivedAt: null, AND: [unrestricted, { inspectionDue: { not: null, lte: options.untilMonth } }] };
  const [groups, rows] = await Promise.all([
    db.vehicle.groupBy({ by: ["inspectionDue"], where, _count: { _all: true } }),
    db.vehicle.findMany({ where, orderBy: [{ inspectionDue: "asc" }, { plateNorm: "asc" }, { id: "asc" }], take: options.limit, select: { id: true, plate: true, make: true, model: true, inspectionDue: true } }),
  ]);
  let overdue = 0;
  const months = new Map<string, number>();
  for (const g of groups) {
    if (!g.inspectionDue) continue;
    if (g.inspectionDue < options.currentMonth) overdue += g._count._all;
    else months.set(g.inspectionDue, (months.get(g.inspectionDue) ?? 0) + g._count._all);
  }
  return {
    overdue,
    months: [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, count]) => ({ month, count })),
    items: rows.flatMap((v) => (v.inspectionDue ? [{ id: v.id, plate: v.plate, vehicleName: [v.make, v.model].filter(Boolean).join(" "), month: v.inspectionDue }] : [])),
  };
}
