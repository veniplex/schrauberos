import { z } from "zod";
import type { Invoice, InvoiceFile } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { centsText, dateOnly, day, dayOrNull, iso } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { INVOICE_DIRECTIONS, INVOICE_STATUSES } from "./domain";
import { deleteInvoiceOperation, markInvoicePaidOperation, reopenInvoiceOperation, saveInvoiceOperation } from "./operations";

/**
 * API-Ressource „Rechnungsarchiv“ (`/api/v1/invoices`). Beträge sind ganze Cent (`grossCents`); Ausgangsrechnungsnummern bleiben eindeutig, Netto + MwSt
 * müssen zum Brutto passen – alles in derselben Operation wie in der Oberfläche. Der Beleg (PDF/Bild) kommt später per Multipart (F11); die API
 * lässt eine vorhandene Datei unberührt.
 */
type Row = Invoice & { file: InvoiceFile | null };

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

const nullableString = z.string().nullable();
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
  /** Ob ein Beleg (PDF/Bild) abgelegt ist */
  hasFile: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);

/** API-Körper → Eingabe der Operation: Beträge als Text, Beleg unverändert lassen. */
function toInput(b: Record<string, unknown>): Record<string, unknown> {
  const money = (value: unknown) => (typeof value === "number" ? centsText(value) : undefined);
  const { netCents, vatCents, grossCents, ...rest } = b;
  return { ...rest, net: money(netCents), vat: money(vatCents), gross: money(grossCents), removeFile: false };
}
const rename = { net: "netCents", vat: "vatCents", gross: "grossCents" };

export const endpoints = defineResource({
  feature: "office.invoices",
  tag: "Invoices",
  name: "invoices",
  singular: "invoice",
  path: "/invoices",
  read: "invoices.view",
  model: db.invoice as unknown as Delegate<Row>,
  include: { file: true },
  item,
  version: versionOf,
  toItem: (i): z.input<typeof item> => ({
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
    hasFile: !!i.file,
    createdAt: iso(i.createdAt),
    updatedAt: iso(i.updatedAt),
  }),
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
      ...(issuedFrom || issuedTo ? { issueDate: { ...(issuedFrom ? { gte: new Date(`${issuedFrom}T00:00:00`) } : {}), ...(issuedTo ? { lte: new Date(`${issuedTo}T23:59:59`) } : {}) } } : {}),
      ...(q ? { OR: [{ number: contains(q) }, { partyName: contains(q) }, { reference: contains(q) }, { category: contains(q) }] } : {}),
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
    current: (i) => ({
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
    }),
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
  ],
});
