import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { addMonths } from "@/lib/month";
import { normalizePlate } from "@/lib/plate";
import type { Permission } from "@/modules/catalog";
import { contains, searchWhere } from "@/server/search";
import { INSPECTION_SOON_MONTHS } from "./domain";

/** Filter der Fahrzeugliste – dieselben für die Liste und die Druckliste. */
export type VehicleListFilters = {
  q: string;
  noOwnerOnly: boolean;
  /** `soon` = überfällig, im laufenden Monat oder in den nächsten Monaten fällig; `none` = keine Frist erfasst */
  inspection?: "soon" | "none";
  /** fällig in genau diesem Monat, „JJJJ-MM“ */
  month?: string;
};

/**
 * Suchbedingung der Fahrzeugliste. Der Anzeigename des Halters ist in der Liste sichtbar (Richtlinie D7), Kontaktdaten gehören nicht zum Suchumfang.
 * `currentMonth`: der laufende Monat „JJJJ-MM“ (von außen, damit die Funktion ohne Uhr bleibt).
 */
export function vehicleListWhere(filters: VehicleListFilters, can: (permission: Permission) => boolean, currentMonth: string): Prisma.VehicleWhereInput {
  const { q, noOwnerOnly, inspection, month } = filters;
  const plate = normalizePlate(q);
  const text = searchWhere<Prisma.VehicleWhereInput>(q, can, [
    { where: () => (plate ? { plateNorm: { contains: plate } } : { id: "" }) },
    { where: (term) => ({ vin: contains(term) }) },
    { where: (term) => ({ make: contains(term) }) },
    { where: (term) => ({ model: contains(term) }) },
    { where: (term) => ({ customer: { is: { OR: [{ lastName: contains(term) }, { firstName: contains(term) }, { company: contains(term) }] } } }) },
  ]);
  return {
    ...(noOwnerOnly ? { customerId: null } : {}),
    ...(inspection === "soon" ? { inspectionDue: { not: null, lte: addMonths(currentMonth, INSPECTION_SOON_MONTHS) } } : {}),
    ...(inspection === "none" ? { inspectionDue: null } : {}),
    ...(month ? { inspectionDue: month } : {}),
    ...(text ?? {}),
  };
}

/** Bald fällige Prüfungen (überfällig, laufender Monat, nächste Monate) – Grundlage des Dashboard-Bausteins. Nach Frist sortiert, älteste zuerst. */
export const attentionWhere = (currentMonth: string): Prisma.VehicleWhereInput => ({ inspectionDue: { not: null, lte: addMonths(currentMonth, INSPECTION_SOON_MONTHS) } });
