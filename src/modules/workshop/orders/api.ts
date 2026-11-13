import { z } from "zod";
import type { Order, OrderApproval, OrderItem } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { MAX_ITEM_DESCRIPTION } from "@/lib/line-items";
import { centsText, iso, isoOrNull, nullableString, oneOf, optionalRef, requiredRef, text } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { unrestrictedOrder } from "@/modules/workshop/customers/public";
import { APPROVAL_METHODS, ORDER_ITEM_KINDS, ORDER_STATUSES } from "./constants";
import { addFindingOperation, approveOperation, closeOrderOperation, createOrderOperation, saveItemsOperation, setStatusOperation, updateOrderOperation } from "./operations";

/**
 * API-Ressourcen der Aufträge (`/api/v1/orders`, `/order-items`, `/order-approvals`). Alle schreibenden Wege laufen über dieselben Operationen wie die Oberfläche (Statuskette, Kilometerstand,
 * atomarer Abschluss mit den Abonnenten, Zähler der Nummer, Audit).
 *
 *  - `/orders` enthält **keine Preise** (Recht `orders.view`); Positionen und Freigabebeträge stehen in `/order-items` und `/order-approvals` und brauchen `orders.prices`.
 *  - Positionen ersetzt man als Ganzes: `POST /orders/{id}/items` (wie der Editor in der Oberfläche; `If-Match`). Befund anlegen: `POST /orders/{id}/findings`.
 *  - Freigaben (Protokoll) sind **nur lesend und anlegend**; die Unterschrift am Tablet gibt es nicht über die API (telefonisch oder getippter Name mit Bestätigung).
 *  - Nicht über die API: „Wieder öffnen“ (hebt einen Abschluss samt Rückbuchungen auf – eine bewusste Handlung in der Oberfläche) und das Entfernen von Befunden (`api-exceptions.ts`).
 *  - Aufträge eingeschränkter Kunden (Art. 18 DSGVO) – auch solche an einem Fahrzeug, dessen Halter eingeschränkt ist – gibt es für die API nicht (404).
 */

/** Aufträge, deren Kunde **und** deren Fahrzeughalter nicht eingeschränkt sind (`customers/public.ts`) – die Bedingung für alle Ressourcen hier. */
const UNRESTRICTED = unrestrictedOrder;

const orderItem = z.object({
  id: z.string(),
  version: z.string(),
  number: z.string(),
  status: z.enum(ORDER_STATUSES),
  vehicleId: z.string(),
  customerId: nullableString,
  appointmentId: nullableString,
  request: nullableString,
  mileageKm: z.number().int().nullable(),
  acceptedAt: z.string(),
  closedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createBody = z.strictObject({
  vehicleId: requiredRef,
  /** nur nötig, wenn das Fahrzeug keinen Halter hat */
  customerId: optionalRef,
  appointmentId: optionalRef,
  request: text(4000),
  /** Kilometerstand bei Annahme; schreibt – wenn höher – ins Fahrzeug */
  mileageKm: z.number().int().min(0).max(9_999_999).nullable().optional(),
});

/**
 * Eine Position zum Ersetzen. Sie ist **die Form von `GET /order-items`**: Lesen, ändern, zurückschicken erhält alles – auch den Verweis auf eine andere Funktion (`refType`/`refId`, z. B.
 * der Artikel aus Teile & Lager; nur damit bucht der Abschluss ab). `id`, `orderId` und `position` werden beim Lesen geliefert und hier ignoriert (die Reihenfolge ist die des Arrays).
 */
const lineBody = z.strictObject({
  id: z.string().max(64).optional(),
  orderId: z.string().max(64).optional(),
  position: z.number().int().optional(),
  description: z.string().min(1).max(MAX_ITEM_DESCRIPTION),
  unit: z.string().max(20).optional(),
  kind: z.enum(ORDER_ITEM_KINDS).optional(),
  /** Menge in Tausendsteln (1,5 = 1500) */
  quantityMilli: z.number().int(),
  /** Netto-Einzelpreis in Cent */
  unitCents: z.number().int(),
  /** Steuersatz in Basispunkten (19 % = 1900) */
  taxBp: z.number().int().min(0).max(10_000),
  discountBp: z.number().int().min(0).max(10_000).optional(),
  /** Verweis einer anderen Funktion (beide oder keiner; `refType: "article"` meint einen Artikel, ein unbekannter Artikel ist 422) */
  refType: z.string().min(1).max(20).nullable().optional(),
  refId: z.string().min(1).max(64).nullable().optional(),
});

/** Körper → Eingabe der Operation: nur die Felder, die die Operation kennt (`null` und die Nur-Lese-Felder `id`, `orderId`, `position` entfallen). */
const itemsInput = (items: Array<z.output<typeof lineBody>>): string =>
  JSON.stringify(
    items.map((item) => ({
      description: item.description,
      unit: item.unit,
      kind: item.kind,
      quantityMilli: item.quantityMilli,
      unitCents: item.unitCents,
      taxBp: item.taxBp,
      discountBp: item.discountBp,
      ...(item.refType != null ? { refType: item.refType } : {}),
      ...(item.refId != null ? { refId: item.refId } : {}),
    })),
  );

export const orderEndpoints = defineResource({
  feature: "workshop.orders",
  tag: "Orders",
  name: "orders",
  singular: "order",
  path: "/orders",
  read: "orders.view",
  model: db.order as unknown as Delegate<Order>,
  scope: UNRESTRICTED,
  item: orderItem,
  version: versionOf,
  toItem: (o): z.input<typeof orderItem> => ({
    id: o.id,
    version: versionOf(o),
    number: o.number,
    status: oneOf(ORDER_STATUSES, o.status, "accepted"),
    vehicleId: o.vehicleId,
    customerId: o.customerId,
    appointmentId: o.appointmentId,
    request: o.request,
    mileageKm: o.mileageKm,
    acceptedAt: iso(o.acceptedAt),
    closedAt: isoOrNull(o.closedAt),
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  }),
  list: {
    filters: z.strictObject({
      status: z.enum(ORDER_STATUSES).optional(),
      vehicleId: z.string().max(64).optional(),
      customerId: z.string().max(64).optional(),
      appointmentId: z.string().max(64).optional(),
      number: z.string().max(40).optional(),
    }),
    where: ({ status, vehicleId, customerId, appointmentId, number }) => ({
      ...(status ? { status } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(appointmentId ? { appointmentId } : {}),
      ...(number ? { number } : {}),
    }),
    sorts: { acceptedAt: (dir) => ({ acceptedAt: dir }), number: (dir) => ({ number: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "acceptedAt", dir: "desc" }],
  },
  create: {
    permission: "orders.create",
    operation: createOrderOperation,
    body: createBody,
    toInput: (b) => b,
  },
  update: {
    permission: "orders.edit",
    operation: updateOrderOperation,
    body: z.strictObject({ request: text(4000), mileageKm: z.number().int().min(0).max(9_999_999).nullable().optional() }),
    current: (o) => ({ request: o.request, mileageKm: o.mileageKm }),
    toInput: (merged, { id, version }) => ({ ...merged, id, version }),
  },
  actions: [
    {
      name: "status",
      summary: "Step the order along its chain (accepted, in_progress, ready, cancelled; send the current ETag in If-Match). 'picked_up' is only reachable through /close",
      permission: "orders.edit",
      operation: setStatusOperation,
      body: z.strictObject({ status: z.enum(["accepted", "in_progress", "ready", "cancelled"]) }),
      ifMatch: true,
      toInput: (id, b, { version }) => ({ id, status: b.status, version }),
    },
    {
      name: "close",
      summary: "Close the order ('picked_up'); subscribers (e.g. stock bookings) run in the same transaction – if one fails, nothing is booked and the order stays open",
      permission: "orders.close",
      operation: closeOrderOperation,
      ifMatch: true,
      toInput: (id, _b, { version }) => ({ id, version }),
    },
    {
      name: "items",
      summary: "Replace all positions of an open order (needs orders.edit and orders.prices; send the current ETag in If-Match)",
      permission: "orders.edit",
      alsoRequires: ["orders.prices"],
      operation: saveItemsOperation,
      body: z.strictObject({ items: z.array(lineBody).max(200) }),
      ifMatch: true,
      toInput: (id, b, { version }) => ({ id, version, items: itemsInput(b.items as Array<z.output<typeof lineBody>>) }),
    },
    {
      name: "findings",
      summary: "Add a finding (free text) to an open order",
      permission: "orders.edit",
      operation: addFindingOperation,
      body: z.strictObject({ text: z.string().min(1).max(2000) }),
      toInput: (id, b) => ({ id, text: b.text }),
    },
  ],
});

const itemShape = z.object({
  id: z.string(),
  orderId: z.string(),
  position: z.number().int(),
  kind: z.enum(ORDER_ITEM_KINDS),
  description: z.string(),
  unit: z.string(),
  quantityMilli: z.number().int(),
  unitCents: z.number().int(),
  taxBp: z.number().int(),
  discountBp: z.number().int(),
  refType: nullableString,
  refId: nullableString,
});

/** Positionen: nur lesend (ersetzt wird über `POST /orders/{id}/items`); mit Preisen, deshalb `orders.prices`. */
export const itemEndpoints = defineResource({
  feature: "workshop.orders",
  tag: "Orders",
  name: "order-items",
  singular: "order item",
  path: "/order-items",
  read: "orders.prices",
  model: db.orderItem as unknown as Delegate<OrderItem>,
  scope: { order: UNRESTRICTED },
  item: itemShape,
  toItem: (i): z.input<typeof itemShape> => ({
    id: i.id,
    orderId: i.orderId,
    position: i.position,
    kind: oneOf(ORDER_ITEM_KINDS, i.kind, "labor"),
    description: i.description,
    unit: i.unit,
    quantityMilli: i.quantityMilli,
    unitCents: i.unitCents,
    taxBp: i.taxBp,
    discountBp: i.discountBp,
    refType: i.refType,
    refId: i.refId,
  }),
  list: {
    filters: z.strictObject({ orderId: z.string().max(64).optional() }),
    where: ({ orderId }) => (orderId ? { orderId } : {}),
    sorts: { position: (dir) => ({ position: dir }) },
    defaultSort: [{ key: "position", dir: "asc" }],
  },
});

const approvalShape = z.object({
  id: z.string(),
  orderId: z.string(),
  amountCents: z.number().int(),
  reason: z.string(),
  method: z.enum(APPROVAL_METHODS),
  approverName: z.string(),
  recordedByName: z.string(),
  createdAt: z.string(),
});

/** Freigabe-Protokoll: lesen und anlegen, nie ändern oder löschen. */
export const approvalEndpoints = defineResource({
  feature: "workshop.orders",
  tag: "Orders",
  name: "order-approvals",
  singular: "order approval",
  path: "/order-approvals",
  read: "orders.prices",
  model: db.orderApproval as unknown as Delegate<OrderApproval>,
  scope: { order: UNRESTRICTED },
  item: approvalShape,
  toItem: (a): z.input<typeof approvalShape> => ({
    id: a.id,
    orderId: a.orderId,
    amountCents: a.amountCents,
    reason: a.reason,
    method: oneOf(APPROVAL_METHODS, a.method, "phone"),
    approverName: a.approverName,
    recordedByName: a.recordedByName,
    createdAt: iso(a.createdAt),
  }),
  list: {
    filters: z.strictObject({ orderId: z.string().max(64).optional() }),
    where: ({ orderId }) => (orderId ? { orderId } : {}),
    sorts: { createdAt: (dir) => ({ createdAt: dir }) },
    defaultSort: [{ key: "createdAt", dir: "asc" }],
  },
  create: {
    permission: "orders.edit",
    alsoRequires: ["orders.prices"],
    operation: approveOperation,
    body: z.strictObject({
      orderId: requiredRef,
      /** freigegebener Mehrbetrag, brutto, in Cent */
      amountCents: z.number().int().min(1),
      reason: z.string().min(1).max(1000),
      /** `phone`: telefonisch; `typed`: getippter Name mit Bestätigung (die Unterschrift am Tablet gibt es nur in der Oberfläche) */
      method: z.enum(["phone", "typed"]),
      approverName: z.string().min(1).max(80),
    }),
    toInput: (b) => ({
      id: b.orderId,
      amount: centsText(b.amountCents),
      reason: b.reason,
      method: b.method === "phone" ? "phone" : "signature",
      approverName: b.approverName,
      ...(b.method === "typed" ? { signature: `typed:${b.approverName}` } : {}),
    }),
    rename: { id: "orderId", amount: "amountCents" },
    // Aufträge eingeschränkter Kunden (Art. 18) gibt es für die API nicht – auch nicht zum Anlegen einer (unveränderlichen) Freigabe
    parentVisible: async (b) => (await db.order.count({ where: { id: b.orderId, ...UNRESTRICTED } })) > 0,
  },
});

export const endpoints = [...orderEndpoints, ...itemEndpoints, ...approvalEndpoints];
