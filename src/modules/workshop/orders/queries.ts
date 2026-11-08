import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { computeTotals, type Totals } from "@/lib/line-items";
import { normalizePlate } from "@/lib/plate";
import type { Viewer } from "@/modules/types";
import { customerContacts, customerDisplayName, customerNameSelect, isRestricted, restrictionSelect, unrestrictedCustomerWhere, unrestrictedOrder } from "@/modules/workshop/customers/public";
import { vehicleRef, vehicleTextWhere } from "@/modules/workshop/vehicles/public";
import type { MessageKey } from "@/i18n/translate";
import type { AppSession } from "@/server/auth/session";
import { fail } from "@/server/operations";
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
            { customer: { is: { ...keyContains("nameKey", term), ...unrestrictedCustomerWhere } } },
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
      approvals: { orderBy: { createdAt: "asc" }, select: { id: true, reason: true, method: true, approverName: true, signedName: true, recordedByName: true, createdAt: true, ...(prices ? { amountCents: true } : {}) } },
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

/**
 * Kurzbeschreibung eines Auftrags für Funktionen, die sich an ihn hängen (Zeiterfassung, Dokumente, Checklisten): Nummer, Status, Kennzeichen und ob an ihm neue Verknüpfungen erlaubt sind –
 * nicht, wenn er abgeschlossen/storniert ist (`open`) oder sein Kunde **oder der Halter seines Fahrzeugs** eingeschränkt verarbeitet wird (`restricted`, Art. 18 DSGVO). Kein Betrachter nötig: nichts über `orders.view` hinaus.
 * `client` darf die Transaktion einer Operation sein.
 */
export async function orderRef(orderId: string, client: Pick<Prisma.TransactionClient, "order"> = db): Promise<{ id: string; number: string; status: string; open: boolean; restricted: boolean; vehicleId: string; plate: string } | null> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, status: true, vehicleId: true, vehicle: { select: { plate: true, customer: { select: restrictionSelect } } }, customer: { select: restrictionSelect } },
  });
  return order ? { id: order.id, number: order.number, status: order.status, open: isOpen(order.status), restricted: isRestricted(order.customer) || isRestricted(order.vehicle.customer), vehicleId: order.vehicleId, plate: order.vehicle.plate } : null;
}

/** Wer Aufträge in dieser Sitzung sehen darf: Funktion aktiv und `orders.view` – die eine Regel für alles, was sich an einen Auftrag hängt (Dateien, Checklisten …). */
export const canSeeOrders = (actor: Pick<AppSession, "can" | "features">): boolean => actor.features.has("workshop.orders") && actor.can("orders.view");

/**
 * Der Auftrag als **Eigentümer einer neuen Sache** (Datei, Checkliste): ohne Recht oder Funktion `forbidden`; unbekannt oder Kunde bzw. Fahrzeughalter mit eingeschränkter Verarbeitung (Art. 18) `notFound`;
 * nicht mehr offen ein Fehler mit dem Meldungsschlüssel des Aufrufers. Liefert Kennung, Nummer, Fahrzeug und Kennzeichen. `client` darf die Transaktion der Operation sein.
 */
export async function orderOwner(
  actor: Pick<AppSession, "can" | "features">,
  orderId: string,
  closedKey: MessageKey,
  client?: Pick<Prisma.TransactionClient, "order" | "vehicle">,
): Promise<{ id: string; number: string; vehicleId: string; plate: string }> {
  if (!canSeeOrders(actor)) fail("forbidden");
  const order = await orderRef(orderId, client);
  if (!order || order.restricted) fail("notFound");
  if (!order.open) fail("invalid", closedKey);
  const vehicle = await vehicleRef(order.vehicleId, client);
  if (!vehicle || vehicle.restricted) fail("notFound");
  return { id: order.id, number: order.number, vehicleId: order.vehicleId, plate: order.plate };
}

/** Aufträge zur Auswahl beim Stempeln: offene Aufträge (Angenommen, In Arbeit, Fertig), neueste zuerst, ohne Kunden mit eingeschränkter Verarbeitung. */
export async function stampableOrders(limit = 40): Promise<Array<{ id: string; number: string; plate: string; status: string }>> {
  const rows = await db.order.findMany({
    where: { status: { in: ["accepted", "in_progress", "ready"] }, ...unrestrictedOrder },
    orderBy: { acceptedAt: "desc" },
    take: limit,
    select: { id: true, number: true, status: true, vehicle: { select: { plate: true } } },
  });
  return rows.map((o) => ({ id: o.id, number: o.number, status: o.status, plate: o.vehicle.plate }));
}

/**
 * Der Auftrag mit **Preisen** für die Rechnungserstellung (F3, „Rechnung aus Auftrag“): Kunde, Fahrzeug, Zeitpunkte und alle Positionen mit Menge, Netto-Einzelpreis, Steuersatz und Rabatt (Zeiten der Zeiterfassung
 * sind bereits Positionen). Die Preise stehen hier nur, weil die Rechnungserstellung sie braucht – **der Aufrufer prüft `orders.prices`** (und das Recht an seiner eigenen Funktion). `client` darf die Transaktion
 * einer Operation sein. `restricted`: der Kunde wird eingeschränkt verarbeitet (Art. 18 DSGVO) – dann gibt es keine neue Verknüpfung.
 */
export async function orderForBilling(orderId: string, client: Pick<Prisma.TransactionClient, "order"> = db) {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      customerId: true,
      mileageKm: true,
      acceptedAt: true,
      closedAt: true,
      vehicle: { select: { id: true, plate: true, make: true, model: true, customer: { select: restrictionSelect } } },
      customer: { select: { ...restrictionSelect, archivedAt: true } },
      items: { orderBy: { position: "asc" }, select: { id: true, kind: true, description: true, unit: true, quantityMilli: true, unitCents: true, taxBp: true, discountBp: true, refType: true, refId: true } },
    },
  });
  if (!order) return null;
  const { customer, vehicle: { customer: holder, ...vehicle }, ...rest } = order;
  // eingeschränkt: der Kunde des Auftrags **oder der Halter seines Fahrzeugs** (`customers/public.ts`)
  return { ...rest, vehicle, restricted: isRestricted(customer) || isRestricted(holder), open: isOpen(order.status) };
}

/**
 * Kennungen der Aufträge, die für Art. 18 DSGVO als eingeschränkt gelten (Kunde oder Fahrzeughalter eingeschränkt; `unrestrictedOrder`) – für Datenbestände, die Aufträge nur über die Kennung kennen (Lagerbuchungen).
 * Mehr als `limit` Treffer: `null` (der Aufrufer behandelt das als „alle unsichtbar“, nie als „keine eingeschränkt“).
 */
export async function restrictedOrderIds(limit = 5000): Promise<string[] | null> {
  const rows = await db.order.findMany({ where: { NOT: unrestrictedOrder }, select: { id: true }, take: limit + 1 });
  return rows.length > limit ? null : rows.map((r) => r.id);
}

/** Aufträge zu den Kennungen (Anzeige von Zeiten und Dateien): Nummer und Kennzeichen. */
export async function orderLabels(ids: readonly string[]): Promise<Map<string, { number: string; plate: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.order.findMany({ where: { id: { in: [...ids] } }, select: { id: true, number: true, vehicle: { select: { plate: true } } } });
  return new Map(rows.map((o) => [o.id, { number: o.number, plate: o.vehicle.plate }]));
}

/**
 * Was die **Auftragskarte** (F8, Werkstattlaufzettel) braucht: Auftrag, Fahrzeug, Anzeigename des Kunden, Kundenwunsch und die Positionen **ohne jeden Preis** – auch mit `orders.prices` nicht (die Karte
 * liegt in der Werkstatt, nicht beim Kunden). Verlangt `orders.view`. Das Telefon des Kunden nur mit `customers.view` (Richtlinie D7: ohne das Recht wird es gar nicht gelesen). Aufträge und Fahrzeuge von
 * Kunden mit eingeschränkter Verarbeitung (Art. 18 DSGVO) gibt es nicht (`null`). Explizites `select`.
 */
export async function orderCardData(viewer: Viewer, id: string) {
  if (!viewer.can("orders.view")) return null;
  const order = await db.order.findFirst({
    where: { id, ...unrestrictedOrder },
    select: {
      id: true,
      number: true,
      status: true,
      request: true,
      mileageKm: true,
      acceptedAt: true,
      vehicle: { select: { plate: true, make: true, model: true } },
      customer: { select: customerNameSelect },
      items: { orderBy: { position: "asc" }, select: { id: true, kind: true, description: true, unit: true, quantityMilli: true } },
    },
  });
  if (!order) return null;
  const phone = order.customer ? ((await customerContacts(viewer, [order.customer.id])).get(order.customer.id)?.phone ?? null) : null;
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    request: order.request,
    mileageKm: order.mileageKm,
    acceptedAt: order.acceptedAt,
    plate: order.vehicle.plate,
    vehicleName: [order.vehicle.make, order.vehicle.model].filter(Boolean).join(" "),
    customerName: order.customer ? customerDisplayName(order.customer) : null,
    phone,
    items: order.items,
  };
}

export type OrderCardData = NonNullable<Awaited<ReturnType<typeof orderCardData>>>;
