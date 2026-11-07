import { noon } from "@/lib/dates";
import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { logError } from "@/lib/log-safe";
import { truncateName } from "@/lib/file-delivery";
import { checkUpload } from "@/lib/upload-sniff";
import { searchKey } from "@/lib/search-key";
import { dateText, moneyCents } from "@/lib/zod-fields";
import { INVOICE_DIRECTIONS, INVOICE_FILE_MAX_BYTES, INVOICE_FILE_TYPES, INVOICE_STATUSES, amountsConsistent, invoiceFileLocation, outgoingKeyOf } from "@/modules/office/invoices/domain";
import { defineOperation, fail, failField, mapPrismaError } from "@/server/operations";
import { storeFile } from "@/server/files";
import { removeInvoiceFile, syncInvoiceFile } from "./files";


/** Die Felder einer Rechnung, wie Formular und CSV-Import sie kennen (ohne Kennung, Version, Beleg und Kunden-Verknüpfung). */
const invoiceShape = {
  direction: z.enum(INVOICE_DIRECTIONS),
  number: z.string().trim().min(1).max(60),
  partyName: z.string().trim().min(1).max(120),
  issueDate: dateText(),
  dueDate: dateText().optional(),
  net: moneyCents("invoices.errors.amount").optional(),
  vat: moneyCents("invoices.errors.amount").optional(),
  gross: moneyCents("invoices.errors.amount"),
  status: z.enum(INVOICE_STATUSES).default("open"),
  paidAt: dateText().optional(),
  category: z.string().max(60).optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
};

type AmountFields = { gross: number; net?: number; vat?: number; dueDate?: string; issueDate: string };
function refineInvoice(d: AmountFields, ctx: z.RefinementCtx) {
  if (d.gross === 0) ctx.addIssue({ code: "custom", message: "invoices.errors.amount", path: ["gross"] });
  else if (!amountsConsistent(d.net ?? null, d.vat ?? null, d.gross)) ctx.addIssue({ code: "custom", message: "invoices.errors.sumMismatch", path: ["gross"] });
  if (d.dueDate && d.dueDate < d.issueDate) ctx.addIssue({ code: "custom", message: "invoices.errors.dueBeforeIssue", path: ["dueDate"] });
}

const saveInput = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    ...invoiceShape,
    customerId: z.string().optional(),
    file: z.custom<File>((value) => value instanceof File).optional(),
    removeFile: z.boolean(),
  })
  .superRefine(refineInvoice);

/** Eingabe einer Rechnung im CSV-Import: dieselben Felder und Prüfungen wie das Formular (Beträge, Summe, Fälligkeit), ohne Beleg. */
export const invoiceImportInput = z.object(invoiceShape).superRefine(refineInvoice);
export type InvoiceImportFields = z.output<typeof invoiceImportInput>;

/** Die Felder der Tabelle zu einer geprüften Eingabe (Anlegen, Ändern und CSV-Import gleich). */
export function invoiceRecord(d: InvoiceImportFields, customerId: string | null) {
  return {
    direction: d.direction,
    number: d.number,
    outgoingKey: outgoingKeyOf(d.direction, d.number),
    partyName: d.partyName,
    partyKey: searchKey(d.partyName),
    customerId: d.direction === "outgoing" ? customerId : null,
    issueDate: noon(d.issueDate),
    dueDate: d.dueDate ? noon(d.dueDate) : null,
    netCents: d.net ?? null,
    vatCents: d.vat ?? null,
    grossCents: d.gross,
    status: d.status,
    paidAt: d.status === "paid" ? noon(d.paidAt ?? d.issueDate) : null,
    category: d.category ?? null,
    reference: d.reference ?? null,
    notes: d.notes ?? null,
  };
}

export const saveInvoiceOperation = defineOperation({
  name: "invoices.save",
  permission: "invoices.edit",
  input: saveInput,
  audit: (input) => (input.id ? "invoice.update" : "invoice.create"),
  // Der Beleg kommt als normale Datei in den Dateispeicher (lesbarer Pfad), in der Datenbank steht nur der Pfad.
  // Das geschieht vor der Transaktion; `finish` räumt die Datei wieder weg, wenn nichts gespeichert wurde.
  prepare: async ({ input: d }) => {
    const file = d.file;
    if (!file || file.size === 0) return { upload: null, stored: null as string | null };
    if (file.size > INVOICE_FILE_MAX_BYTES) failField("file", "invoices.errors.fileSize");
    // Der Inhalt entscheidet, nicht der gemeldete Typ: HTML als „.pdf“ oder „.png“ wird abgelehnt; gespeichert wird der erkannte Typ
    const data = new Uint8Array(await file.arrayBuffer());
    const checked = checkUpload(data, file.type, INVOICE_FILE_TYPES);
    if (!checked.ok) failField("file", "invoices.errors.fileType");
    const upload = { name: truncateName(file.name), mime: checked.mime, size: file.size, data };
    const location = invoiceFileLocation({ direction: d.direction, issueDate: noon(d.issueDate), number: d.number, partyName: d.partyName }, upload.mime);
    return { upload, stored: await storeFile(location.dir, location.name, upload.data) };
  },
  finish: async (prepared, ok) => {
    if (!ok && prepared?.stored) await removeInvoiceFile(prepared.stored).catch((error) => logError("invoices:cleanup", error));
  },
  run: async ({ input: d, prepared, tx, audit, afterCommit }) => {
    // Dopplung: gleiche Nummer beim selben Geschäftspartner
    const dup = await tx.invoice.findFirst({ where: { direction: d.direction, number: d.number, partyName: d.partyName, ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } });
    if (dup) failField("number", "invoices.errors.duplicate");
    // Ausgangsrechnungsnummern sind eindeutig (normalisierte Nummer; zusätzlich Unique-Schlüssel im Schema gegen Wettläufe)
    const outgoingKey = outgoingKeyOf(d.direction, d.number);
    if (outgoingKey && (await tx.invoice.findFirst({ where: { outgoingKey, ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } }))) failField("number", "invoices.errors.numberTaken");

    if (d.customerId && !(await tx.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }))) failField("customerId", "validation.invalid");

    const data = invoiceRecord(d, d.customerId ?? null);

    if (d.id && !(await claimRow(tx.invoice, d.id, d.version))) fail("conflict");
    let saved;
    try {
      saved = d.id ? await tx.invoice.update({ where: { id: d.id }, data }) : await tx.invoice.create({ data });
    } catch (error) {
      // Wettlauf um dieselbe Ausgangsnummer: der Unique-Schlüssel entscheidet
      if (mapPrismaError(error)?.code === "duplicate") failField("number", "invoices.errors.numberTaken");
      throw error;
    }
    const existing = await tx.invoiceFile.findUnique({ where: { invoiceId: saved.id } });
    let replacedPath: string | null = null;
    if (d.removeFile && !prepared.upload && existing) {
      await tx.invoiceFile.delete({ where: { invoiceId: saved.id } });
      replacedPath = existing.path;
    }
    if (prepared.upload && prepared.stored) {
      await tx.invoiceFile.upsert({
        where: { invoiceId: saved.id },
        update: { name: prepared.upload.name, mime: prepared.upload.mime, size: prepared.upload.size, path: prepared.stored, uploadedAt: new Date() },
        create: { invoiceId: saved.id, name: prepared.upload.name, mime: prepared.upload.mime, size: prepared.upload.size, path: prepared.stored },
      });
      replacedPath = existing?.path ?? null;
    }
    audit({ target: d.number, entityId: saved.id });
    afterCommit(async () => {
      if (replacedPath) await removeInvoiceFile(replacedPath).catch((error) => logError("invoices:oldFile", error));
      await syncInvoiceFile(saved.id).catch((error) => logError("invoices:renameFile", error));
    });
    return { id: saved.id };
  },
});

const idInput = z.object({ id: z.string().min(1) });

/** Schnellaktion: als bezahlt markieren (Datum optional, Standard heute). */
export const markInvoicePaidOperation = defineOperation({
  name: "invoices.markPaid",
  permission: "invoices.edit",
  input: idInput.extend({ paidAt: dateText().optional() }),
  audit: "invoice.pay",
  run: async ({ input, tx, audit }) => {
    const invoice = await tx.invoice.update({ where: { id: input.id }, data: { status: "paid", paidAt: input.paidAt ? noon(input.paidAt) : new Date() }, select: { number: true } });
    audit({ target: invoice.number, entityId: input.id });
    return { id: input.id };
  },
});

export const reopenInvoiceOperation = defineOperation({
  name: "invoices.reopen",
  permission: "invoices.edit",
  input: idInput,
  audit: "invoice.reopen",
  run: async ({ input, tx, audit }) => {
    const invoice = await tx.invoice.update({ where: { id: input.id }, data: { status: "open", paidAt: null }, select: { number: true } });
    audit({ target: invoice.number, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteInvoiceOperation = defineOperation({
  name: "invoices.delete",
  permission: "invoices.delete",
  input: idInput,
  audit: "invoice.delete",
  run: async ({ input, tx, audit, afterCommit }) => {
    const invoice = await tx.invoice.findUnique({ where: { id: input.id }, select: { direction: true, number: true, file: { select: { path: true } } } });
    if (!invoice) fail("notFound");
    await tx.invoice.delete({ where: { id: input.id } });
    audit({ target: invoice.number, entityId: input.id });
    const filePath = invoice.file?.path;
    if (filePath) afterCommit(() => removeInvoiceFile(filePath).catch((error) => logError("invoices:deleteFile", error)));
    return { id: input.id, direction: invoice.direction };
  },
});

