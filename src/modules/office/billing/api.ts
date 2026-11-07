import { Readable } from "node:stream";
import { z } from "zod";
import type { Invoice, InvoiceItem, InvoicePayment } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { parseIfMatch } from "@/lib/api/query";
import { deliveryHeaders } from "@/lib/file-delivery";
import { centsText, day, dayOrNull, iso, isoOrNull, nullableString, oneOf, optionalDate, optionalRef, requiredRef, text } from "@/server/api/format";
import { defineResource, ID_SHAPE, type Delegate } from "@/server/api/resource";
import type { ApiEndpoint } from "@/server/api/types";
import { db } from "@/server/db";
import { EinvoiceError } from "@/lib/einvoice/ubl";
import { PdfError } from "@/server/pdf";
import { apiProblem, runApiOperation } from "@/server/operations";
import { getWorkshop } from "@/server/workshop";
import { CREATABLE_TYPES, DOC_TYPES, ITEM_KINDS, OFFER_STATUSES, PAYMENT_METHODS } from "./constants";
import { documentFileName } from "./domain";
import { buildDocumentPdf, logoForPdf } from "./documents";
import { buildDocumentXml, xrechnungProblems } from "./xrechnung";
import {
  acceptOfferOperation,
  addPaymentOperation,
  createConfirmationOperation,
  deleteDraftOperation,
  finalizeDocumentOperation,
  invoiceFromOrderOperation,
  issueDocumentOperation,
  orderFromOfferOperation,
  rejectOfferOperation,
  removePaymentOperation,
  saveDraftOperation,
  sendDocumentOperation,
} from "./operations";
import { BILLING_STATUS_FILTERS, billingListWhere, loadDocView } from "./queries";

/**
 * API-Ressourcen der Rechnungserstellung (`/api/v1/billing-documents`, `/billing-payments`). Alle schreibenden Wege laufen über **dieselben Operationen** wie die Oberfläche (Nummer aus dem Zähler beim
 * Festschreiben, Schnappschuss, Prüfliste, Steuerprüfung, Grenzen, Audit).
 *
 *  - `GET /billing-documents`: Belege **aller** Arten, auch Entwürfe und Angebote (die Ausgangsliste der Rechnungen selbst: `/invoices`); Positionen stehen im Beleg. Belege von Kunden mit eingeschränkter
 *    Verarbeitung (Art. 18 DSGVO) gibt es für die API nicht (404).
 *  - `POST`/`PATCH`/`DELETE`: nur **Entwürfe** (festgeschriebene Belege sind unveränderlich: 409). Beim Anlegen wird ein Kunde (`customerId`) nur verknüpft, wenn er für die API sichtbar ist.
 *  - Aktionen: `finalize` (Rechnungen, `invoices.finalize`), `issue` (Angebote/Auftragsbestätigungen), `accept`/`reject`, `send` (E-Mail; Recht `billing.send`, ausdrücklich im Token), `confirmation`
 *    (Auftragsbestätigung aus Angebot), `order` (Auftrag aus Angebot), `from-order` (Rechnungsentwurf aus Auftrag), `pdf` und `xml` (Downloads). **Storno:** `POST /invoices/{id}/cancel`
 *    (dieselbe Stornologik; die Nummer vergibt der Nummernkreis).
 *  - Zahlungen: `/billing-payments` (anlegen, lesen, entfernen).
 */

const common = { feature: "office.billing" as const, tag: "Billing" };

/** Beleg der Rechnungserstellung, nicht von einem Kunden mit eingeschränkter Verarbeitung (Art. 18). */
const DOC_SCOPE = { source: "billing", OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] };

type Row = Invoice & { items: InvoiceItem[]; cancelledBy: { id: string } | null; deductions: Array<{ partialId: string }> };

const lineBody = z.strictObject({
  description: z.string().min(1).max(300),
  unit: z.string().max(20).optional(),
  kind: z.enum(ITEM_KINDS).optional(),
  /** Menge in Tausendsteln (1,5 = 1500) */
  quantityMilli: z.number().int(),
  /** Netto-Einzelpreis in Cent */
  unitCents: z.number().int(),
  /** Steuersatz in Basispunkten: 1900, 700 oder 0 (bei Kleinunternehmern ignoriert: immer 0) */
  taxBp: z.number().int().min(0).max(10_000),
  discountBp: z.number().int().min(0).max(10_000).optional(),
  refType: z.string().min(1).max(20).nullable().optional(),
  refId: z.string().min(1).max(64).nullable().optional(),
});
const lineItem = z.object({
  position: z.number().int(),
  kind: z.enum(ITEM_KINDS),
  description: z.string(),
  unit: z.string(),
  quantityMilli: z.number().int(),
  unitCents: z.number().int(),
  taxBp: z.number().int(),
  discountBp: z.number().int(),
  refType: nullableString,
  refId: nullableString,
});

const item = z.object({
  id: z.string(),
  version: z.string(),
  docType: z.enum(DOC_TYPES),
  /** leer, solange der Beleg ein Entwurf ist */
  number: z.string(),
  /** draft = Entwurf (frei änderbar), issued = festgeschrieben/ausgestellt (unveränderlich) */
  state: z.enum(["draft", "issued"]),
  /** nur Angebote: open | accepted | rejected */
  offerStatus: z.enum(OFFER_STATUSES).nullable(),
  /** Zahlstatus von Buchungsbelegen: open | paid | cancelled */
  status: z.enum(["open", "paid", "cancelled"]),
  customerId: nullableString,
  partyName: z.string(),
  partyStreet: nullableString,
  partyZip: nullableString,
  partyCity: nullableString,
  buyerEmail: nullableString,
  issueDate: nullableString,
  dueDate: nullableString,
  serviceFrom: nullableString,
  serviceTo: nullableString,
  validUntil: nullableString,
  introText: nullableString,
  footerText: nullableString,
  paymentDays: z.number().int().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  buyerReference: nullableString,
  taxNote: nullableString,
  vehicleId: nullableString,
  mileageKm: z.number().int().nullable(),
  orderId: nullableString,
  sourceDocId: nullableString,
  netCents: z.number().int().nullable(),
  vatCents: z.number().int().nullable(),
  grossCents: z.number().int(),
  /** angerechnete Abschläge (Schlussrechnung) und bisherige Zahlungen; zu zahlen = Brutto − angerechnet − gezahlt */
  deductedCents: z.number().int(),
  paidCents: z.number().int(),
  deductPartialIds: z.array(z.string()),
  exempt: z.boolean(),
  sentAt: nullableString,
  sentCount: z.number().int(),
  finalizedAt: nullableString,
  cancelsInvoiceId: nullableString,
  cancelledByInvoiceId: nullableString,
  items: z.array(lineItem),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const toItem = (row: Row): z.input<typeof item> => ({
  id: row.id,
  version: versionOf(row),
  docType: oneOf(DOC_TYPES, row.docType, "invoice"),
  number: row.number,
  state: row.finalizedAt ? "issued" : "draft",
  offerStatus: row.offerStatus ? oneOf(OFFER_STATUSES, row.offerStatus, "open") : null,
  status: oneOf(["open", "paid", "cancelled"] as const, row.status, "open"),
  customerId: row.customerId,
  partyName: row.partyName,
  partyStreet: row.partyStreet,
  partyZip: row.partyZip,
  partyCity: row.partyCity,
  buyerEmail: row.buyerEmail,
  issueDate: row.finalizedAt ? day(row.issueDate) : null,
  dueDate: dayOrNull(row.dueDate),
  serviceFrom: dayOrNull(row.serviceFrom),
  serviceTo: dayOrNull(row.serviceTo),
  validUntil: dayOrNull(row.validUntil),
  introText: row.introText,
  footerText: row.footerText,
  paymentDays: row.paymentDays,
  paymentMethod: row.paymentMethod ? oneOf(PAYMENT_METHODS, row.paymentMethod, "transfer") : null,
  buyerReference: row.buyerReference,
  taxNote: row.taxNote,
  vehicleId: row.vehicleId,
  mileageKm: row.mileageKm,
  orderId: row.orderId,
  sourceDocId: row.sourceDocId,
  netCents: row.netCents,
  vatCents: row.vatCents,
  grossCents: row.grossCents,
  deductedCents: row.deductedCents,
  paidCents: row.paidCents,
  deductPartialIds: row.deductions.map((d) => d.partialId),
  exempt: row.exempt,
  sentAt: isoOrNull(row.sentAt),
  sentCount: row.sentCount,
  finalizedAt: isoOrNull(row.finalizedAt),
  cancelsInvoiceId: row.cancelsInvoiceId,
  cancelledByInvoiceId: row.cancelledBy?.id ?? null,
  items: row.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ position: i.position, kind: oneOf(ITEM_KINDS, i.kind, "labor"), description: i.description, unit: i.unit, quantityMilli: i.quantityMilli, unitCents: i.unitCents, taxBp: i.taxBp, discountBp: i.discountBp, refType: i.refType, refId: i.refId })),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

const createBody = z.strictObject({
  docType: z.enum(CREATABLE_TYPES),
  customerId: optionalRef,
  partyName: text(120),
  partyStreet: text(120),
  partyZip: text(20),
  partyCity: text(80),
  buyerEmail: text(254),
  introText: text(2000),
  footerText: text(2000),
  serviceFrom: optionalDate,
  serviceTo: optionalDate,
  validUntil: optionalDate,
  paymentDays: z.number().int().min(0).max(365).nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  buyerReference: text(120),
  taxNote: text(300),
  vehicleId: optionalRef,
  mileageKm: z.number().int().min(0).max(9_999_999).nullable().optional(),
  /** nur Schlussrechnung: die anzurechnenden Abschlagsrechnungen */
  deductPartialIds: z.array(z.string().max(64)).max(50).optional(),
  items: z.array(lineBody).max(200),
});

type CreateBody = z.output<typeof createBody>;

const itemsInput = (lines: CreateBody["items"]): string =>
  JSON.stringify(
    lines.map((line) => ({
      description: line.description,
      unit: line.unit,
      kind: line.kind,
      quantityMilli: line.quantityMilli,
      unitCents: line.unitCents,
      taxBp: line.taxBp,
      discountBp: line.discountBp,
      ...(line.refType != null ? { refType: line.refType } : {}),
      ...(line.refId != null ? { refId: line.refId } : {}),
    })),
  );

/** Körper → Eingabe der Operation (`compact` hat leere Felder schon entfernt). */
const toInput = (b: Record<string, unknown>): Record<string, unknown> => ({ ...b, items: itemsInput((b.items ?? []) as CreateBody["items"]) });

/** Kunde (und Fahrzeug) für die API sichtbar? Sonst gibt es den Elternteil für sie nicht (404, nichts wird angelegt). */
async function parentsVisible(b: { customerId?: string | null; vehicleId?: string | null }): Promise<boolean> {
  if (b.customerId && (await db.customer.count({ where: { id: b.customerId, processingRestrictedAt: null } })) === 0) return false;
  if (b.vehicleId && (await db.vehicle.count({ where: { id: b.vehicleId, OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] } })) === 0) return false;
  return true;
}

const STATE_FILTERS = BILLING_STATUS_FILTERS.filter((s) => s !== "all") as [Exclude<(typeof BILLING_STATUS_FILTERS)[number], "all">, ...Array<Exclude<(typeof BILLING_STATUS_FILTERS)[number], "all">>];

const documentEndpoints = defineResource({
  ...common,
  name: "billing-documents",
  singular: "billing document",
  path: "/billing-documents",
  read: "billing.view",
  model: db.invoice as unknown as Delegate<Row>,
  include: { items: true, cancelledBy: { select: { id: true } }, deductions: { select: { partialId: true } } },
  scope: DOC_SCOPE,
  item,
  version: versionOf,
  toItem,
  list: {
    filters: z.strictObject({
      docType: z.enum(DOC_TYPES).optional(),
      state: z.enum(STATE_FILTERS).optional(),
      customerId: z.string().max(64).optional(),
      orderId: z.string().max(64).optional(),
      q: z.string().max(100).optional(),
    }),
    where: ({ docType, state, customerId, orderId, q }) => billingListWhere({ q: q ?? "", type: docType ?? "all", status: state ?? "all", customerId, orderId }),
    sorts: {
      createdAt: (dir) => ({ createdAt: dir }),
      issueDate: (dir) => ({ issueDate: dir }),
      number: (dir) => ({ number: dir }),
      grossCents: (dir) => ({ grossCents: dir }),
    },
    defaultSort: [{ key: "createdAt", dir: "desc" }],
  },
  create: { permission: "billing.edit", operation: saveDraftOperation, body: createBody, toInput: (b) => toInput(b as Record<string, unknown>), parentVisible: (b) => parentsVisible(b) },
  update: {
    permission: "billing.edit",
    operation: saveDraftOperation,
    body: createBody.omit({ docType: true }).partial(),
    current: (row) => ({
      customerId: row.customerId,
      partyName: row.partyName,
      partyStreet: row.partyStreet,
      partyZip: row.partyZip,
      partyCity: row.partyCity,
      buyerEmail: row.buyerEmail,
      introText: row.introText,
      footerText: row.footerText,
      serviceFrom: dayOrNull(row.serviceFrom),
      serviceTo: dayOrNull(row.serviceTo),
      validUntil: dayOrNull(row.validUntil),
      paymentDays: row.paymentDays,
      paymentMethod: row.paymentMethod,
      buyerReference: row.buyerReference,
      taxNote: row.taxNote,
      vehicleId: row.vehicleId,
      mileageKm: row.mileageKm,
      deductPartialIds: row.deductions.map((d) => d.partialId),
      items: row.items
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ description: i.description, unit: i.unit, kind: i.kind, quantityMilli: i.quantityMilli, unitCents: i.unitCents, taxBp: i.taxBp, discountBp: i.discountBp, refType: i.refType, refId: i.refId })),
    }),
    toInput: (merged, { id, version }) => ({ ...toInput(merged), id, version }),
  },
  remove: { permission: "billing.edit", operation: deleteDraftOperation },
  actions: [
    {
      name: "finalize",
      summary: "Finalize an invoice, partial or final invoice: assigns the next invoice number, freezes sender and recipient (snapshot) and makes the document immutable (irreversible; correct it with POST /invoices/{id}/cancel). Needs invoices.finalize; send the current ETag in If-Match",
      permission: "invoices.finalize",
      operation: finalizeDocumentOperation,
      ifMatch: true,
      toInput: (id, _b, { version }) => ({ id, version }),
    },
    {
      name: "issue",
      summary: "Issue a quote or order confirmation: assigns the number and makes the document immutable (send the current ETag in If-Match)",
      permission: "billing.edit",
      operation: issueDocumentOperation,
      ifMatch: true,
      toInput: (id, _b, { version }) => ({ id, version }),
    },
    {
      name: "accept",
      summary: "Mark an issued quote as accepted by the customer (acceptedOn defaults to today; send the current ETag in If-Match)",
      permission: "billing.accept",
      operation: acceptOfferOperation,
      body: z.strictObject({ acceptedOn: optionalDate }),
      ifMatch: true,
      toInput: (id, b, { version }) => ({ id, version, acceptedOn: b.acceptedOn }),
    },
    {
      name: "reject",
      summary: "Mark an issued quote as rejected (send the current ETag in If-Match)",
      permission: "billing.accept",
      operation: rejectOfferOperation,
      ifMatch: true,
      toInput: (id, _b, { version }) => ({ id, version }),
    },
    {
      name: "send",
      summary: "Send the document by e-mail to the customer's address (PDF, optionally the XRechnung XML). Needs billing.send (never in a default role) and an e-mail setup; sending again needs resend=true",
      permission: "billing.send",
      operation: sendDocumentOperation,
      body: z.strictObject({ includeXml: z.boolean().optional(), resend: z.boolean().optional() }),
      toInput: (id, b) => ({ id, includeXml: b.includeXml === true, resend: b.resend === true }),
    },
  ],
});

/* ───────────── Aktionen, die einen anderen Beleg bzw. Auftrag erzeugen ───────────── */

const idOf = (call: { params: Record<string, string> }): string => {
  if (!ID_SHAPE.test(call.params.id ?? "")) throw apiProblem("not_found");
  return call.params.id;
};
/** Der Beleg, soweit die API ihn zeigen darf (404 sonst). */
async function visible(id: string) {
  const found = await db.invoice.findFirst({ where: { AND: [DOC_SCOPE, { id }] }, select: { id: true, updatedAt: true } });
  if (!found) throw apiProblem("not_found");
  return found;
}

const action = (partial: Pick<ApiEndpoint, "path" | "permission" | "operationId" | "summary" | "operations" | "handler"> & Partial<ApiEndpoint>): ApiEndpoint => ({ ...common, method: "POST", ...partial });

const documentActions: ApiEndpoint[] = [
  ...documentEndpoints,
  action({
    path: "/billing-documents/{id}/confirmation",
    permission: "billing.edit",
    operationId: "billing-documents.confirmation",
    summary: "Create the draft of an order confirmation from an accepted quote (at most one per quote); returns the new document",
    operations: [createConfirmationOperation.name],
    response: item,
    status: 201,
    handler: async (call) => {
      const id = idOf(call);
      await visible(id);
      const created = await runApiOperation(createConfirmationOperation, call.principal, { id });
      call.committed({ status: 201, body: { data: { id: created.id } }, headers: { location: `/api/v1/billing-documents/${created.id}` } });
      const row = await db.invoice.findFirst({ where: { id: created.id }, include: { items: true, cancelledBy: { select: { id: true } }, deductions: { select: { partialId: true } } } });
      if (!row) throw apiProblem("internal_error");
      return { status: 201, body: { data: toItem(row as Row) }, headers: { location: `/api/v1/billing-documents/${created.id}` } };
    },
  }),
  action({
    path: "/billing-documents/{id}/order",
    permission: "billing.accept",
    operationId: "billing-documents.order",
    summary: "Create a workshop order from an accepted quote, atomically (order number, items, link). Needs orders.create, orders.edit and orders.prices as well; the quote needs a vehicle. Send the current ETag in If-Match",
    operations: [orderFromOfferOperation.name],
    ifMatch: true,
    handler: async (call) => {
      const id = idOf(call);
      const row = await visible(id);
      const match = parseIfMatch(call.ifMatch);
      if (match.kind === "none") throw apiProblem("precondition_required");
      if (match.kind === "invalid" || match.version !== versionOf(row)) throw apiProblem("precondition_failed");
      const created = await runApiOperation(orderFromOfferOperation, call.principal, { id, version: match.version });
      call.committed({ status: 201, body: { data: { orderId: created.orderId, orderNumber: created.orderNumber } }, headers: { location: `/api/v1/orders/${created.orderId}` } });
      return { status: 201, body: { data: { orderId: created.orderId, orderNumber: created.orderNumber } }, headers: { location: `/api/v1/orders/${created.orderId}` } };
    },
  }),
  action({
    path: "/billing-documents/from-order",
    permission: "billing.edit",
    operationId: "billing-documents.fromOrder",
    summary: "Create an invoice draft from an order (customer, vehicle and all items with prices). Needs orders.view and orders.prices. An open order and an order that was billed already need confirmOpen / acknowledgeDuplicate",
    operations: [invoiceFromOrderOperation.name],
    body: z.strictObject({ orderId: requiredRef, confirmOpen: z.boolean().optional(), acknowledgeDuplicate: z.boolean().optional() }),
    response: item,
    status: 201,
    handler: async (call) => {
      const body = call.body as { orderId: string; confirmOpen?: boolean; acknowledgeDuplicate?: boolean };
      // Aufträge von Kunden mit eingeschränkter Verarbeitung gibt es für die API nicht
      const order = await db.order.count({ where: { id: body.orderId, OR: [{ customerId: null }, { customer: { is: { processingRestrictedAt: null } } }] } });
      if (order === 0) throw apiProblem("not_found");
      const created = await runApiOperation(invoiceFromOrderOperation, call.principal, { orderId: body.orderId, confirmOpen: body.confirmOpen === true, acknowledgeDuplicate: body.acknowledgeDuplicate === true });
      call.committed({ status: 201, body: { data: { id: created.id } }, headers: { location: `/api/v1/billing-documents/${created.id}` } });
      const row = await db.invoice.findFirst({ where: { id: created.id }, include: { items: true, cancelledBy: { select: { id: true } }, deductions: { select: { partialId: true } } } });
      if (!row) throw apiProblem("internal_error");
      return { status: 201, body: { data: toItem(row as Row) }, headers: { location: `/api/v1/billing-documents/${created.id}` } };
    },
  }),
  {
    ...common,
    method: "GET",
    path: "/billing-documents/{id}/pdf",
    permission: "billing.view",
    operationId: "billing-documents.pdf",
    summary: "Download the document as PDF (drafts carry a draft notice; finalized documents are created from the frozen snapshot; add ?download=1 to force a download)",
    operations: [],
    download: { description: "The PDF (application/pdf). Not PDF/A; the XRechnung is a separate download." },
    handler: async (call) => {
      const id = idOf(call);
      await visible(id);
      const loaded = await loadDocView(id);
      if (!loaded) throw apiProblem("not_found");
      let bytes: Buffer;
      try {
        bytes = await buildDocumentPdf(loaded.view, { logo: logoForPdf((await getWorkshop()).logoDataUrl) });
      } catch (error) {
        if (error instanceof PdfError) throw apiProblem("validation_failed", { reason: "billing.errors.pdf" });
        throw error;
      }
      const headers = deliveryHeaders({ mime: "application/pdf", name: documentFileName(loaded.view.docType, loaded.view.number, "pdf"), size: bytes.byteLength, download: call.searchParams.get("download") === "1", cacheControl: "private, no-store" });
      return { status: 200, file: { stream: Readable.toWeb(Readable.from(bytes)) as ReadableStream<Uint8Array>, headers } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/billing-documents/{id}/xml",
    permission: "billing.view",
    operationId: "billing-documents.xml",
    summary: "Download the XRechnung (UBL XML) of a finalized invoice, partial invoice, final invoice or cancellation invoice; 422 lists missing details (for example the buyer reference)",
    operations: [],
    download: { description: "The XRechnung 3.0 (UBL 2.1) as application/xml." },
    handler: async (call) => {
      const id = idOf(call);
      await visible(id);
      const loaded = await loadDocView(id);
      if (!loaded) throw apiProblem("not_found");
      const problems = xrechnungProblems(loaded.view);
      if (problems.length > 0) throw apiProblem("validation_failed", { reason: "billing.errors.xrechnungIncomplete", params: { problems: problems.join(",") } });
      let xml: string;
      try {
        xml = buildDocumentXml(loaded.view);
      } catch (error) {
        if (error instanceof EinvoiceError) throw apiProblem("validation_failed", { reason: "billing.errors.xrechnungIncomplete" });
        throw error;
      }
      const bytes = new TextEncoder().encode(xml);
      const headers = deliveryHeaders({ mime: "application/xml", name: documentFileName(loaded.view.docType, loaded.view.number, "xml"), size: bytes.byteLength, download: true, cacheControl: "private, no-store" });
      return { status: 200, file: { stream: Readable.toWeb(Readable.from(Buffer.from(bytes))) as ReadableStream<Uint8Array>, headers } };
    },
  },
];

/* ───────────── Zahlungen ───────────── */

const paymentShape = z.object({
  id: z.string(),
  documentId: z.string(),
  paidAt: z.string(),
  amountCents: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  note: nullableString,
  recordedByName: z.string(),
  createdAt: z.string(),
});

const paymentEndpoints = defineResource({
  ...common,
  name: "billing-payments",
  singular: "payment",
  path: "/billing-payments",
  read: "billing.view",
  model: db.invoicePayment as unknown as Delegate<InvoicePayment>,
  scope: { invoice: DOC_SCOPE },
  item: paymentShape,
  toItem: (p): z.input<typeof paymentShape> => ({ id: p.id, documentId: p.invoiceId, paidAt: day(p.paidAt), amountCents: p.amountCents, method: oneOf(PAYMENT_METHODS, p.method, "other"), note: p.note, recordedByName: p.recordedByName, createdAt: iso(p.createdAt) }),
  list: {
    filters: z.strictObject({ documentId: z.string().max(64).optional() }),
    where: ({ documentId }) => (documentId ? { invoiceId: documentId } : {}),
    sorts: { paidAt: (dir) => ({ paidAt: dir }), createdAt: (dir) => ({ createdAt: dir }) },
    defaultSort: [{ key: "createdAt", dir: "asc" }],
  },
  create: {
    permission: "invoices.edit",
    operation: addPaymentOperation,
    body: z.strictObject({ documentId: requiredRef, amountCents: z.number().int().min(1), paidAt: optionalDate, method: z.enum(PAYMENT_METHODS).optional(), note: text(200) }),
    toInput: (b) => {
      const body = b as { documentId: string; amountCents: number; paidAt?: string; method?: string; note?: string };
      return { id: body.documentId, amount: centsText(body.amountCents), ...(body.paidAt ? { paidAt: body.paidAt } : {}), ...(body.method ? { method: body.method } : {}), ...(body.note ? { note: body.note } : {}) };
    },
    rename: { id: "documentId", amount: "amountCents" },
    // Belege von Kunden mit eingeschränkter Verarbeitung (Art. 18) gibt es für die API nicht – auch keine Zahlung dazu
    parentVisible: async (b) => (await db.invoice.count({ where: { AND: [DOC_SCOPE, { id: b.documentId }] } })) > 0,
  },
  remove: { permission: "invoices.edit", operation: removePaymentOperation },
});

export const endpoints: ApiEndpoint[] = [...documentActions, ...paymentEndpoints];
