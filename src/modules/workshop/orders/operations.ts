import { createHash } from "node:crypto";
import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { currentYear } from "@/lib/dates";
import { computeTotals } from "@/lib/line-items";
import { lineItemsInput } from "@/lib/line-items-schema";
import { moneyCents } from "@/lib/zod-fields";
import { parseSignatureValue } from "@/lib/signature";
import { nextCounterValue } from "@/server/counters";
import { removeFile, storeFile } from "@/server/files";
import { writeAudit } from "@/server/audit";
import { auditActorName, defineOperation, fail, failField, fieldErrors, OperationError, type Principal, type RunContext, type Tx } from "@/server/operations";
import { runOperationHooks } from "@/server/operations/hooks";
import { ORDER_COUNTER, ORDER_ITEM_KINDS, type ApprovalMethod, type OrderEventKind, type OrderStatus } from "./constants";
import { CLOSABLE, canStep, formatOrderNumber, isOpen, mileageDecision, sameName } from "./domain";
import { isRestricted, restrictionSelect, searchableCustomerWhere } from "@/modules/workshop/customers/public";

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
 * Legt einen Auftrag an (Nummer aus dem Zähler in derselben Transaktion – lückenlos). Andere Funktionen (Angebot → Auftrag, F3) nutzen die Operation über `public.ts`:
 * `createOrderOperation` (eigene Transaktion) oder – wenn das Anlegen mit dem eigenen Schreiben **atomar** sein muss – `createOrderInTx` (in der Transaktion des Aufrufers).
 */
export async function createOrderRun({ input: d, principal, tx, audit, emit }: RunContext<CreateOrderInput, undefined>): Promise<{ id: string; number: string; mileage: "none" | "write" | "keep" }> {
  const vehicle = await tx.vehicle.findUnique({
    where: { id: d.vehicleId },
    select: { id: true, plate: true, customerId: true, archivedAt: true, customer: { select: restrictionSelect } },
  });
  if (!vehicle || vehicle.archivedAt) failField("vehicleId", "validation.invalid");

  // Kunde: hat das Fahrzeug einen Halter, gilt er (ein anderer wäre ein Widerspruch); sonst der gewählte Kunde. Eingeschränkte Kunden (Art. 18) bekommen keine neuen Verknüpfungen.
  let customerId: string | null = vehicle.customerId;
  if (vehicle.customerId) {
    if (d.customerId && d.customerId !== vehicle.customerId) failField("customerId", "orders.errors.customerMismatch");
    if (isRestricted(vehicle.customer)) failField("vehicleId", "orders.errors.customerRestricted");
  } else if (d.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: d.customerId, ...searchableCustomerWhere }, select: { id: true } });
    if (!customer) failField("customerId", "validation.invalid");
    customerId = customer.id;
  }

  let appointmentId: string | null = null;
  if (d.appointmentId) {
    // Weiche Abhängigkeit: ein Termin lässt sich nur verknüpfen, wenn die Terminfunktion aktiv ist und die Person Termine sehen darf (sonst verrieten die Meldungen Bestand und Status fremder Termine)
    if (!principal.can("appointments.view")) failField("appointmentId", "validation.invalid");
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
  // Der Kilometerstand geht ins Fahrzeug (nur aufwärts): das Audit-Log nennt es, denn am Fahrzeug selbst entsteht kein Eintrag
  audit({ target: `${number} · ${vehicle.plate}${mileage === "write" ? ` · ${d.mileageKm} km → Fahrzeug` : ""}`, entityId: order.id });
  return { id: order.id, number, mileage };
}

/**
 * Auftrag anlegen **in der Transaktion des Aufrufers** (Angebot → Auftrag, F3: Angebot annehmen und Auftrag anlegen gelingen nur gemeinsam). Gleiche Regeln wie `createOrderOperation`:
 * Recht `orders.create` der handelnden Person, Eingabeprüfung, Zähler, Ereignis, Audit-Eintrag `orders.create` und die Hooks auf `orders.create` laufen mit – alles in `tx`; ein Fehler
 * (`OperationError`) rollt mit der Transaktion des Aufrufers zurück. Der Aufrufer prüft sein eigenes Recht selbst und reicht `principal`, `tx` und `emit` seines `RunContext` durch.
 */
export async function createOrderInTx(
  ctx: { principal: Principal; tx: Tx; emit: RunContext<unknown, unknown>["emit"] },
  raw: z.input<typeof createOrderInput>,
): Promise<{ id: string; number: string; mileage: "none" | "write" | "keep" }> {
  const { principal, tx, emit } = ctx;
  if (!principal.can("orders.create")) fail("forbidden");
  const parsed = createOrderInput.safeParse(raw);
  if (!parsed.success) throw new OperationError({ code: "invalid", fields: fieldErrors(parsed.error) });
  let details: { target?: string | null; entityId?: string | null } = {};
  const data = await createOrderRun({
    name: "orders.create",
    input: parsed.data,
    principal,
    prepared: undefined,
    tx,
    emit,
    audit: (value) => {
      details = value;
    },
    afterCommit: () => undefined,
    onRollback: () => undefined,
  });
  await runOperationHooks({ operation: "orders.create", input: parsed.data, result: data, principal, tx });
  await writeAudit(tx, "order.create", { ...details, actor: { id: principal.user.id, name: auditActorName(principal) } });
  return data;
}

export const createOrderOperation = defineOperation({
  name: "orders.create",
  permission: "orders.create",
  input: createOrderInput,
  audit: "order.create",
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
  audit: "order.update",
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
  audit: "order.status",
  run: async ({ input: d, principal, tx, audit, emit }): Promise<OrderChange> => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true, appointmentId: true } });
    if (!order) fail("notFound");
    if (order.status === d.status) fail("conflict");
    if (!canStep(order.status, d.status)) fail("invalid", "orders.errors.statusStep");
    // Wiederaufnahme eines stornierten Auftrags: Hat der Termin inzwischen einen anderen (nicht stornierten) Auftrag, gäbe es zwei aktive Aufträge zu einem Termin
    if (order.status === "cancelled" && order.appointmentId && (await tx.order.findFirst({ where: { appointmentId: order.appointmentId, status: { not: "cancelled" }, id: { not: d.id } }, select: { id: true } }))) {
      fail("duplicate", "orders.errors.appointmentTaken");
    }
    if (!(await claimRow(tx.order, d.id, d.version))) fail("conflict");
    await tx.order.update({ where: { id: d.id }, data: { status: d.status } });
    await addEvent(tx, d.id, "status", byName(principal), { status: d.status });
    await emit("order.statusChanged", { number: order.number, status: d.status }, d.id);
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
  audit: "order.close",
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
  audit: "order.reopen",
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
  audit: "order.items",
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
    return { id: d.id, number: order.number, count: d.items.length };
  },
});

/* ───────────── Befunde ───────────── */

export const addFindingOperation = defineOperation({
  name: "orders.addFinding",
  permission: "orders.edit",
  input: z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(2000) }),
  audit: "order.finding",
  run: async ({ input: d, principal, tx, audit }) => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true } });
    if (!order) fail("notFound");
    if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
    const row = await tx.orderFinding.create({ data: { orderId: d.id, text: d.text, authorName: byName(principal) }, select: { id: true } });
    audit({ target: order.number, entityId: d.id });
    return { id: d.id, number: order.number, findingId: row.id };
  },
});

export const removeFindingOperation = defineOperation({
  name: "orders.removeFinding",
  permission: "orders.edit",
  input: z.object({ id: z.string().min(1), findingId: z.string().min(1) }),
  audit: "order.findingRemove",
  run: async ({ input: d, tx, audit }) => {
    const finding = await tx.orderFinding.findFirst({ where: { id: d.findingId, orderId: d.id }, select: { id: true, authorName: true, createdAt: true, order: { select: { number: true, status: true } } } });
    if (!finding) fail("notFound");
    if (!isOpen(finding.order.status)) fail("invalid", "orders.errors.closed");
    await tx.orderFinding.delete({ where: { id: finding.id } });
    // Befunde sind Aufzeichnungen: Das Audit-Log hält fest, wessen Befund (von wann) entfernt wurde – nicht den Text
    audit({ target: `${finding.order.number} · ${finding.authorName}, ${finding.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, entityId: d.id });
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

/**
 * Gespeicherte Unterschrift, die `prepare` vor der Transaktion angelegt hat (die Datei wird wieder entfernt, wenn die Transaktion scheitert): Datei und Prüfsumme des Bildes bei einer
 * Zeichnung, der bestätigte Name beim Tippen.
 */
type PreparedApproval = { method: ApprovalMethod; path: string | null; hash: string | null; signedName: string | null };

/**
 * Protokolliert die Freigabe einer Mehrarbeit: Betrag, Zeitpunkt, Art (Unterschrift/getippt/telefonisch), freigebende Person und wer erfasst hat. **Unveränderlich:** es gibt weder
 * Ändern noch Löschen. Die Unterschrift (PNG) liegt als Datei unter `/data/files`, nie in der Datenbank. Betrag ⇒ nur mit `orders.prices`.
 */
export const approveOperation = defineOperation({
  name: "orders.approve",
  permission: "orders.edit",
  input: approvalInput,
  audit: "order.approve",
  prepare: async ({ input: d, principal }): Promise<PreparedApproval> => {
    if (!principal.can("orders.prices")) fail("forbidden");
    if (d.amount <= 0 || d.amount > MAX_APPROVAL_CENTS) failField("amount", "validation.invalid");
    if (d.method === "phone") return { method: "phone", path: null, hash: null, signedName: null };
    const value = parseSignatureValue(d.signature ?? "");
    if (!value) failField("signature", "orders.errors.signatureMissing");
    if (value.kind === "typed") {
      // Das Tippen des Namens ersetzt die Unterschrift – es muss die freigebende Person meinen (sonst bestätigte jemand mit einem anderen Namen)
      if (!sameName(value.name, d.approverName)) failField("signature", "orders.errors.approvalNameMismatch");
      return { method: "typed", path: null, hash: null, signedName: value.name };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const hash = createHash("sha256").update(value.png).digest("hex");
    return { method: "signature", path: await storeFile("auftraege/freigaben", `freigabe-${stamp}.png`, value.png), hash, signedName: null };
  },
  run: async ({ input: d, principal, prepared, tx, audit, emit }) => {
    const order = await tx.order.findUnique({ where: { id: d.id }, select: { number: true, status: true } });
    if (!order) fail("notFound");
    if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
    // Eine Unterschrift gilt für genau eine Freigabe: dasselbe Bild nochmals (Zeichnung stehen geblieben, wieder abgeschickt) ist keine neue Unterschrift
    if (prepared.hash && (await tx.orderApproval.findFirst({ where: { signatureHash: prepared.hash }, select: { id: true } }))) failField("signature", "orders.errors.signatureReused");
    const who = byName(principal);
    const approval = await tx.orderApproval.create({
      data: {
        orderId: d.id,
        amountCents: d.amount,
        reason: d.reason,
        method: prepared.method,
        approverName: d.approverName,
        signaturePath: prepared.path,
        signatureHash: prepared.hash,
        signedName: prepared.signedName,
        recordedByName: who,
      },
      select: { id: true },
    });
    await addEvent(tx, d.id, "approval", who, { note: d.approverName });
    await emit("order.approved", { number: order.number }, d.id);
    // Das Audit-Log nennt nur die Auftragsnummer, nie den Namen der freigebenden Person (er bliebe nach einer Anonymisierung sonst dort stehen)
    audit({ target: order.number, entityId: d.id });
    return { id: approval.id, orderId: d.id };
  },
  finish: async (prepared, ok) => {
    if (!ok && prepared?.path) await removeFile(prepared.path);
  },
});

/* ───────────── Positionen anhängen (andere Funktionen) ───────────── */

/** Eine Position, die eine andere Funktion an einen offenen Auftrag hängt (Menge in Tausendsteln, Preis netto in Cent). */
export type AppendedLine = { kind: "labor" | "part" | "other"; description: string; unit: string; quantityMilli: number; unitCents: number; taxBp: number; refType: string; refId: string; /** Rabatt in Basispunkten (Standard 0) */ discountBp?: number };

const MAX_ITEMS = 200;

/**
 * Hängt Positionen **in der Transaktion des Aufrufers** an einen offenen Auftrag (Zeiten als Positionen übernehmen, F5): fügt am Ende ein, hebt die Version des Auftrags (offene Bearbeiten-Formulare
 * melden danach einen Konflikt statt die neuen Positionen still zu überschreiben) und prüft Obergrenzen (Zahl der Positionen, Gesamtbetrag). Rechte prüft der Aufrufer (`orders.edit` und `orders.prices`);
 * die Hooks von `orders.saveItems` laufen nicht (die Verweise tragen eine fremde `refType`). Liefert die Kennungen der neuen Positionen in der Reihenfolge der `lines`.
 */
export async function appendOrderItems(tx: Tx, orderId: string, lines: readonly AppendedLine[]): Promise<string[]> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!order) fail("notFound");
  if (!isOpen(order.status)) fail("invalid", "orders.errors.closed");
  const existing = await tx.orderItem.findMany({ where: { orderId }, orderBy: { position: "asc" }, select: { position: true, quantityMilli: true, unitCents: true, taxBp: true, discountBp: true } });
  if (existing.length + lines.length > MAX_ITEMS) fail("invalid", "validation.tooLong");
  const totals = computeTotals([...existing, ...lines.map((l) => ({ quantityMilli: l.quantityMilli, unitCents: l.unitCents, taxBp: l.taxBp, discountBp: l.discountBp ?? 0 }))], { exempt: false });
  if (totals.exceedsLimit) fail("invalid", "validation.tooLarge");
  let position = existing.reduce((max, item) => Math.max(max, item.position), -1) + 1;
  const ids: string[] = [];
  for (const line of lines) {
    const row = await tx.orderItem.create({ data: { orderId, position: position++, kind: line.kind, description: line.description, unit: line.unit, quantityMilli: line.quantityMilli, unitCents: line.unitCents, taxBp: line.taxBp, discountBp: line.discountBp ?? 0, refType: line.refType, refId: line.refId }, select: { id: true } });
    ids.push(row.id);
  }
  await tx.order.update({ where: { id: orderId }, data: { updatedAt: new Date() } });
  return ids;
}
