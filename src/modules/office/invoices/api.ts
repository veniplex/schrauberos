import { Readable } from "node:stream";
import { z } from "zod";
import type { Invoice, InvoiceFile } from "@/generated/prisma/client";
import { etagOf, parseIfMatch } from "@/lib/api/query";
import { versionOf } from "@/lib/concurrency";
import { endOfDayIn, startOfDayIn } from "@/lib/dates";
import { deliveryHeaders } from "@/lib/file-delivery";
import { centsText, dateOnly, day, dayOrNull, iso, nullableString, oneOf } from "@/server/api/format";
import { compact, defineResource, ID_SHAPE, type Delegate } from "@/server/api/resource";
import type { ApiEndpoint } from "@/server/api/types";
import { db } from "@/server/db";
import { fileExists, fileSize, openFile } from "@/server/files";
import { apiProblem, runApiOperation } from "@/server/operations";
import { archiveListedWhere, invoiceTextWhere, ledgerWhere } from "./queries";
import { DOC_TYPES_LEDGER, INVOICE_DIRECTIONS, INVOICE_FILE_MAX_BYTES, INVOICE_FILE_TYPES, INVOICE_STATUSES } from "./domain";
import { cancelInvoiceOperation, deleteInvoiceOperation, finalizeInvoiceOperation, markInvoicePaidOperation, reopenInvoiceOperation, saveInvoiceOperation } from "./operations";

/**
 * API-Ressource „Rechnungsarchiv“ (`/api/v1/invoices`). Beträge sind ganze Cent (`grossCents`); Ausgangsrechnungsnummern bleiben eindeutig, Netto + MwSt
 * müssen zum Brutto passen – alles in derselben Operation wie in der Oberfläche.
 *
 * **Beleg (PDF/Bild/XML):** `POST /invoices/{id}/file` legt ihn ab oder ersetzt ihn (`multipart/form-data`, Feld `file`; Inhalt statt gemeldetem Typ, höchstens 10 MiB, `If-Match`, der `Idempotency-Key`
 * gilt über Felder und Inhalt), `DELETE /invoices/{id}/file` entfernt ihn, `GET /invoices/{id}/file` liefert ihn aus (`deliveryHeaders`: `nosniff`, sicherer Dateiname, XML nur als Download). Alles läuft über
 * dieselbe Operation wie das Formular (`invoices.save` mit `file`/`removeFile`): Eine festgeschriebene Ausgangsrechnung behält ihren Beleg (409), Belege der Rechnungserstellung gibt es hier nicht. Rechte:
 * `invoices.edit` zum Ablegen/Entfernen, `invoices.view` zum Lesen. Das Rechnungsarchiv blendet Kunden mit eingeschränkter Verarbeitung bewusst **nicht** aus (Aufbewahrungspflicht, `api-exceptions.ts`/README).
 */
type Row = Invoice & { file: InvoiceFile | null; cancelledBy: { id: string } | null };

const cents = z.number().int().min(-2_000_000_000).max(2_000_000_000);

const body = z.strictObject({
  direction: z.enum(INVOICE_DIRECTIONS),
  number: z.string().trim().min(1).max(60),
  partyName: z.string().trim().min(1).max(120),
  customerId: z.string().max(64).nullable().optional(),
  issueDate: dateOnly,
  dueDate: dateOnly.nullable().optional(),
  netCents: cents.nullable().optional(),
  vatCents: cents.nullable().optional(),
  grossCents: cents,
  status: z.enum(INVOICE_STATUSES).optional(),
  paidAt: dateOnly.nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const nullableCents = z.number().int().nullable();
const item = z.object({
  id: z.string(),
  version: z.string(),
  direction: z.enum(INVOICE_DIRECTIONS),
  number: z.string(),
  partyName: z.string(),
  customerId: nullableString,
  issueDate: z.string(),
  dueDate: nullableString,
  netCents: nullableCents,
  vatCents: nullableCents,
  grossCents: z.number().int(),
  status: z.enum(INVOICE_STATUSES),
  paidAt: nullableString,
  category: nullableString,
  reference: nullableString,
  notes: nullableString,
  /** Belegart: invoice, partial (Abschlag), final (Schlussrechnung) oder credit (Stornorechnung/Gutschrift) – Angebote und Entwürfe stehen hier nie (siehe /billing-documents) */
  docType: z.enum(DOC_TYPES_LEDGER),
  /** Summe der angerechneten Abschläge (Schlussrechnung) und der bisherigen Zahlungen, in Cent */
  deductedCents: z.number().int(),
  paidCents: z.number().int(),
  /** Ob ein Beleg (PDF/Bild) abgelegt ist */
  hasFile: z.boolean(),
  /** Festgeschrieben: Inhalt, Beträge und Beleg sind unveränderlich, die Rechnung ist nicht löschbar (nur Ausgangsrechnungen); `null` = nicht festgeschrieben */
  finalizedAt: nullableString,
  /** Gegenbeleg (Stornorechnung/Gutschrift): die stornierte Rechnung; `null` = gewöhnliche Rechnung */
  cancelsInvoiceId: nullableString,
  /** Das Original: der Gegenbeleg, der es storniert hat; `null` = nicht storniert */
  cancelledByInvoiceId: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});


/** Aktueller Stand einer Rechnung in der Form des Körpers (PATCH, Beleg ablegen/entfernen). */
const currentOf = (i: Row): Record<string, unknown> => ({
  direction: i.direction,
  number: i.number,
  partyName: i.partyName,
  customerId: i.customerId,
  issueDate: day(i.issueDate),
  dueDate: dayOrNull(i.dueDate),
  netCents: i.netCents,
  vatCents: i.vatCents,
  grossCents: i.grossCents,
  status: i.status,
  paidAt: dayOrNull(i.paidAt),
  category: i.category,
  reference: i.reference,
  notes: i.notes,
});

/** API-Körper → Eingabe der Operation: Beträge als Text, Beleg unverändert lassen. */
function toInput(b: Record<string, unknown>): Record<string, unknown> {
  const money = (value: unknown) => (typeof value === "number" ? centsText(value) : undefined);
  const { netCents, vatCents, grossCents, ...rest } = b;
  return { ...rest, net: money(netCents), vat: money(vatCents), gross: money(grossCents), removeFile: false };
}
const rename = { net: "netCents", vat: "vatCents", gross: "grossCents" };

const toItemOf = (i: Row): z.input<typeof item> => ({
  id: i.id,
  version: versionOf(i),
  direction: oneOf(INVOICE_DIRECTIONS, i.direction, "incoming"),
  number: i.number,
  partyName: i.partyName,
  customerId: i.customerId,
  issueDate: day(i.issueDate),
  dueDate: dayOrNull(i.dueDate),
  netCents: i.netCents,
  vatCents: i.vatCents,
  grossCents: i.grossCents,
  status: oneOf(INVOICE_STATUSES, i.status, "open"),
  paidAt: dayOrNull(i.paidAt),
  category: i.category,
  reference: i.reference,
  notes: i.notes,
  docType: oneOf(DOC_TYPES_LEDGER, i.docType, "invoice"),
  deductedCents: i.deductedCents,
  paidCents: i.paidCents,
  hasFile: !!i.file,
  finalizedAt: i.finalizedAt ? iso(i.finalizedAt) : null,
  cancelsInvoiceId: i.cancelsInvoiceId,
  cancelledByInvoiceId: i.cancelledBy?.id ?? null,
  createdAt: iso(i.createdAt),
  updatedAt: iso(i.updatedAt),
});

const resourceEndpoints = defineResource({
  feature: "office.invoices",
  tag: "Invoices",
  name: "invoices",
  singular: "invoice",
  path: "/invoices",
  read: "invoices.view",
  model: db.invoice as unknown as Delegate<Row>,
  include: { file: true, cancelledBy: { select: { id: true } } },
  // nur die Ausgangsliste: keine Angebote, Auftragsbestätigungen und Entwürfe der Rechnungserstellung
  scope: { AND: [ledgerWhere, archiveListedWhere] }, // eingeschränkte Kunden (Art. 18) gibt es in der Schnittstelle nicht
  item,
  version: versionOf,
  toItem: toItemOf,
  list: {
    filters: z.strictObject({
      direction: z.enum(INVOICE_DIRECTIONS).optional(),
      status: z.enum(INVOICE_STATUSES).optional(),
      customerId: z.string().max(64).optional(),
      q: z.string().max(100).optional(),
      /** Rechnungsdatum ab / bis (einschließlich) */
      issuedFrom: dateOnly.optional(),
      issuedTo: dateOnly.optional(),
    }),
    where: ({ direction, status, customerId, q, issuedFrom, issuedTo }) => ({
      ...(direction ? { direction } : {}),
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(issuedFrom || issuedTo ? { issueDate: { ...(issuedFrom ? { gte: startOfDayIn(issuedFrom) } : {}), ...(issuedTo ? { lte: endOfDayIn(issuedTo) } : {}) } } : {}),
      ...(q ? { OR: invoiceTextWhere(q) } : {}),
    }),
    sorts: {
      issueDate: (dir) => ({ issueDate: dir }),
      dueDate: (dir) => ({ dueDate: dir }),
      number: (dir) => ({ number: dir }),
      grossCents: (dir) => ({ grossCents: dir }),
      createdAt: (dir) => ({ createdAt: dir }),
    },
    defaultSort: [{ key: "issueDate", dir: "desc" }],
  },
  create: { permission: "invoices.edit", operation: saveInvoiceOperation, body, toInput, rename },
  update: {
    permission: "invoices.edit",
    operation: saveInvoiceOperation,
    current: currentOf,
    toInput: (merged, { id, version }) => ({ ...toInput(merged), id, version }),
    rename,
  },
  remove: { permission: "invoices.delete", operation: deleteInvoiceOperation },
  actions: [
    {
      name: "pay",
      summary: "Mark an invoice as paid (paidAt defaults to today)",
      permission: "invoices.edit",
      operation: markInvoicePaidOperation,
      body: z.strictObject({ paidAt: dateOnly.nullable().optional() }),
      toInput: (id, b) => ({ id, paidAt: b.paidAt }),
    },
    { name: "reopen", summary: "Reopen a paid invoice", permission: "invoices.edit", operation: reopenInvoiceOperation, toInput: (id) => ({ id }) },
    {
      name: "finalize",
      summary: "Finalize an outgoing invoice: content, amounts and receipt become immutable and the invoice can no longer be deleted (irreversible; correct it with a cancellation document)",
      permission: "invoices.finalize",
      operation: finalizeInvoiceOperation,
      ifMatch: true,
      toInput: (id, _b, { version }) => ({ id, version }),
    },
    {
      name: "cancel",
      summary: "Cancel a finalized outgoing invoice with a cancellation document (credit note): creates a new finalized invoice with negated amounts and a reference to the original. Documents created in invoicing get the next number in sequence automatically; manually recorded invoices need the number in the body",
      permission: "invoices.edit",
      operation: cancelInvoiceOperation,
      ifMatch: true,
      body: z.strictObject({ number: z.string().trim().min(1).max(60).optional(), issueDate: dateOnly.nullable().optional(), reason: z.string().max(500).nullable().optional() }),
      toInput: (id, b, { version }) => ({ id, version, number: b.number, issueDate: b.issueDate, reason: b.reason }),
    },
  ],
});

const common = { feature: "office.invoices" as const, tag: "Invoices" };
const withFile = { file: true, cancelledBy: { select: { id: true } } } as const;

/** Die Rechnung des Archivs mit Beleg (nur, was die Ressource zeigt: `ledgerWhere`). */
const findInvoice = (id: string) => (ID_SHAPE.test(id) ? db.invoice.findFirst({ where: { AND: [{ id }, ledgerWhere, archiveListedWhere] }, include: withFile }) : Promise.resolve(null));

/** `If-Match` lesen: ohne Kopf 428, unbrauchbar 400. */
function versionOfRequest(header: string | null): string {
  const match = parseIfMatch(header);
  if (match.kind === "none") throw apiProblem("precondition_required");
  if (match.kind === "invalid") throw apiProblem("bad_request", { fields: { "If-Match": { code: "validation.invalid" } } });
  return match.version;
}

export const fileEndpoints: ApiEndpoint[] = [
  {
    ...common,
    method: "POST",
    path: "/invoices/{id}/file",
    permission: "invoices.edit",
    operationId: "invoices.fileUpload",
    summary: `Attach or replace the receipt of an invoice (multipart/form-data, field file; ${INVOICE_FILE_TYPES.join(", ")}; up to 10 MiB; the type is detected from the content; send the current ETag in If-Match; the Idempotency-Key prevents duplicates). A finalized outgoing invoice keeps its receipt (409)`,
    operations: [saveInvoiceOperation.name],
    body: z.strictObject({}),
    upload: { maxBytes: INVOICE_FILE_MAX_BYTES },
    response: item,
    ifMatch: true,
    etag: true,
    handler: async (call) => {
      if (!call.file) throw apiProblem("validation_failed", { fields: { file: { code: "validation.required" } } });
      const version = versionOfRequest(call.ifMatch);
      const row = await findInvoice(call.params.id);
      if (!row) throw apiProblem("not_found");
      const file = new File([call.file.bytes as Uint8Array<ArrayBuffer>], call.file.name || "beleg", { type: call.file.type });
      await runApiOperation(saveInvoiceOperation, call.principal, { ...toInput(compact(currentOf(row))), id: row.id, version, file, removeFile: false }, { ...rename, file: "file" });
      call.committed({ status: 200, body: { data: { id: row.id } } });
      const fresh = await findInvoice(row.id);
      if (!fresh) throw apiProblem("internal_error");
      return { status: 200, body: { data: toItemOf(fresh) }, headers: { etag: etagOf(versionOf(fresh)) } };
    },
  },
  {
    ...common,
    method: "DELETE",
    path: "/invoices/{id}/file",
    permission: "invoices.edit",
    operationId: "invoices.fileRemove",
    summary: "Remove the receipt of an invoice (send the current ETag in If-Match). A finalized outgoing invoice keeps its receipt (409)",
    operations: [saveInvoiceOperation.name],
    ifMatch: true,
    status: 204,
    handler: async (call) => {
      const version = versionOfRequest(call.ifMatch);
      const row = await findInvoice(call.params.id);
      if (!row) throw apiProblem("not_found");
      if (!row.file) throw apiProblem("not_found");
      await runApiOperation(saveInvoiceOperation, call.principal, { ...toInput(compact(currentOf(row))), id: row.id, version, removeFile: true }, rename);
      return { status: 204 };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/invoices/{id}/file",
    permission: "invoices.view",
    operationId: "invoices.fileDownload",
    summary: "Download the receipt of an invoice (binary; add ?download=1 to force a download)",
    operations: [],
    download: { description: "The receipt's bytes. Content-Type is the detected type (application/pdf, image/png, image/jpeg, image/webp or application/xml; XML is always delivered as a download); the response carries nosniff, a safe file name and a restrictive Content-Security-Policy." },
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const row = await findInvoice(call.params.id);
      if (!row?.file || !fileExists(row.file.path)) throw apiProblem("not_found");
      const headers = deliveryHeaders({ mime: row.file.mime, name: row.file.name, size: fileSize(row.file.path), download: call.searchParams.get("download") === "1", cacheControl: "private, no-store" });
      return { status: 200, file: { stream: Readable.toWeb(openFile(row.file.path)) as ReadableStream<Uint8Array>, headers } };
    },
  },
];

export const endpoints: ApiEndpoint[] = [...resourceEndpoints, ...fileEndpoints];
