import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { currentYear } from "@/lib/dates";
import { lineItemsInput } from "@/lib/line-items";
import { moneyCents } from "@/lib/zod-fields";
import { parseSignatureValue } from "@/lib/signature";
import { nextCounterValue } from "@/server/counters";
import { removeFile, storeFile } from "@/server/files";
import { defineOperation, fail, failField, type RunContext, type Tx } from "@/server/operations";
import { ORDER_COUNTER, ORDER_ITEM_KINDS, type ApprovalMethod, type OrderEventKind, type OrderStatus } from "./constants";
import { CLOSABLE, canStep, formatOrderNumber, isOpen, mileageDecision } from "./domain";

/**
 * Operationen der Werkstattaufträge. Kette: Anlegen → Status (In Arbeit, Fertig, zurück, Storniert) → **Abschließen** („Abgeholt“) → ggf. **Wieder öffnen**.
 * Abschluss und Wiedereröffnen sind die zwei Operationen, an die sich andere Funktionen per transaktionalem Hook hängen (Teile & Lager bucht ab bzw. zurück; später Zeiten, Rechnung):
 * ihr **Ergebnis** nennt dafür alles, was ein Abonnent braucht (Nummer, Termin, Positionen ohne Preise) – die Abonnenten lesen keine Tabelle des Auftrags.
 * Preise stehen nie im Ergebnis. Aufträge werden nie gelöscht.
 */

const MAX_KM = 9_999_999;

/** Was die Abonnenten des Abschlusses/Wiederöffnens zum Auftrag erfahren. */
export type OrderChange = {
  id: string;
  number: string;
  status: OrderStatus;
  /** bisheriger Status */
  previous: OrderStatus;
  appointmentId: string | null;
  /** Positionen ohne Preise (Menge in Tausendsteln, Verweis einer anderen Funktion) */
  items: Array<{ id: string; kind: string; description: string; unit: string; quantityMilli: number; refType: string | null; refId: string | null }>;
};

const byName = (principal: { user: { name: string } }): string => principal.user.name.slice(0, 80);

async function addEvent(tx: Tx, orderId: string, kind: OrderEventKind, who: string, extra: { status?: string; note?: string } = {}): Promise<void> {
  await tx.orderEvent.create({ data: { orderId, kind, byName: who, status: extra.status ?? null, note: extra.note ?? null } });
}

/** Schreibt den Kilometerstand bei Annahme ins Fahrzeug – nur wenn er höher ist als der bisherige (Hinweis statt Fehler sonst). */
async function applyMileage(tx: Tx, vehicleId: string, km: number | null | undefined): Promise<"none" | "write" | "keep"> {
  if (km == null) return "none";
  const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { mileageKm: true } });
  const decision = mileageDecision(vehicle?.mileageKm ?? null, km);
  if (decision === "write") await tx.vehicle.update({ where: { id: vehicleId }, data: { mileageKm: km } });
  return decision;
}

const itemsOf = (orderId: string, tx: Tx) =>
  tx.orderItem.findMany({
    where: { orderId },
    orderBy: { position: "asc" },
    select: { id: true, kind: true, description: true, unit: true, quantityMilli: true, refType: true, refId: true },
  });

/* ───────────── Anlegen und Ändern ───────────── */

export const createOrderInput = z.object({
  vehicleId: z.string().min(1),
  /** Kunde direkt – nur nötig, wenn das Fahrzeug keinen Halter hat */
  customerId: z.string().optional(),
  appointmentId: z.string().optional(),
  request: z.string().max(4000).optional(),
  mileageKm: z.coerce.number().int().min(0).max(MAX_KM).optional(),
});
export type CreateOrderInput = z.output<typeof createOrderInput>;

/**
 * Legt einen Auftrag an (Nummer aus dem Zähler in derselben Transaktion – lückenlos). Andere Funktionen (Angebot → Auftrag, F3) nutzen die Operation über `public.ts`
 * (`createOrderOperation`).
 */
export async function createOrderRun({ input: d, principal, tx, audit, emit }: RunContext<CreateOrderInput, undefined>): Promise<{ id: string; number: string; mileage: "none" | "write" | "keep" }> {
  const vehicle = await tx.vehicle.findUnique({
    where: { id: d.vehicleId },
    select: { id: true, plate: true, customerId: true, archivedAt: true, customer: { select: { archivedAt: true, processingRestrictedAt: true } } },
  });
  if (!vehicle || vehicle.archivedAt) failField("vehicleId", "validation.invalid");

  // Kunde: hat das Fahrzeug einen Halter, gilt er (ein anderer wäre ein Widerspruch); sonst der gewählte Kunde. Eingeschränkte Kunden (Art. 18) bekommen keine neuen Verknüpfungen.
  let customerId: string | null = vehicle.customerId;
  if (vehicle.customerId) {
    if (d.customerId && d.customerId !== vehicle.customerId) failField("customerId", "orders.errors.customerMismatch");
    if (vehicle.customer?.processingRestrictedAt) failField("vehicleId", "orders.errors.customerRestricted");
  } else if (d.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: d.customerId, archivedAt: null, processingRestrictedAt: null }, select: { id: true } });
    if (!customer) failField("customerId", "validation.invalid");
    customerId = customer.id;
  }

  let appointmentId: string | null = null;
  if (d.appointmentId) {
    const appointment = await tx.appointment.findUnique({ where: { id: d.appointmentId }, select: { id: true, vehicleId: true, status: true } });
    if (!appointment) failField("appointmentId", "validation.invalid");
    if (appointment.vehicleId && appointment.vehicleId !== vehicle.id) failField("appointmentId", "orders.errors.appointmentVehicle");
    if (appointment.status === "cancelled" || appointment.status === "no_show") failField("appointmentId", "orders.errors.appointmentCancelled");
    if (await tx.order.findFirst({ where: { appointmentId: appointment.id, status: { not: "cancelled" } }, select: { id: true } })) fail("duplicate", "orders.errors.appointmentTaken");
    appointmentId = appointment.id;
  }

  const year = currentYear();
  const number = formatOrderNumber(year, await nextCounterValue(tx, ORDER_COUNTER, year));
  const who = byName(principal);
  const order = await tx.order.create({
    data: { number, vehicleId: vehicle.id, customerId, appointmentId, request: d.request ?? null, mileageKm: d.mileageKm ?? null, createdByName: who },
    select: { id: true },
  });
  await addEvent(tx, order.id, "created", who);
  const mileage = await applyMileage(tx, vehicle.id, d.mileageKm);
  await emit("order.created", { number }, order.id);
  audit({ target: `${number} · ${vehicle.plate}`, entityId: order.id });
  return { id: order.id, number, mileage };
}

export const createOrderOperation = defineOperation({
  name: "orders.create",
  permission: "orders.create",
  input: createOrderInput,
  audit: "orders.create",
  run: createOrderRun,
});

const updateOrderInput = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  request: z.string().max(4000).optional(),
  mileageKm: z.coerce.number().int().min(0).max(MAX_KM).optional(),
});

export const updateOrderOperation = defineOperation({
  name: "orders.update",
  permission: "orders.edit",
  input: updateOrderInput,
  audit: "orders.update",
  run: async ({ input: d, tx, audit }) => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true, vehicleId: true, mileageKm: true } });
    if (!order) fail("notFound");
    if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
    if (!(await claimRow(tx.order, d.id, d.version))) fail("conflict");
    await tx.order.update({ where: { id: d.id }, data: { request: d.request ?? null, mileageKm: d.mileageKm ?? null } });
    // nur ein geänderter Stand wird dem Fahrzeug gemeldet (derselbe Wert nochmals ist kein Hinweis wert)
    const mileage = d.mileageKm != null && d.mileageKm !== order.mileageKm ? await applyMileage(tx, order.vehicleId, d.mileageKm) : "none";
    audit({ target: order.number, entityId: d.id });
    return { id: d.id, mileage };
  },
});

/* ───────────── Statuskette ───────────── */

const stepInput = z.object({ id: z.string().min(1), version: z.string().min(1), status: z.enum(["accepted", "in_progress", "ready", "cancelled"]) });

/** Ein Schritt der Kette (In Arbeit, Fertig, zurück, Storniert, Wiederaufnahme). „Abgeholt“ gibt es nur über `orders.close`. */
export const setStatusOperation = defineOperation({
  name: "orders.setStatus",
  permission: "orders.edit",
  input: stepInput,
  audit: "orders.status",
  run: async ({ input: d, principal, tx, audit, emit }): Promise<OrderChange> => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true, appointmentId: true } });
    if (!order) fail("notFound");
    if (order.status === d.status) fail("conflict");
    if (!canStep(order.status, d.status)) fail("invalid", "orders.errors.statusStep");
    if (!(await claimRow(tx.order, d.id, d.version))) fail("conflict");
    await tx.order.update({ where: { id: d.id }, data: { status: d.status } });
    await addEvent(tx, d.id, "status", byName(principal), { status: d.status });
    await emit("order.status", { number: order.number, status: d.status }, d.id);
    audit({ target: `${order.number}: ${d.status}`, entityId: d.id });
    return { id: d.id, number: order.number, status: d.status, previous: order.status as OrderStatus, appointmentId: order.appointmentId, items: await itemsOf(d.id, tx) };
  },
});

const closeInput = z.object({ id: z.string().min(1), version: z.string().min(1) });

/**
 * Auftrag abschließen („Abgeholt“). **Atomar mit den Abonnenten:** Hooks auf `orders.close` laufen in derselben Transaktion (Teile & Lager bucht ab); wirft einer, bleibt der Auftrag offen
 * und nichts ist gebucht. Der Auftrag kennt seine Abonnenten nicht.
 */
export const closeOrderOperation = defineOperation({
  name: "orders.close",
  permission: "orders.close",
  input: closeInput,
  audit: "orders.close",
  run: async ({ input: d, principal, tx, audit, emit }): Promise<OrderChange> => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true, appointmentId: true } });
    if (!order) fail("notFound");
    if (!CLOSABLE.includes(order.status as OrderStatus)) fail("invalid", "orders.errors.notClosable");
    if (!(await claimRow(tx.order, d.id, d.version))) fail("conflict");
    await tx.order.update({ where: { id: d.id }, data: { status: "picked_up", closedAt: new Date() } });
    await addEvent(tx, d.id, "status", byName(principal), { status: "picked_up" });
    await emit("order.closed", { number: order.number }, d.id);
    audit({ target: order.number, entityId: d.id });
    return { id: d.id, number: order.number, status: "picked_up", previous: order.status as OrderStatus, appointmentId: order.appointmentId, items: await itemsOf(d.id, tx) };
  },
});

/**
 * Abgeschlossenen Auftrag wieder öffnen (eigenes Recht `orders.reopen`, gekennzeichnet): zurück auf „Fertig“, Audit; die Hooks auf `orders.reopen` buchen zurück (Teile & Lager).
 * Nur so lässt sich ein abgeschlossener Auftrag ändern.
 */
export const reopenOrderOperation = defineOperation({
  name: "orders.reopen",
  permission: "orders.reopen",
  input: closeInput,
  audit: "orders.reopen",
  run: async ({ input: d, principal, tx, audit, emit }): Promise<OrderChange> => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true, appointmentId: true } });
    if (!order) fail("notFound");
    if (order.status !== "picked_up") fail("invalid", "orders.errors.notClosed");
    if (!(await claimRow(tx.order, d.id, d.version))) fail("conflict");
    await tx.order.update({ where: { id: d.id }, data: { status: "ready", closedAt: null } });
    await addEvent(tx, d.id, "reopened", byName(principal), { status: "ready" });
    await emit("order.reopened", { number: order.number }, d.id);
    audit({ target: order.number, entityId: d.id });
    return { id: d.id, number: order.number, status: "ready", previous: "picked_up", appointmentId: order.appointmentId, items: await itemsOf(d.id, tx) };
  },
});

/* ───────────── Positionen ───────────── */

const saveItemsInput = z.object({ id: z.string().min(1), version: z.string().min(1), items: lineItemsInput() });

/**
 * Ersetzt die Positionen (der Editor schickt immer alle). Preise sind Teil der Positionen: nur mit `orders.prices` (zusätzlich zu `orders.edit`). Der Server glaubt dem Browser
 * nur die Eingaben – die Summen entstehen bei der Anzeige aus den Zahlen (`computeTotals`). Verweise einer anderen Funktion (`refType`/`refId`) prüft deren Hook auf diese Operation.
 */
export const saveItemsOperation = defineOperation({
  name: "orders.saveItems",
  permission: "orders.edit",
  input: saveItemsInput,
  audit: "orders.items",
  run: async ({ input: d, principal, tx, audit }) => {
    if (!principal.can("orders.prices")) fail("forbidden");
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true } });
    if (!order) fail("notFound");
    if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
    d.items.forEach((item, i) => {
      if (item.kind && !(ORDER_ITEM_KINDS as readonly string[]).includes(item.kind)) failField(`items.${i}.kind`, "validation.invalid");
      if (!!item.refType !== !!item.refId) failField(`items.${i}.refId`, "validation.invalid");
    });
    if (!(await claimRow(tx.order, d.id, d.version))) fail("conflict");
    await tx.orderItem.deleteMany({ where: { orderId: d.id } });
    await tx.orderItem.createMany({
      data: d.items.map((item, position) => ({
        orderId: d.id,
        position,
        kind: item.kind || "labor",
        description: item.description,
        unit: item.unit,
        quantityMilli: item.quantityMilli,
        unitCents: item.unitCents,
        taxBp: item.taxBp,
        discountBp: item.discountBp,
        refType: item.refType || null,
        refId: item.refId || null,
      })),
    });
    audit({ target: `${order.number}: ${d.items.length}`, entityId: d.id });
    return { id: d.id, count: d.items.length };
  },
});

/* ───────────── Befunde ───────────── */

export const addFindingOperation = defineOperation({
  name: "orders.addFinding",
  permission: "orders.edit",
  input: z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(2000) }),
  audit: "orders.finding",
  run: async ({ input: d, principal, tx, audit }) => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true } });
    if (!order) fail("notFound");
    if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
    const row = await tx.orderFinding.create({ data: { orderId: d.id, text: d.text, authorName: byName(principal) }, select: { id: true } });
    audit({ target: order.number, entityId: d.id });
    return { id: d.id, findingId: row.id };
  },
});

export const removeFindingOperation = defineOperation({
  name: "orders.removeFinding",
  permission: "orders.edit",
  input: z.object({ id: z.string().min(1), findingId: z.string().min(1) }),
  audit: "orders.findingRemove",
  run: async ({ input: d, tx, audit }) => {
    const finding = await tx.orderFinding.findFirst({ where: { id: d.findingId, orderId: d.id }, select: { id: true, order: { select: { number: true, status: true } } } });
    if (!finding) fail("notFound");
    if (!isOpen(finding.order.status)) fail("invalid", "orders.errors.closed");
    await tx.orderFinding.delete({ where: { id: finding.id } });
    audit({ target: finding.order.number, entityId: d.id });
    return { id: d.id };
  },
});

/* ───────────── Kundenfreigabe bei Mehrarbeit ───────────── */

const MAX_APPROVAL_CENTS = 10_000_000 * 100;

export const approvalInput = z.object({
  id: z.string().min(1),
  /** freigegebener Mehrbetrag, brutto */
  amount: moneyCents("validation.invalid"),
  reason: z.string().trim().min(1).max(1000),
  /** `signature`: Unterschrift am Tablet (Feld `signature`: gezeichnet oder getippt mit Bestätigung); `phone`: telefonisch */
  method: z.enum(["signature", "phone"]),
  approverName: z.string().trim().min(1).max(80),
  signature: z.string().max(100_000).optional(),
});
export type ApprovalInput = z.output<typeof approvalInput>;

/** Gespeicherte Unterschrift, die `prepare` vor der Transaktion angelegt hat (die Datei wird wieder entfernt, wenn die Transaktion scheitert). */
type PreparedApproval = { method: ApprovalMethod; path: string | null };

/**
 * Protokolliert die Freigabe einer Mehrarbeit: Betrag, Zeitpunkt, Art (Unterschrift/getippt/telefonisch), freigebende Person und wer erfasst hat. **Unveränderlich:** es gibt weder
 * Ändern noch Löschen. Die Unterschrift (PNG) liegt als Datei unter `/data/files`, nie in der Datenbank. Betrag ⇒ nur mit `orders.prices`.
 */
export const approveOperation = defineOperation({
  name: "orders.approve",
  permission: "orders.edit",
  input: approvalInput,
  audit: "orders.approve",
  prepare: async ({ input: d, principal }): Promise<PreparedApproval> => {
    if (!principal.can("orders.prices")) fail("forbidden");
    if (d.amount <= 0 || d.amount > MAX_APPROVAL_CENTS) failField("amount", "validation.invalid");
    if (d.method === "phone") return { method: "phone", path: null };
    const value = parseSignatureValue(d.signature ?? "");
    if (!value) failField("signature", "orders.errors.signatureMissing");
    if (value.kind === "typed") return { method: "typed", path: null };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return { method: "signature", path: await storeFile("auftraege/freigaben", `freigabe-${stamp}.png`, value.png) };
  },
  run: async ({ input: d, principal, prepared, tx, audit, emit }) => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true } });
    if (!order) fail("notFound");
    if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
    const who = byName(principal);
    const approval = await tx.orderApproval.create({
      data: { orderId: d.id, amountCents: d.amount, reason: d.reason, method: prepared.method, approverName: d.approverName, signaturePath: prepared.path, recordedByName: who },
      select: { id: true },
    });
    await addEvent(tx, d.id, "approval", who, { note: d.approverName });
    await emit("order.approved", { number: order.number }, d.id);
    audit({ target: `${order.number} · ${d.approverName}`, entityId: d.id });
    return { id: approval.id, orderId: d.id };
  },
  finish: async (prepared, ok) => {
    if (!ok && prepared?.path) await removeFile(prepared.path);
  },
});
