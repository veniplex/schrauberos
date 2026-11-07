import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { computeTotals, type Totals } from "@/lib/line-items";
import { normalizePlate } from "@/lib/plate";
import type { Viewer } from "@/modules/types";
import { customerContacts, customerNameSelect } from "@/modules/workshop/customers/public";
import { vehicleTextWhere } from "@/modules/workshop/vehicles/public";
import { db } from "@/server/db";
import { contains, FULLTEXT_MIN_LENGTH, keyContains } from "@/server/search";
import { getWorkshop } from "@/server/workshop";
import { ORDER_STATUSES } from "./constants";
import { isOpen } from "./domain";

/**
 * Lesezugriffe der Funktion „Aufträge“ (README, „Datenzugriff“). **Preise** (Einzelpreise, Steuersätze, Rabatte der Positionen, Beträge der Freigaben und alle Summen) liest nur, wer
 * `orders.prices` hat – sie werden ohne das Recht gar nicht aus der Datenbank geholt (Mechaniker sehen Positionen ohne Preise). Kunden erscheinen nur mit Anzeigenamen (Richtlinie D7),
 * das Telefon nur mit `customers.view`.
 */

/** Filter der Liste: `open` = alle offenen (Angenommen, In Arbeit, Fertig), `all` = ohne Einschränkung, sonst ein Status. */
export type OrderListFilters = { q: string; status: "open" | "all" | (typeof ORDER_STATUSES)[number]; vehicleId?: string };

export const parseOrderStatusFilter = (value: string | undefined): OrderListFilters["status"] => (value === "all" || (ORDER_STATUSES as readonly string[]).includes(value ?? "") ? (value as OrderListFilters["status"]) : "open");

/**
 * Suchbedingung der Liste: Auftragsnummer, Kennzeichen/Marke/Modell/FIN und Name des Halters (über die normalisierten Spalten, Wörter in beliebiger Reihenfolge) und – ab
 * `FULLTEXT_MIN_LENGTH` Zeichen – der Kundenwunsch.
 */
export function orderListWhere(filters: OrderListFilters): Prisma.OrderWhereInput {
  const term = filters.q.trim();
  const plate = normalizePlate(term);
  return {
    ...(filters.status === "open" ? { status: { in: ["accepted", "in_progress", "ready"] } } : filters.status === "all" ? {} : { status: filters.status }),
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(term
      ? {
          OR: [
            { number: contains(term) },
            { vehicle: { is: { OR: vehicleTextWhere(term) } } },
            ...(plate ? [{ vehicle: { is: { plateNorm: { contains: plate } } } }] : []),
            { customer: { is: { ...keyContains("nameKey", term), processingRestrictedAt: null } } },
            ...(term.length >= FULLTEXT_MIN_LENGTH ? [{ request: contains(term) }] : []),
          ],
        }
      : {}),
  };
}

const LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  acceptedAt: true,
  closedAt: true,
  request: true,
  vehicle: { select: { id: true, plate: true, make: true, model: true } },
  customer: { select: customerNameSelect },
} as const satisfies Prisma.OrderSelect;

type ListRow = Prisma.OrderGetPayload<{ select: typeof LIST_SELECT }>;
export type OrderListRow = ListRow & { totals: Totals | null };

/** Summen aus Zahlen (Kleinunternehmer: steuerfrei). */
export async function totalsFor(items: ReadonlyArray<{ quantityMilli: number; unitCents: number; taxBp: number; discountBp: number }>): Promise<Totals> {
  const workshop = await getWorkshop();
  return computeTotals(items, { exempt: workshop.smallBusiness });
}

export async function listOrders(viewer: Viewer, filters: OrderListFilters, page: { skip: number; take: number; orderBy: Prisma.OrderOrderByWithRelationInput[] }): Promise<{ rows: OrderListRow[]; total: number }> {
  if (!viewer.can("orders.view")) throw new Error("orders.view fehlt");
  const where = orderListWhere(filters);
  const [rows, total] = await Promise.all([db.order.findMany({ where, select: LIST_SELECT, orderBy: page.orderBy, skip: page.skip, take: page.take }), db.order.count({ where })]);
  if (!viewer.can("orders.prices") || rows.length === 0) return { rows: rows.map((r) => ({ ...r, totals: null })), total };
  const items = await db.orderItem.findMany({
    where: { orderId: { in: rows.map((r) => r.id) } },
    select: { orderId: true, quantityMilli: true, unitCents: true, taxBp: true, discountBp: true },
  });
  const workshop = await getWorkshop();
  const byOrder = new Map<string, typeof items>();
  for (const item of items) byOrder.set(item.orderId, [...(byOrder.get(item.orderId) ?? []), item]);
  return { rows: rows.map((r) => ({ ...r, totals: computeTotals(byOrder.get(r.id) ?? [], { exempt: workshop.smallBusiness }) })), total };
}

/** Anzahl je Status für die Statusleiste der Liste. */
export async function orderCounts(): Promise<Record<"open" | (typeof ORDER_STATUSES)[number], number>> {
  const groups = await db.order.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, count(s)])) as Record<(typeof ORDER_STATUSES)[number], number>;
  return { ...counts, open: counts.accepted + counts.in_progress + counts.ready };
}

/** Ein Auftrag für die Detailseite und das Bearbeiten. */
export async function getOrderDetail(viewer: Viewer, id: string) {
  if (!viewer.can("orders.view")) throw new Error("orders.view fehlt");
  const prices = viewer.can("orders.prices");
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      request: true,
      mileageKm: true,
      acceptedAt: true,
      closedAt: true,
      createdByName: true,
      createdAt: true,
      updatedAt: true,
      appointmentId: true,
      vehicle: { select: { id: true, plate: true, make: true, model: true, mileageKm: true, archivedAt: true } },
      customer: { select: customerNameSelect },
      appointment: viewer.can("appointments.view") ? { select: { id: true, title: true, startsAt: true } } : false,
      items: {
        orderBy: { position: "asc" },
        select: { id: true, kind: true, description: true, unit: true, quantityMilli: true, refType: true, refId: true, ...(prices ? { unitCents: true, taxBp: true, discountBp: true } : {}) },
      },
      findings: { orderBy: { createdAt: "asc" }, select: { id: true, text: true, authorName: true, createdAt: true } },
      approvals: { orderBy: { createdAt: "asc" }, select: { id: true, reason: true, method: true, approverName: true, recordedByName: true, createdAt: true, ...(prices ? { amountCents: true } : {}) } },
      events: { orderBy: { at: "asc" }, select: { id: true, kind: true, status: true, byName: true, note: true, at: true } },
    },
  });
  if (!order) return null;
  const contacts = await customerContacts(viewer, order.customer ? [order.customer.id] : []);
  const priced = prices
    ? (order.items as unknown as Array<{ quantityMilli: number; unitCents: number; taxBp: number; discountBp: number }>)
    : null;
  return {
    ...order,
    items: order.items as Array<(typeof order.items)[number] & Partial<{ unitCents: number; taxBp: number; discountBp: number }>>,
    approvals: order.approvals as Array<(typeof order.approvals)[number] & Partial<{ amountCents: number }>>,
    phone: contacts.get(order.customer?.id ?? "")?.phone ?? null,
    totals: priced ? await totalsFor(priced) : null,
    open: isOpen(order.status),
  };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

/** Schlanke Zeile einer Signatur: nur für die Auslieferung der Unterschrift (Recht orders.view + orders.prices wie der Betrag). */
export async function approvalSignature(id: string): Promise<{ path: string; orderId: string } | null> {
  const row = await db.orderApproval.findUnique({ where: { id }, select: { signaturePath: true, method: true, orderId: true } });
  return row?.signaturePath && row.method === "signature" ? { path: row.signaturePath, orderId: row.orderId } : null;
}

/** Offene Aufträge für die Übersicht: Anzahl je offenem Status und die ältesten abholbereiten. */
export async function dashboardOrders(limit = 5) {
  const [counts, ready] = await Promise.all([
    orderCounts(),
    db.order.findMany({
      where: { status: "ready" },
      orderBy: { acceptedAt: "asc" },
      take: limit,
      select: { id: true, number: true, acceptedAt: true, vehicle: { select: { plate: true } }, customer: { select: customerNameSelect } },
    }),
  ]);
  return { counts, ready };
}

/**
 * Positionen **ohne Preise** und Status eines Auftrags für Funktionen, die sich in die Auftragsseite einhängen (Teile & Lager: „Verbrauchte Teile“, Hooks lesen das Ergebnis der
 * Operation). Kein Betrachter nötig: die Rückgabe enthält nichts, was über `orders.view` hinausgeht.
 */
export async function orderLines(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      items: { orderBy: { position: "asc" }, select: { id: true, kind: true, description: true, unit: true, quantityMilli: true, refType: true, refId: true } },
    },
  });
}

/** Der (nicht stornierte) Auftrag zu einem Termin – Grundlage von „Auftrag aus Termin“. */
export const orderForAppointment = (appointmentId: string) => db.order.findFirst({ where: { appointmentId, status: { not: "cancelled" } }, select: { id: true, number: true } });
