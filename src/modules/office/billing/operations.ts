import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { claimRow } from "@/lib/concurrency";
import { addDaysToKey, dayKey } from "@/lib/zone";
import { noon, todayInput } from "@/lib/dates";
import { logError } from "@/lib/log-safe";
import { searchKey } from "@/lib/search-key";
import { dateText, moneyCents } from "@/lib/zod-fields";
import { lineItemsInput } from "@/lib/line-items";
import { appendOrderItems, createOrderInTx, orderForBilling } from "@/modules/workshop/orders/public";
import { NumberExhaustedError, allocateDocumentNumber } from "@/server/invoice-numbering";
import { mailConfigured, queueMail } from "@/server/mail";
import { db } from "@/server/db";
import { removeFile, storeFile } from "@/server/files";
import { PdfError } from "@/server/pdf/errors";
import { defineOperation, fail, failField, mapPrismaError, OperationError, type Tx } from "@/server/operations";
import { EinvoiceError } from "@/lib/einvoice/ubl";
import { getWorkshop } from "@/server/workshop";
import { CREATABLE_TYPES, OFFER_VALIDITY_DAYS, PAYMENT_METHODS, SENT_FILES_DIR, SENT_QUOTE_FILES_KEEP_DAYS, isInvoiceType, isQuoteType } from "./constants";
import { amountColumns, assertCustomerUsable, checkInputOf, findLinkableCustomer, itemInputOf, loadWorkshop, normalizeItems, replaceItems, snapshotColumns, totalsOf } from "./core";
import { dueDayKey, finalizeProblems, isDraft, mailContent, documentFileName, docTitle, remainingCents, statusAfterPayments } from "./domain";
import { loadDocView } from "./queries";
import { viewPayable } from "./view";

/**
 * Operationen der Rechnungserstellung (F3). Alle Belege liegen in der Tabelle der Rechnungen (`Invoice`, `source = "billing"`): Ein **Entwurf** hat keine Nummer und ist frei änderbar und löschbar;
 * **Festschreiben** (Rechnungen, `invoices.finalize`) bzw. **Ausstellen** (Angebote und Auftragsbestätigungen, `billing.edit`) vergibt die fortlaufende Nummer aus dem Zähler **in derselben Transaktion**,
 * hält den Schnappschuss von Absender und Empfänger fest und macht den Beleg unveränderlich. Danach ändern sich nur Zahlungen, Angebotsstatus und Versandvermerk. Korrigiert wird mit der einen Stornologik
 * (`invoices.cancel`, Gegenbeleg). Rechte: Entwürfe `billing.edit`, Festschreiben `invoices.finalize` (das vorhandene Recht, kein Doppelrecht), Annehmen `billing.accept`, Versand `billing.send`
 * (zusätzlich `mail.send` laut `queueMail`), Zahlungen `invoices.edit`.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (max: number) => z.string().trim().max(max).optional();
const idInput = z.object({ id: z.string().min(1) });

const who = (principal: { user: { name: string } }) => principal.user.name.slice(0, 120);
/** Bezeichnung im Audit-Log: Belegart und Nummer – **nie der Name des Empfängers** (das Audit-Log überlebt die Anonymisierung des Kunden). */
const labelOf = (docType: string, number: string) => `${docTitle(docType)} ${number || "(Entwurf)"}`;

/** Der Beleg einer Operation: muss aus der Rechnungserstellung stammen. */
async function billingDoc(tx: Tx, id: string) {
  const doc = await tx.invoice.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } }, deductions: true, snapshot: true } });
  if (!doc || doc.source !== "billing") fail("notFound");
  return doc;
}

/* ───────────── Entwurf anlegen und ändern ───────────── */

const draftInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  /** nur beim Anlegen; die Belegart ändert sich später nie */
  docType: z.enum(CREATABLE_TYPES).optional(),
  customerId: z.string().max(64).optional(),
  partyName: text(120),
  partyStreet: text(120),
  partyZip: text(20),
  partyCity: text(80),
  buyerEmail: z.string().trim().max(254).regex(EMAIL, { error: "validation.email" }).optional(),
  introText: text(2000),
  footerText: text(2000),
  serviceFrom: dateText().optional(),
  serviceTo: dateText().optional(),
  validUntil: dateText().optional(),
  paymentDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  buyerReference: text(120),
  taxNote: text(300),
  vehicleId: z.string().max(64).optional(),
  mileageKm: z.coerce.number().int().min(0).max(9_999_999).optional(),
  /** nur Schlussrechnung: die Abschlagsrechnungen, die angerechnet werden */
  deductPartialIds: z.array(z.string().max(64)).max(50).optional(),
  items: lineItemsInput(),
});
export type DraftInput = z.output<typeof draftInput>;

/**
 * Prüft die Abschläge einer Schlussrechnung: festgeschriebene, nicht stornierte Abschlagsrechnungen **desselben Kunden**, die noch in keiner festgeschriebenen Schlussrechnung angerechnet sind.
 * Liefert ihre Bruttosumme. (Die Eindeutigkeit der Anrechnung sichert zusätzlich der Unique-Schlüssel `finalKey`.)
 */
async function checkPartials(tx: Tx, ids: readonly string[], customerId: string | null, finalId: string | null): Promise<number> {
  if (ids.length === 0) return 0;
  if (!customerId) failField("customerId", "billing.errors.finalCustomer");
  const unique = [...new Set(ids)];
  const rows = await tx.invoice.findMany({
    where: { id: { in: unique }, source: "billing", docType: "partial", customerId, finalizedAt: { not: null }, status: { not: "cancelled" }, cancelledBy: null },
    select: { id: true, grossCents: true, deductedIn: { where: { finalKey: { not: null }, ...(finalId ? { finalId: { not: finalId } } : {}) }, select: { id: true } } },
  });
  if (rows.length !== unique.length || rows.some((row) => row.deductedIn.length > 0)) failField("deductPartialIds", "billing.errors.deduction");
  return rows.reduce((sum, row) => sum + row.grossCents, 0);
}

/** Entwurf anlegen oder ändern (`billing.edit`). Summen, Steuersätze und Grenzen prüft der Server selbst; ein Entwurf ist nie verbindlich. */
export const saveDraftOperation = defineOperation({
  name: "billing.save",
  permission: "billing.edit",
  input: draftInput,
  audit: (input) => (input.id ? "billing.update" : "billing.create"),
  run: async ({ input: d, principal, tx, audit }) => {
    const workshop = await loadWorkshop(tx);
    const exempt = workshop.smallBusiness;
    const current = d.id ? await billingDoc(tx, d.id) : null;
    if (current && !isDraft(current)) fail("inUse", "billing.errors.notDraft");
    const docType = current ? current.docType : d.docType;
    if (!docType) failField("docType", "validation.required");

    // Kunde: optional verknüpfbar (nicht eingeschränkt, nicht anonymisiert); Anschrift und E-Mail werden daraus vorbelegt, wenn die Felder leer sind
    let customer: Awaited<ReturnType<typeof findLinkableCustomer>> = null;
    if (d.customerId) {
      if (!principal.features.has("workshop.customers")) failField("customerId", "validation.invalid");
      customer = await findLinkableCustomer(tx, d.customerId, current?.customerId ?? null);
      if (!customer) failField("customerId", "validation.invalid");
    }
    // Wechselt ein Entwurf den Kunden, gehören Name, Anschrift und E-Mail dem **neuen** Kunden: Das Formular schickt die vorbelegten Werte des alten mit – sie dürfen nicht stehen bleiben (der Beleg wäre an den
    // falschen Empfänger adressiert). Wer die Angaben ändern will, tut das nach dem Speichern.
    const switched = Boolean(current && customer && customer.id !== current.customerId);
    const recipient = switched && customer
      ? { name: customer.displayName, street: customer.street, zip: customer.zip, city: customer.city, email: customer.email }
      : { name: d.partyName ?? customer?.displayName ?? current?.partyName, street: d.partyStreet ?? customer?.street ?? null, zip: d.partyZip ?? customer?.zip ?? null, city: d.partyCity ?? customer?.city ?? null, email: d.buyerEmail ?? customer?.email ?? null };
    const partyName = recipient.name;
    if (!partyName) failField("partyName", "validation.required");
    if (docType === "final" && !customer) failField("customerId", "billing.errors.finalCustomer");

    // Fahrzeug (optional; Voraussetzung für „Angebot → Auftrag“)
    let vehicle: { id: string; label: string } | null = null;
    if (d.vehicleId) {
      if (!principal.features.has("workshop.vehicles")) failField("vehicleId", "validation.invalid");
      const found = await tx.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, plate: true, make: true, model: true, customerId: true, archivedAt: true, customer: { select: { processingRestrictedAt: true, anonymizedAt: true } } } });
      if (!found || (found.archivedAt && found.id !== current?.vehicleId)) failField("vehicleId", "validation.invalid");
      // Fahrzeug eines Kunden mit eingeschränkter Verarbeitung (Art. 18): keine neue Verknüpfung; eine bestehende bleibt
      if ((found.customer?.processingRestrictedAt || found.customer?.anonymizedAt) && found.id !== current?.vehicleId) failField("vehicleId", "billing.errors.restricted");
      if (found.customerId && customer && found.customerId !== customer.id) failField("vehicleId", "billing.errors.vehicleCustomer");
      vehicle = { id: found.id, label: [found.plate, [found.make, found.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") };
    }

    const rows = normalizeItems(d.items, exempt);
    const totals = totalsOf(rows, exempt);
    const deductedCents = docType === "final" ? await checkPartials(tx, d.deductPartialIds ?? [], customer?.id ?? null, current?.id ?? null) : 0;
    if (deductedCents > totals.grossCents && docType === "final") failField("deductPartialIds", "billing.errors.deductionTooHigh");

    const today = todayInput();
    const data = {
      source: "billing",
      direction: "outgoing",
      docType,
      number: current?.number ?? "",
      outgoingKey: null,
      partyName,
      partyKey: searchKey(partyName),
      customerId: customer?.id ?? null,
      partyStreet: recipient.street,
      partyZip: recipient.zip,
      partyCity: recipient.city,
      buyerEmail: recipient.email,
      issueDate: current?.issueDate ?? noon(today),
      dueDate: null,
      ...amountColumns(totals),
      status: "open",
      introText: d.introText ?? null,
      footerText: d.footerText ?? null,
      serviceFrom: d.serviceFrom ? noon(d.serviceFrom) : null,
      serviceTo: d.serviceTo ? noon(d.serviceTo) : null,
      validUntil: docType === "offer" ? noon(d.validUntil ?? addDaysToKey(today, OFFER_VALIDITY_DAYS)) : null,
      paymentDays: isInvoiceType(docType) ? (d.paymentDays ?? workshop.paymentTermDays) : null,
      paymentMethod: isInvoiceType(docType) ? (d.paymentMethod ?? "transfer") : null,
      buyerReference: d.buyerReference ?? null,
      taxNote: d.taxNote ?? null,
      exempt,
      vehicleId: vehicle?.id ?? null,
      vehicleLabel: vehicle?.label ?? null,
      mileageKm: d.mileageKm ?? null,
      deductedCents,
      createdByName: current?.createdByName ?? who(principal),
    };

    let id: string;
    if (current) {
      if (!(await claimRow(tx.invoice, current.id, d.version))) fail("conflict");
      await tx.invoice.update({ where: { id: current.id }, data });
      id = current.id;
    } else {
      id = (await tx.invoice.create({ data, select: { id: true } })).id;
    }
    await replaceItems(tx, id, rows);
    if (docType === "final") {
      await tx.invoiceDeduction.deleteMany({ where: { finalId: id } });
      const ids = [...new Set(d.deductPartialIds ?? [])];
      if (ids.length > 0) await tx.invoiceDeduction.createMany({ data: ids.map((partialId) => ({ finalId: id, partialId })) });
    }
    audit({ target: labelOf(docType, ""), entityId: id });
    return { id };
  },
});

/** Entwurf löschen (`billing.edit`): nur Entwürfe; festgeschriebene Belege werden nie gelöscht. */
export const deleteDraftOperation = defineOperation({
  name: "billing.delete",
  permission: "billing.edit",
  input: idInput,
  audit: "billing.delete",
  run: async ({ input, tx, audit }) => {
    const doc = await billingDoc(tx, input.id);
    if (!isDraft(doc)) fail("inUse", "billing.errors.notDraft");
    await tx.invoice.delete({ where: { id: doc.id } });
    audit({ target: labelOf(doc.docType, ""), entityId: doc.id });
    return { id: doc.id };
  },
});

/* ───────────── Festschreiben und Ausstellen ───────────── */

const commitInput = idInput.extend({ version: z.string().min(1) });

/**
 * Gemeinsamer Kern von Festschreiben (Rechnungen) und Ausstellen (Angebote, Auftragsbestätigungen): Prüfliste, fortlaufende Nummer aus dem Zähler (gleiche Transaktion – scheitert etwas, rollt auch
 * der Zähler zurück), Rechnungsdatum = heute (Werkstatt-Zone), Fälligkeit, Summen neu gerechnet, Schnappschuss von Absender und Empfänger, Anrechnung der Abschläge.
 */
async function commit(tx: Tx, input: z.output<typeof commitInput>, principal: { user: { name: string } }, expect: "invoice" | "quote") {
  const doc = await billingDoc(tx, input.id);
  if (!isDraft(doc)) fail("inUse", "billing.errors.notDraft");
  if (expect === "invoice" ? !isInvoiceType(doc.docType) || doc.docType === "credit" : !isQuoteType(doc.docType)) fail("invalid", "billing.errors.wrongKind");
  if (doc.customerId) {
    const customer = await tx.customer.findUnique({ where: { id: doc.customerId }, select: { processingRestrictedAt: true, anonymizedAt: true, customerNumber: true } });
    if (customer?.processingRestrictedAt || customer?.anonymizedAt) fail("invalid", "billing.errors.restricted");
  }
  if (!(await claimRow(tx.invoice, doc.id, input.version))) fail("conflict");

  const workshop = await loadWorkshop(tx);
  // Hat sich die Kleinunternehmer-Einstellung seit dem Anlegen geändert, stimmen Steuersätze und Summen nicht mehr: erst den Entwurf neu speichern
  if (doc.exempt !== workshop.smallBusiness) fail("invalid", "billing.errors.exemptChanged");
  const rows = doc.items.map((item) => ({ taxBp: item.taxBp, quantityMilli: item.quantityMilli, unitCents: item.unitCents, discountBp: item.discountBp }));
  const totals = totalsOf(rows, doc.exempt);
  // Ein Zeitpunkt für Rechnungsdatum, Nummernkreis (Jahr/Monat) und Festschreibezeitpunkt – kein Auseinanderfallen um Mitternacht oder zum Jahreswechsel
  const now = new Date();
  const today = todayInput(now);
  const problems = finalizeProblems({
    ...checkInputOf(
      {
        docType: doc.docType,
        partyName: doc.partyName,
        partyStreet: doc.partyStreet,
        partyZip: doc.partyZip,
        partyCity: doc.partyCity,
        serviceFrom: doc.serviceFrom ? dayKey(doc.serviceFrom) : null,
        serviceTo: doc.serviceTo ? dayKey(doc.serviceTo) : null,
        validUntil: doc.validUntil ? dayKey(doc.validUntil) : null,
        paymentDays: doc.paymentDays,
        paymentMethod: doc.paymentMethod,
        taxNote: doc.taxNote,
      },
      workshop,
      rows,
      totals,
    ),
  });
  if (doc.docType === "offer" && doc.validUntil && dayKey(doc.validUntil) < today) problems.push("validUntilPast");
  // Schlussrechnung: die Abschläge noch einmal gegen den aktuellen Stand prüfen (storniert? inzwischen anderswo angerechnet?)
  let deductedCents = 0;
  if (doc.docType === "final") {
    deductedCents = await checkPartials(tx, doc.deductions.map((d) => d.partialId), doc.customerId, doc.id);
    if (deductedCents > totals.grossCents) problems.push("deductionTooHigh");
  }
  if (problems.length > 0) throw new OperationError({ code: "invalid", key: "billing.errors.incomplete", data: { problems: problems.join(",") } });

  let allocated: { number: string; key: string };
  try {
    allocated = await allocateDocumentNumber(tx, doc.docType, workshop.invoiceNumberFormat, now);
  } catch (error) {
    if (error instanceof NumberExhaustedError) fail("failed", "billing.errors.numberExhausted");
    throw error;
  }
  const customerNumber = doc.customerId ? ((await tx.customer.findUnique({ where: { id: doc.customerId }, select: { customerNumber: true } }))?.customerNumber ?? null) : null;
  const issueDay = today;
  const paymentDays = doc.paymentDays ?? 0;
  // Zahlbetrag 0 (die Abschläge decken die Schlussrechnung voll): gilt von Anfang an als bezahlt – sonst bliebe der Beleg offen und würde überfällig
  const settled = expect === "invoice" && totals.grossCents - deductedCents <= 0;
  const data = {
    number: allocated.number,
    outgoingKey: allocated.key,
    issueDate: noon(issueDay),
    dueDate: expect === "invoice" ? noon(dueDayKey(issueDay, paymentDays)) : null,
    ...amountColumns(totals),
    deductedCents,
    exempt: doc.exempt,
    finalizedAt: now,
    finalizedByName: who(principal),
    offerStatus: doc.docType === "offer" ? "open" : null,
    status: settled ? "paid" : "open",
    paidAt: settled ? noon(issueDay) : null,
  };
  try {
    await tx.invoice.update({ where: { id: doc.id }, data });
  } catch (error) {
    if (mapPrismaError(error)?.code === "duplicate") fail("duplicate", "invoices.errors.numberTaken");
    throw error;
  }
  await tx.invoiceSnapshot.create({
    data: {
      invoiceId: doc.id,
      ...snapshotColumns(workshop, { name: doc.partyName, street: doc.partyStreet, zip: doc.partyZip, city: doc.partyCity, email: doc.buyerEmail, customerNumber }),
    },
  });
  if (doc.docType === "final") {
    try {
      for (const deduction of doc.deductions) await tx.invoiceDeduction.update({ where: { id: deduction.id }, data: { finalKey: deduction.partialId } });
    } catch (error) {
      if (mapPrismaError(error)?.code === "duplicate") failField("deductPartialIds", "billing.errors.deduction");
      throw error;
    }
  }
  return { id: doc.id, number: allocated.number, docType: doc.docType };
}

/** Rechnung, Abschlags- oder Schlussrechnung festschreiben (`invoices.finalize`). Nicht umkehrbar; korrigiert wird mit der Stornorechnung. */
export const finalizeDocumentOperation = defineOperation({
  name: "billing.finalize",
  permission: "invoices.finalize",
  input: commitInput,
  audit: "billing.finalize",
  run: async ({ input, principal, tx, audit, emit }) => {
    const result = await commit(tx, input, principal, "invoice");
    await emit("billing.finalized", { type: result.docType }, result.id);
    audit({ target: labelOf(result.docType, result.number), entityId: result.id });
    return { id: result.id, number: result.number };
  },
});

/** Angebot oder Auftragsbestätigung ausstellen (`billing.edit`): vergibt die Nummer und macht den Beleg unveränderlich. */
export const issueDocumentOperation = defineOperation({
  name: "billing.issue",
  permission: "billing.edit",
  input: commitInput,
  audit: "billing.issue",
  run: async ({ input, principal, tx, audit, emit }) => {
    const result = await commit(tx, input, principal, "quote");
    await emit("billing.finalized", { type: result.docType }, result.id);
    audit({ target: labelOf(result.docType, result.number), entityId: result.id });
    return { id: result.id, number: result.number };
  },
});

/* ───────────── Angebot: annehmen, ablehnen, Auftragsbestätigung, Auftrag ───────────── */

const decideInput = commitInput.extend({ acceptedOn: dateText().optional() });

async function decide(tx: Tx, input: z.output<typeof decideInput>, principal: { user: { name: string } }, to: "accepted" | "rejected") {
  const doc = await billingDoc(tx, input.id);
  if (doc.docType !== "offer" || isDraft(doc)) fail("invalid", "billing.errors.notOffer");
  if (doc.offerStatus !== "open") fail("inUse", "billing.errors.offerDecided");
  if (!(await claimRow(tx.invoice, doc.id, input.version))) fail("conflict");
  await tx.invoice.update({ where: { id: doc.id }, data: { offerStatus: to, acceptedAt: to === "accepted" ? noon(input.acceptedOn ?? todayInput()) : null, acceptedByName: to === "accepted" ? who(principal) : null } });
  return doc;
}

/** Angebot annehmen (`billing.accept`): hält fest, dass der Kunde zugestimmt hat (Datum optional, Standard heute). */
export const acceptOfferOperation = defineOperation({
  name: "billing.accept",
  permission: "billing.accept",
  input: decideInput,
  audit: "billing.accept",
  run: async ({ input, principal, tx, audit, emit }) => {
    const doc = await decide(tx, input, principal, "accepted");
    await emit("billing.accepted", { type: "offer" }, doc.id);
    audit({ target: labelOf("offer", doc.number), entityId: doc.id });
    return { id: doc.id };
  },
});

/** Angebot als abgelehnt vermerken (`billing.accept`). */
export const rejectOfferOperation = defineOperation({
  name: "billing.reject",
  permission: "billing.accept",
  input: commitInput,
  audit: "billing.reject",
  run: async ({ input, principal, tx, audit }) => {
    const doc = await decide(tx, input, principal, "rejected");
    audit({ target: labelOf("offer", doc.number), entityId: doc.id });
    return { id: doc.id };
  },
});

/**
 * Auftragsbestätigung aus einem angenommenen Angebot (`billing.edit`): ein neuer Entwurf mit den Angaben und Positionen des Angebots (Bezug auf das Angebot). Je Angebot gibt es höchstens eine.
 * Die Positionen werden unverändert übernommen; ist die Kleinunternehmer-Einstellung inzwischen anders, entfällt die Steuer bzw. wird nicht gesetzt (siehe `exempt`).
 */
export const createConfirmationOperation = defineOperation({
  name: "billing.confirm",
  permission: "billing.edit",
  input: idInput,
  audit: "billing.confirmation",
  run: async ({ input, principal, tx, audit }) => {
    const offer = await billingDoc(tx, input.id);
    if (offer.docType !== "offer" || isDraft(offer) || offer.offerStatus !== "accepted") fail("invalid", "billing.errors.notAccepted");
    // Ein neuer Entwurf für den Kunden ist eine neue Verknüpfung: bei eingeschränkter Verarbeitung (Art. 18) oder anonymisiertem Kunden nicht
    await assertCustomerUsable(tx, offer.customerId);
    if (await tx.invoice.findFirst({ where: { sourceDocId: offer.id, docType: "confirmation" }, select: { id: true } })) fail("duplicate", "billing.errors.confirmationExists");
    const workshop = await loadWorkshop(tx);
    const rows = normalizeItems(offer.items.map(itemInputOf), workshop.smallBusiness);
    const totals = totalsOf(rows, workshop.smallBusiness);
    const created = await tx.invoice.create({
      data: {
        source: "billing",
        direction: "outgoing",
        docType: "confirmation",
        number: "",
        partyName: offer.partyName,
        partyKey: offer.partyKey,
        customerId: offer.customerId,
        partyStreet: offer.partyStreet,
        partyZip: offer.partyZip,
        partyCity: offer.partyCity,
        buyerEmail: offer.buyerEmail,
        issueDate: noon(todayInput()),
        ...amountColumns(totals),
        status: "open",
        introText: offer.introText,
        footerText: offer.footerText,
        taxNote: offer.taxNote,
        exempt: workshop.smallBusiness,
        vehicleId: offer.vehicleId,
        vehicleLabel: offer.vehicleLabel,
        mileageKm: offer.mileageKm,
        orderId: offer.orderId,
        sourceDocId: offer.id,
        createdByName: who(principal),
      },
      select: { id: true },
    });
    await replaceItems(tx, created.id, rows);
    audit({ target: `${offer.number} → Auftragsbestätigung`, entityId: created.id });
    return { id: created.id };
  },
});

/**
 * Auftrag aus einem angenommenen Angebot (`billing.accept`, zusätzlich `orders.create`, `orders.edit` und `orders.prices`): legt den Auftrag **in derselben Transaktion** an (`createOrderInTx`: Nummer aus dem
 * Zähler, Ereignis, Audit, Hooks), überträgt die Positionen und verknüpft das Angebot. Scheitert eines davon, entsteht nichts. Das Angebot braucht ein Fahrzeug und darf noch keinen Auftrag haben.
 */
export const orderFromOfferOperation = defineOperation({
  name: "billing.toOrder",
  permission: "billing.accept",
  input: commitInput,
  audit: "billing.toOrder",
  run: async ({ input, principal, tx, audit, emit }) => {
    if (!principal.features.has("workshop.orders") || !principal.can("orders.edit") || !principal.can("orders.prices")) fail("forbidden");
    const offer = await billingDoc(tx, input.id);
    if (offer.docType !== "offer" || isDraft(offer) || offer.offerStatus !== "accepted") fail("invalid", "billing.errors.notAccepted");
    if (offer.orderId) fail("duplicate", "billing.errors.orderExists");
    if (!offer.vehicleId) fail("invalid", "billing.errors.noVehicle");
    // Ein neuer Auftrag verknüpft Kunde und Fahrzeug neu: Art. 18 gilt für den Kunden des Angebots und – in `createOrderInTx` – für den Halter des Fahrzeugs
    await assertCustomerUsable(tx, offer.customerId);
    const vehicle = await tx.vehicle.findUnique({ where: { id: offer.vehicleId }, select: { customerId: true } });
    if (!(await claimRow(tx.invoice, offer.id, input.version))) fail("conflict");
    const order = await createOrderInTx(
      { principal, tx, emit },
      { vehicleId: offer.vehicleId, ...(offer.customerId && vehicle && !vehicle.customerId ? { customerId: offer.customerId } : {}), request: `Angebot ${offer.number}${offer.introText ? `\n${offer.introText}` : ""}`.slice(0, 4000), ...(offer.mileageKm != null ? { mileageKm: offer.mileageKm } : {}) },
    );
    if (offer.items.length > 0) {
      await appendOrderItems(
        tx,
        order.id,
        offer.items.map((item) => ({
          kind: (["labor", "part", "other"] as const).find((k) => k === item.kind) ?? "other",
          description: item.description,
          unit: item.unit,
          quantityMilli: item.quantityMilli,
          unitCents: item.unitCents,
          taxBp: item.taxBp,
          discountBp: item.discountBp,
          refType: "offer",
          refId: offer.id,
        })),
      );
    }
    await tx.invoice.update({ where: { id: offer.id }, data: { orderId: order.id } });
    audit({ target: `${offer.number} → ${order.number}`, entityId: offer.id });
    return { id: offer.id, orderId: order.id, orderNumber: order.number };
  },
});

/* ───────────── Rechnung aus Auftrag ───────────── */

const fromOrderInput = z.object({
  orderId: z.string().min(1),
  /** den Auftrag abrechnen, obwohl er noch nicht abgeschlossen ist (ausdrückliche Bestätigung) */
  confirmOpen: z.boolean().optional(),
  /** den Auftrag noch einmal abrechnen, obwohl schon eine Rechnung dazu besteht (ausdrückliche Bestätigung) */
  acknowledgeDuplicate: z.boolean().optional(),
});

/**
 * Rechnung aus einem Auftrag (`billing.edit`, zusätzlich `orders.view` und `orders.prices`): ein neuer Entwurf mit Kunde, Fahrzeug und allen Positionen des Auftrags (Zeiten aus der Zeiterfassung sind dort
 * schon Positionen; Verkaufspreise der Teile stehen in den Positionen). Der Auftrag muss abgeschlossen sein – oder die Person bestätigt ausdrücklich. Gibt es zum Auftrag schon eine Rechnung, bricht die
 * Operation ab, außer die Person bestätigt auch das (kein stilles Doppelabrechnen). Aufträge von Kunden mit eingeschränkter Verarbeitung (Art. 18) und ohne Kunden werden nicht abgerechnet.
 */
export const invoiceFromOrderOperation = defineOperation({
  name: "billing.fromOrder",
  permission: "billing.edit",
  input: fromOrderInput,
  audit: "billing.fromOrder",
  run: async ({ input, principal, tx, audit }) => {
    if (!principal.features.has("workshop.orders") || !principal.can("orders.view") || !principal.can("orders.prices")) fail("forbidden");
    const order = await orderForBilling(input.orderId, tx);
    if (!order) fail("notFound");
    if (order.status === "cancelled") fail("invalid", "billing.errors.orderCancelled");
    if (order.restricted) fail("invalid", "billing.errors.restricted");
    if (!order.customerId) fail("invalid", "billing.errors.orderNoCustomer");
    if (order.status !== "picked_up" && !input.confirmOpen) fail("invalid", "billing.errors.orderOpen");
    const billed = await tx.invoice.findFirst({
      where: { source: "billing", orderId: order.id, docType: { in: ["invoice", "final"] }, OR: [{ finalizedAt: null }, { status: { not: "cancelled" }, cancelledBy: null }] },
      select: { id: true },
    });
    if (billed && !input.acknowledgeDuplicate) fail("duplicate", "billing.errors.orderBilled");
    const customer = await findLinkableCustomer(tx, order.customerId, null);
    if (!customer) fail("invalid", "billing.errors.restricted");

    const workshop = await loadWorkshop(tx);
    const exempt = workshop.smallBusiness;
    const rows = normalizeItems(
      order.items.map(itemInputOf),
      exempt,
    );
    const totals = totalsOf(rows, exempt);
    const service = noon(dayKey(order.closedAt ?? new Date()));
    const created = await tx.invoice.create({
      data: {
        source: "billing",
        direction: "outgoing",
        docType: "invoice",
        number: "",
        partyName: customer.displayName,
        partyKey: searchKey(customer.displayName),
        customerId: customer.id,
        partyStreet: customer.street,
        partyZip: customer.zip,
        partyCity: customer.city,
        buyerEmail: customer.email,
        issueDate: noon(todayInput()),
        ...amountColumns(totals),
        status: "open",
        serviceFrom: service,
        paymentDays: workshop.paymentTermDays,
        paymentMethod: "transfer",
        exempt,
        vehicleId: order.vehicle.id,
        vehicleLabel: [order.vehicle.plate, [order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
        mileageKm: order.mileageKm,
        orderId: order.id,
        createdByName: who(principal),
      },
      select: { id: true },
    });
    await replaceItems(tx, created.id, rows);
    audit({ target: `${order.number} → Rechnung (Entwurf)`, entityId: created.id });
    return { id: created.id };
  },
});

/* ───────────── Zahlungen ───────────── */

const paymentInput = idInput.extend({
  amount: moneyCents("billing.errors.amount"),
  paidAt: dateText().optional(),
  method: z.enum(PAYMENT_METHODS).default("transfer"),
  note: text(200),
});

/** Beleg, zu dem Zahlungen erfasst werden dürfen: festgeschriebene Buchungsbelege der Rechnungserstellung, nicht storniert, kein Gegenbeleg. */
async function payableDoc(tx: Tx, id: string) {
  const doc = await tx.invoice.findUnique({ where: { id }, include: { cancelledBy: { select: { id: true } } } });
  if (!doc || doc.source !== "billing") fail("notFound");
  if (!doc.finalizedAt || !isInvoiceType(doc.docType) || doc.docType === "credit" || doc.status === "cancelled" || doc.cancelledBy) fail("invalid", "billing.errors.notPayable");
  return doc;
}

async function applyPayments(tx: Tx, doc: { id: string; grossCents: number; deductedCents: number }) {
  const sum = await tx.invoicePayment.aggregate({ where: { invoiceId: doc.id }, _sum: { amountCents: true }, _max: { paidAt: true } });
  const paidCents = sum._sum.amountCents ?? 0;
  const status = statusAfterPayments(doc, paidCents);
  await tx.invoice.update({ where: { id: doc.id }, data: { paidCents, status, paidAt: status === "paid" ? (sum._max.paidAt ?? null) : null } });
  return { paidCents, status };
}

/** Zahlungseingang erfassen (`invoices.edit`): Betrag, Datum, Art. Der Zahlstatus ergibt sich automatisch; mehr als der offene Betrag ist nicht möglich. */
export const addPaymentOperation = defineOperation({
  name: "billing.addPayment",
  permission: "invoices.edit",
  input: paymentInput,
  audit: "billing.payment",
  run: async ({ input, principal, tx, audit, emit }) => {
    const doc = await payableDoc(tx, input.id);
    if (input.amount < 1) failField("amount", "billing.errors.amount");
    if (input.amount > remainingCents(doc)) failField("amount", "billing.errors.overpaid");
    const day = input.paidAt ?? todayInput();
    if (day < dayKey(doc.issueDate) || day > todayInput()) failField("paidAt", "billing.errors.paymentDate");
    const payment = await tx.invoicePayment.create({ data: { invoiceId: doc.id, paidAt: noon(day), amountCents: input.amount, method: input.method, note: input.note ?? null, recordedByName: who(principal) }, select: { id: true } });
    const result = await applyPayments(tx, doc);
    if (result.status === "paid" && doc.status !== "paid") await emit("billing.paid", { type: doc.docType }, doc.id);
    audit({ target: `${doc.number} · ${(input.amount / 100).toFixed(2)} EUR`, entityId: doc.id });
    // die Kennung ist die der Zahlung (die API legt Zahlungen als eigene Ressource an); der Beleg steht in `documentId`
    return { id: payment.id, documentId: doc.id, paidCents: result.paidCents, status: result.status };
  },
});

/** Zahlungseingang entfernen (`invoices.edit`): Korrektur einer falschen Erfassung; steht im Audit-Log. */
export const removePaymentOperation = defineOperation({
  name: "billing.removePayment",
  permission: "invoices.edit",
  input: idInput,
  audit: "billing.paymentRemove",
  run: async ({ input, tx, audit }) => {
    const payment = await tx.invoicePayment.findUnique({ where: { id: input.id }, select: { id: true, invoiceId: true, amountCents: true } });
    if (!payment) fail("notFound");
    const doc = await payableDoc(tx, payment.invoiceId);
    await tx.invoicePayment.delete({ where: { id: payment.id } });
    const result = await applyPayments(tx, doc);
    audit({ target: `${doc.number} · −${(payment.amountCents / 100).toFixed(2)} EUR`, entityId: doc.id });
    return { id: doc.id, paidCents: result.paidCents, status: result.status };
  },
});

/* ───────────── Versand per E-Mail ───────────── */

const sendInput = idInput.extend({
  /** die XRechnung (XML) zusätzlich anhängen (nur Buchungsbelege) */
  includeXml: z.boolean().optional(),
  /** noch einmal senden, obwohl der Beleg schon versendet wurde (ausdrückliche Bestätigung) */
  resend: z.boolean().optional(),
});

type Prepared = { files: Array<{ path: string; filename: string; contentType: string }>; to: string; subject: string; text: string };

/**
 * An wen der Beleg geht: die **Adresse des Belegs** (Schnappschuss des festgeschriebenen Beleges – sie steht auch auf dem Beleg und in der XRechnung), nur ohne sie die aktuelle Adresse des verknüpften Kunden.
 * So laufen Beleg und Versand nicht auseinander. Ein Kunde mit eingeschränkter Verarbeitung (Art. 18) oder anonymisierter Kunde bekommt nichts; ein stornierter Beleg wird nicht mehr versendet
 * (die Stornorechnung selbst schon).
 */
async function mailRecipient(client: Pick<PrismaClient | Prisma.TransactionClient, "invoice" | "customer">, id: string) {
  const row = await client.invoice.findFirst({
    where: { id, source: "billing", finalizedAt: { not: null } },
    select: { customerId: true, buyerEmail: true, snapshot: { select: { rEmail: true } }, cancelledBy: { select: { id: true } } },
  });
  if (!row) return null;
  const customer = row.customerId ? await client.customer.findUnique({ where: { id: row.customerId }, select: { email: true, processingRestrictedAt: true, anonymizedAt: true } }) : null;
  const restricted = Boolean(row.customerId && (!customer || customer.processingRestrictedAt || customer.anonymizedAt));
  const docEmail = (row.snapshot ? row.snapshot.rEmail : row.buyerEmail)?.trim() || null;
  return { email: restricted ? null : (docEmail ?? (customer?.email?.trim() || null)), restricted, cancelled: row.cancelledBy !== null };
}

/**
 * Beleg per E-Mail senden (`billing.send`; `queueMail` verlangt zusätzlich `mail.send` und einen eingerichteten Versand). Empfänger ist die E-Mail-Adresse des Kunden (aktuelle Adresse des verknüpften,
 * nicht eingeschränkten Kunden, sonst die des Beleges); es gibt kein freies Adressfeld. Betreff und Text stammen aus der festen Vorlage (`mailContent`: nur Nummer, Name, Betrag, Datum und Werkstattname).
 * Anhang ist das PDF (und auf Wunsch die XRechnung); beide entstehen in `prepare` aus dem Beleg und liegen danach als Dateien im Dateispeicher (so sieht man, was gesendet wurde). Wiederholter Versand
 * braucht die ausdrückliche Bestätigung (`resend`). Ohne Adresse des Kunden gibt es keinen Versand – PDF und Download bleiben.
 */
export const sendDocumentOperation = defineOperation({
  name: "billing.send",
  permission: "billing.send",
  input: sendInput,
  audit: "billing.send",
  prepare: async ({ input, principal }): Promise<Prepared> => {
    // `queueMail` verlangt `mail.send` ebenfalls – hier vorab, damit für Unberechtigte kein PDF entsteht
    if (!principal.can("mail.send")) fail("forbidden");
    if (!(await mailConfigured())) fail("invalid", "mail.errors.notConfigured");
    // PDF-Bibliothek erst jetzt laden: die Operationen werden von jeder Seite und jeder Aktion der Funktion geladen, das PDF braucht nur der Versand
    const { buildDocumentPdf, logoForPdf } = await import("./documents");
    const { buildDocumentXml, xrechnungProblems } = await import("./xrechnung");
    const loaded = await loadDocView(input.id);
    if (!loaded || loaded.view.draft) fail("notFound");
    const { view, row } = loaded;
    if (row.sentAt && !input.resend) fail("conflict", "billing.errors.alreadySent");
    const recipient = await mailRecipient(db, input.id);
    if (!recipient) fail("notFound");
    if (recipient.restricted) fail("invalid", "billing.errors.restricted");
    if (recipient.cancelled) fail("invalid", "billing.errors.cancelledSend");
    const email = recipient.email;
    if (!email) fail("invalid", "billing.errors.noEmail");
    const wantXml = Boolean(input.includeXml) && isInvoiceType(view.docType);
    const stored: string[] = [];
    try {
      const workshop = await getWorkshop();
      const pdf = await buildDocumentPdf(view, { logo: logoForPdf(workshop.logoDataUrl) });
      const year = view.issueDay.slice(0, 4);
      const pdfName = documentFileName(view.docType, view.number, "pdf");
      const files: Prepared["files"] = [];
      const pdfPath = await storeFile(`${SENT_FILES_DIR}/${year}`, pdfName, pdf);
      stored.push(pdfPath);
      files.push({ path: pdfPath, filename: pdfName, contentType: "application/pdf" });
      if (wantXml) {
        const problems = xrechnungProblems(view);
        if (problems.length > 0) throw new OperationError({ code: "invalid", key: "billing.errors.xrechnungIncomplete", data: { problems: problems.join(",") } });
        const xmlName = documentFileName(view.docType, view.number, "xml");
        const xmlPath = await storeFile(`${SENT_FILES_DIR}/${year}`, xmlName, new TextEncoder().encode(buildDocumentXml(view)));
        stored.push(xmlPath);
        files.push({ path: xmlPath, filename: xmlName, contentType: "application/xml" });
      }
      const content = mailContent({
        docType: view.docType,
        number: view.number,
        recipientName: view.recipient.name,
        amountCents: view.docType === "offer" || view.docType === "confirmation" ? view.totals.grossCents : viewPayable(view),
        dueDate: view.dueDay,
        validUntil: view.validUntil,
        workshopName: view.sender.name,
        hasXml: wantXml,
      });
      return { files, to: email, subject: content.subject, text: content.text };
    } catch (error) {
      // schon abgelegte Anhänge wieder entfernen: nichts bleibt liegen, wenn die Vorbereitung scheitert
      await Promise.all(stored.map((path) => removeFile(path).catch((e) => logError("billing:cleanup", e))));
      if (error instanceof EinvoiceError) throw new OperationError({ code: "invalid", key: "billing.errors.xrechnungIncomplete", data: { problems: error.problems.join(",") } });
      if (error instanceof PdfError) fail("invalid", "billing.errors.pdf");
      throw error;
    }
  },
  finish: async (prepared, ok) => {
    if (!ok && prepared) await Promise.all(prepared.files.map((file) => removeFile(file.path).catch((error) => logError("billing:cleanup", error))));
  },
  run: async ({ input, prepared, principal, tx, audit, emit }) => {
    const doc = await tx.invoice.findUnique({ where: { id: input.id }, select: { id: true, source: true, finalizedAt: true, number: true, docType: true, partyName: true, sentAt: true } });
    if (!doc || doc.source !== "billing" || !doc.finalizedAt) fail("notFound");
    if (doc.sentAt && !input.resend) fail("conflict", "billing.errors.alreadySent");
    // Zwischen Vorbereitung und Transaktion kann sich etwas geändert haben (Kunde eingeschränkt oder anonymisiert, Beleg storniert, Adresse anders): dann nichts senden
    const recipient = await mailRecipient(tx, doc.id);
    if (!recipient || recipient.restricted) fail("invalid", "billing.errors.restricted");
    if (recipient.cancelled) fail("invalid", "billing.errors.cancelledSend");
    if (recipient.email !== prepared.to) fail("conflict");
    await queueMail({ tx, emit, principal }, { to: [prepared.to], subject: prepared.subject, text: prepared.text, attachments: prepared.files, purpose: "billing", entityId: doc.id });
    // Die Anhänge im Dateispeicher gehören zum Beleg: Angebote und Auftragsbestätigungen räumt der Aufräumlauf nach der Frist weg, bei Rechnungen bleiben sie bis zur Anonymisierung des Kunden
    const purgeAfter = isQuoteType(doc.docType) ? new Date(Date.now() + SENT_QUOTE_FILES_KEEP_DAYS * 86_400_000) : null;
    await tx.invoiceSentFile.createMany({ data: prepared.files.map((file) => ({ invoiceId: doc.id, path: file.path, purgeAfter })) });
    await tx.invoice.update({ where: { id: doc.id }, data: { sentAt: new Date(), sentCount: { increment: 1 } } });
    await emit("billing.sent", { type: doc.docType }, doc.id);
    audit({ target: labelOf(doc.docType, doc.number), entityId: doc.id });
    return { id: doc.id };
  },
});
