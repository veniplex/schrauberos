import { noon, todayInput } from "@/lib/dates";
import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { logError } from "@/lib/log-safe";
import { truncateName } from "@/lib/file-delivery";
import { checkUpload } from "@/lib/upload-sniff";
import { searchKey } from "@/lib/search-key";
import { dateText, moneyCents } from "@/lib/zod-fields";
import { INVOICE_DIRECTIONS, INVOICE_FILE_MAX_BYTES, INVOICE_FILE_TYPES, INVOICE_STATUSES, amountsConsistent, cancelBlock, counterAmounts, finalizeBlock, invoiceFileLocation, isCounterDocument, isFinalized, outgoingKeyOf } from "@/modules/office/invoices/domain";
import { dayKey } from "@/lib/zone";
import { defineOperation, fail, failField, mapPrismaError, type Tx } from "@/server/operations";
import { storeFile } from "@/server/files";
import { allocateDocumentNumber } from "@/server/invoice-numbering";
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

    const current = d.id ? await tx.invoice.findUnique({ where: { id: d.id }, select: { finalizedAt: true, customerId: true, source: true } }) : null;
    // Ein Kunde mit eingeschränkter Verarbeitung (Art. 18 DSGVO) lässt sich nicht neu verknüpfen; eine bestehende Verknüpfung bleibt
    if (d.customerId && !(await tx.customer.findFirst({ where: { id: d.customerId, OR: [{ processingRestrictedAt: null }, { id: current?.customerId ?? "" }] }, select: { id: true } }))) failField("customerId", "validation.invalid");

    const data = invoiceRecord(d, d.customerId ?? null);

    if (d.id) {
      // Festgeschriebene Rechnungen (und Gegenbelege) sind unveränderlich; korrigiert wird per Gegenbeleg
      if (!current) fail("notFound");
      // Belege der Rechnungserstellung (Positionen, Schnappschuss, Nummer) werden dort bearbeitet
      if (current.source === "billing") fail("inUse", "invoices.errors.billingDoc");
      if (isFinalized(current)) fail("inUse", "invoices.errors.finalized");
    }
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

/**
 * Der Zahlstatus bleibt auch bei festgeschriebenen Rechnungen änderbar (mit Audit) – nicht aber bei einem stornierten Paar: Original und Gegenbeleg gelten als erledigt und werden nicht mehr als
 * offen oder bezahlt geführt.
 */
async function assertPaymentEditable(tx: Tx, id: string): Promise<void> {
  const invoice = await tx.invoice.findUnique({ where: { id }, select: { cancelsInvoiceId: true, source: true, cancelledBy: { select: { id: true } } } });
  if (!invoice) fail("notFound");
  if (isCounterDocument(invoice) || invoice.cancelledBy) fail("inUse", "invoices.errors.cancelledLocked");
  // Zahlungen zu Belegen der Rechnungserstellung sind Zahlungseingänge (Teilzahlungen): dort erfasst
  if (invoice.source === "billing") fail("inUse", "invoices.errors.billingPayments");
}

/** Schnellaktion: als bezahlt markieren (Datum optional, Standard heute). */
export const markInvoicePaidOperation = defineOperation({
  name: "invoices.markPaid",
  permission: "invoices.edit",
  input: idInput.extend({ paidAt: dateText().optional() }),
  audit: "invoice.pay",
  run: async ({ input, tx, audit }) => {
    await assertPaymentEditable(tx, input.id);
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
    await assertPaymentEditable(tx, input.id);
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
    const invoice = await tx.invoice.findUnique({ where: { id: input.id }, select: { direction: true, number: true, finalizedAt: true, source: true, file: { select: { path: true } } } });
    if (!invoice) fail("notFound");
    // Entwürfe der Rechnungserstellung löscht diese selbst
    if (invoice.source === "billing") fail("inUse", "invoices.errors.billingDoc");
    // Festgeschriebene Rechnungen (auch Gegenbelege) werden nie gelöscht; ihre Nummer wird nie wiederverwendet
    if (isFinalized(invoice)) fail("inUse", "invoices.errors.finalizedDelete");
    await tx.invoice.delete({ where: { id: input.id } });
    audit({ target: invoice.number, entityId: input.id });
    const filePath = invoice.file?.path;
    if (filePath) afterCommit(() => removeInvoiceFile(filePath).catch((error) => logError("invoices:deleteFile", error)));
    return { id: input.id, direction: invoice.direction };
  },
});


const finalizeErrors = { incoming: "invoices.errors.finalizeIncoming", already: "invoices.errors.finalizeAlready", cancelled: "invoices.errors.finalizeCancelled", billing: "invoices.errors.finalizeBilling" } as const;

/**
 * Festschreiben (`invoices.finalize`, nicht in den Standardrollen): ab dann sind Inhalt, Beträge und Beleg der Ausgangsrechnung unveränderlich und sie ist nicht löschbar. Nicht umkehrbar –
 * korrigiert wird per Gegenbeleg (`invoices.cancel`). `version` ist Pflicht: Wer festschreibt, hat den Stand gesehen, den er festschreibt.
 */
export const finalizeInvoiceOperation = defineOperation({
  name: "invoices.finalize",
  permission: "invoices.finalize",
  input: idInput.extend({ version: z.string().optional() }),
  audit: "invoice.finalize",
  run: async ({ input, principal, tx, audit }) => {
    const invoice = await tx.invoice.findUnique({ where: { id: input.id }, select: { number: true, direction: true, status: true, finalizedAt: true, cancelsInvoiceId: true, source: true } });
    if (!invoice) fail("notFound");
    const block = finalizeBlock(invoice);
    if (block) fail("inUse", finalizeErrors[block]);
    if (!(await claimRow(tx.invoice, input.id, input.version))) fail("conflict");
    await tx.invoice.update({ where: { id: input.id }, data: { finalizedAt: new Date(), finalizedByName: principal.user.name.slice(0, 120) } });
    audit({ target: invoice.number, entityId: input.id });
    return { id: input.id };
  },
});

const cancelErrors = {
  incoming: "invoices.errors.cancelIncoming",
  notFinalized: "invoices.errors.cancelNotFinalized",
  counterDocument: "invoices.errors.cancelCounterDocument",
  already: "invoices.errors.cancelAlready",
  deducted: "invoices.errors.cancelDeducted",
} as const;

/**
 * Storno per Gegenbeleg (Stornorechnung/Gutschrift, `invoices.edit`): legt eine **eigene, festgeschriebene Rechnung** mit Bezug auf das Original an – Empfänger und Kunde wie das Original, alle
 * Beträge mit umgekehrtem Vorzeichen. Das Original wird als storniert geführt, beide zählen nicht mehr in den offenen Summen. Das Original bleibt inhaltlich unverändert, seine Nummer wird nie
 * wiederverwendet. Nur für festgeschriebene Ausgangsrechnungen; alle anderen lassen sich korrigieren oder löschen.
 *
 * **Von Hand erfasste Rechnungen** (Archiv): die Nummer der Stornorechnung gibt die Person ein, wie bei jeder Ausgangsrechnung im Archiv. **Belege der Rechnungserstellung** (F3, `source = "billing"`):
 * die Nummer vergibt der Nummernkreis fortlaufend in derselben Transaktion (eine eingegebene Nummer wird ignoriert), die Gegenbelegung übernimmt Positionen (mit umgekehrter Menge), Schnappschuss
 * von Absender und Empfänger und alle Angaben des Originals; angerechnete Abschläge einer stornierten Schlussrechnung werden wieder frei. Ein Abschlag, den eine festgeschriebene
 * Schlussrechnung anrechnet, lässt sich erst nach deren Storno stornieren. Eine einzige Stornologik für beide Arten – es gibt keine zweite.
 */
export const cancelInvoiceOperation = defineOperation({
  name: "invoices.cancel",
  permission: "invoices.edit",
  input: idInput.extend({
    version: z.string().optional(),
    number: z.string().trim().max(60).optional(),
    issueDate: dateText().optional(),
    reason: z.string().trim().max(500).optional(),
  }),
  audit: "invoice.cancel",
  run: async ({ input, principal, tx, audit, emit }) => {
    const original = await tx.invoice.findUnique({ where: { id: input.id }, include: { items: { orderBy: { position: "asc" } }, snapshot: true, cancelledBy: { select: { id: true } } } });
    if (!original) fail("notFound");
    const deductedInFinal = (await tx.invoiceDeduction.count({ where: { partialId: original.id, finalKey: { not: null } } })) > 0;
    const block = cancelBlock({ ...original, hasCounterDocument: original.cancelledBy !== null, deductedInFinal });
    if (block) fail("inUse", cancelErrors[block]);

    const billing = original.source === "billing";
    const issueDate = input.issueDate ?? todayInput();
    if (issueDate < dayKey(original.issueDate)) failField("issueDate", "invoices.errors.cancelBeforeIssue");
    if (!(await claimRow(tx.invoice, original.id, input.version))) fail("conflict");

    let number: string;
    let key: string | null;
    if (billing) {
      const workshop = await tx.workshop.findUnique({ where: { id: "default" }, select: { invoiceNumberFormat: true } });
      ({ number, key } = await allocateDocumentNumber(tx, "credit", workshop?.invoiceNumberFormat, new Date()));
    } else {
      if (!input.number) failField("number", "invoices.errors.numberRequired");
      number = input.number;
      key = outgoingKeyOf("outgoing", number);
      if (key && (await tx.invoice.findFirst({ where: { outgoingKey: key }, select: { id: true } }))) failField("number", "invoices.errors.numberTaken");
    }

    const who = principal.user.name.slice(0, 120);
    const fromBilling = billing
      ? {
          source: "billing",
          partyStreet: original.partyStreet,
          partyZip: original.partyZip,
          partyCity: original.partyCity,
          serviceFrom: original.serviceFrom,
          serviceTo: original.serviceTo,
          paymentMethod: original.paymentMethod,
          buyerReference: original.buyerReference,
          buyerEmail: original.buyerEmail,
          taxNote: original.taxNote,
          exempt: original.exempt,
          vehicleId: original.vehicleId,
          vehicleLabel: original.vehicleLabel,
          mileageKm: original.mileageKm,
          orderId: original.orderId,
          deductedCents: 0 - original.deductedCents,
          createdByName: who,
        }
      : {};
    let counter;
    try {
      counter = await tx.invoice.create({
        data: {
          direction: "outgoing",
          number,
          outgoingKey: key,
          partyName: original.partyName,
          partyKey: original.partyKey,
          customerId: original.customerId,
          issueDate: noon(issueDate),
          dueDate: null,
          ...counterAmounts(original),
          status: "cancelled",
          paidAt: null,
          category: original.category,
          reference: original.reference,
          notes: input.reason || null,
          finalizedAt: new Date(),
          finalizedByName: who,
          cancelsInvoiceId: original.id,
          docType: "credit",
          ...fromBilling,
        },
        select: { id: true },
      });
    } catch (error) {
      // Wettlauf um dieselbe Ausgangsnummer oder um denselben Gegenbeleg: der Unique-Schlüssel entscheidet
      if (mapPrismaError(error)?.code === "duplicate") failField("number", "invoices.errors.numberTaken");
      throw error;
    }
    if (billing) {
      // Positionen mit umgekehrter Menge (die Summe ergibt das negative Brutto), derselbe Schnappschuss wie das Original
      if (original.items.length > 0) {
        await tx.invoiceItem.createMany({
          data: original.items.map((item) => ({
            invoiceId: counter.id,
            position: item.position,
            kind: item.kind,
            description: item.description,
            unit: item.unit,
            quantityMilli: 0 - item.quantityMilli,
            unitCents: item.unitCents,
            taxBp: item.taxBp,
            discountBp: item.discountBp,
            refType: item.refType,
            refId: item.refId,
          })),
        });
      }
      if (original.snapshot) {
        // alle Spalten außer Kennung und Zeitpunkt
        const { sName, sStreet, sZip, sCity, sPhone, sEmail, sWebsite, sTaxNumber, sVatId, sBankName, sIban, sBic, sDirector, sRegisterCourt, sRegisterNumber, sSmallBusiness, rName, rStreet, rZip, rCity, rEmail, rCustomerNumber } = original.snapshot;
        await tx.invoiceSnapshot.create({
          data: { invoiceId: counter.id, sName, sStreet, sZip, sCity, sPhone, sEmail, sWebsite, sTaxNumber, sVatId, sBankName, sIban, sBic, sDirector, sRegisterCourt, sRegisterNumber, sSmallBusiness, rName, rStreet, rZip, rCity, rEmail, rCustomerNumber },
        });
      }
      // Eine stornierte Schlussrechnung rechnet ihre Abschläge nicht mehr an: sie werden wieder frei
      await tx.invoiceDeduction.updateMany({ where: { finalId: original.id }, data: { finalKey: null } });
      await emit("billing.cancelled", { type: "credit" }, original.id);
    }
    await tx.invoice.update({ where: { id: original.id }, data: { status: "cancelled" } });
    audit({ target: `${number} → ${original.number}`, entityId: original.id });
    return { id: original.id, counterId: counter.id };
  },
});
