import type { z } from "zod";
import type { Workshop } from "@/generated/prisma/client";
import { computeTotals, type Totals } from "@/lib/line-items";
import type { lineItemsSchema } from "@/lib/line-items-schema";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { fail, failField, type Tx } from "@/server/operations";
import { ALLOWED_TAX_BP, ITEM_KINDS } from "./constants";
import type { FinalizeCheckInput } from "./domain";

/**
 * Gemeinsame Bausteine der Operationen der Rechnungserstellung (nur in Transaktionen, über `tx`): Werkstattprofil lesen, Positionen prüfen und speichern, Summen rechnen,
 * Schnappschuss von Absender und Empfänger bilden.
 */

/**
 * Steuerzeichen (außer Tabulator und Zeilenumbruch), DEL, C1 und die Umkehrzeichen (Bidi: U+202A–U+202E, U+2066–U+2069) aus Texten, die auf Beleg, PDF und XML landen: ein Umkehrzeichen in einem Namen
 * würde Beträge und Namen im Beleg optisch vertauschen; U+0000 hat in der Datenbank nichts zu suchen.
 */
export const stripControl = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "");

export type ItemInput = z.output<ReturnType<typeof lineItemsSchema>>[number];

/** Das Werkstattprofil (Singleton); fehlt die Zeile, entsteht sie mit den Standardwerten (wie `getWorkshop()`, aber in der Transaktion). */
export async function loadWorkshop(tx: Tx): Promise<Workshop> {
  return (await tx.workshop.findUnique({ where: { id: "default" } })) ?? (await tx.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }));
}

/**
 * Prüft die Positionen und bringt sie in die Form der Tabelle. **Steuer wird serverseitig geprüft:** bei Kleinunternehmern (`exempt`) ist jeder Satz 0 (die Zeilen werden auf 0 gesetzt), sonst
 * sind nur 19 %, 7 % und 0 % erlaubt (`billing.errors.taxRate` an der Zeile). Die Summen glaubt der Server dem Browser nie: `totalsOf` rechnet nach, und eine zu große Summe
 * (`exceedsLimit`) wird **vor dem Speichern** abgelehnt.
 */
export function normalizeItems(items: readonly ItemInput[], exempt: boolean) {
  items.forEach((item, index) => {
    if (item.kind && !(ITEM_KINDS as readonly string[]).includes(item.kind)) failField(`items.${index}.kind`, "validation.invalid");
    if (!!item.refType !== !!item.refId) failField(`items.${index}.refId`, "validation.invalid");
    if (!exempt && !(ALLOWED_TAX_BP as readonly number[]).includes(item.taxBp)) failField(`items.${index}.taxBp`, "billing.errors.taxRate");
  });
  return items.map((item, position) => ({
    position,
    kind: item.kind || "labor",
    description: stripControl(item.description),
    unit: stripControl(item.unit ?? ""),
    quantityMilli: item.quantityMilli,
    unitCents: item.unitCents,
    taxBp: exempt ? 0 : item.taxBp,
    discountBp: item.discountBp ?? 0,
    refType: item.refType || null,
    refId: item.refId || null,
  }));
}

type Row = ReturnType<typeof normalizeItems>[number];

/** Summen der Positionen; zu große Beträge scheitern hier (vor dem Speichern). */
export function totalsOf(rows: ReadonlyArray<Pick<Row, "quantityMilli" | "unitCents" | "taxBp" | "discountBp">>, exempt: boolean): Totals {
  const totals = computeTotals(rows, { exempt });
  if (totals.exceedsLimit) fail("invalid", "validation.tooLarge");
  return totals;
}

/** Eine gespeicherte Position (Spalten der Tabelle) als Eingabe für `normalizeItems` (Kopieren von Positionen). */
export function itemInputOf(item: { kind: string; description: string; unit: string; quantityMilli: number; unitCents: number; taxBp: number; discountBp: number; refType: string | null; refId: string | null }): ItemInput {
  return {
    kind: item.kind,
    description: item.description,
    unit: item.unit,
    quantityMilli: item.quantityMilli,
    unitCents: item.unitCents,
    taxBp: item.taxBp,
    discountBp: item.discountBp,
    ...(item.refType && item.refId ? { refType: item.refType, refId: item.refId } : {}),
  };
}

/** Ersetzt die Positionen eines Entwurfs. */
export async function replaceItems(tx: Tx, invoiceId: string, rows: readonly Row[]): Promise<void> {
  await tx.invoiceItem.deleteMany({ where: { invoiceId } });
  if (rows.length > 0) await tx.invoiceItem.createMany({ data: rows.map((row) => ({ ...row, invoiceId })) });
}

/** Netto, Steuer und Brutto für die Spalten des Beleges. */
export const amountColumns = (totals: Totals) => ({ netCents: totals.netCents, vatCents: totals.taxCents, grossCents: totals.grossCents });

/** Empfänger-Angaben eines Entwurfs (Spalten der Tabelle). */
export type RecipientColumns = { partyName: string; partyStreet: string | null; partyZip: string | null; partyCity: string | null; buyerEmail: string | null; customerId: string | null };

/** Kunde, wie die Operationen ihn brauchen (Anschrift zum Vorbelegen, Kundennummer für den Schnappschuss). */
export async function findLinkableCustomer(tx: Tx, customerId: string, current: string | null) {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { id: true, firstName: true, lastName: true, company: true, email: true, street: true, zip: true, city: true, customerNumber: true, archivedAt: true, processingRestrictedAt: true, anonymizedAt: true },
  });
  // Eingeschränkte Verarbeitung (Art. 18 DSGVO) und anonymisierte Kunden: nie verknüpfen; archivierte nur, wenn die Verknüpfung schon besteht
  if (!customer || customer.processingRestrictedAt || customer.anonymizedAt || (customer.archivedAt && customer.id !== current)) return null;
  return { ...customer, displayName: customerDisplayName(customer) };
}

/**
 * Neue Verknüpfungen mit einem Kunden (Auftragsbestätigung, Auftrag aus Angebot) gibt es nicht für Kunden mit eingeschränkter Verarbeitung (Art. 18 DSGVO) und anonymisierte Kunden. Ohne Kunden (`null`)
 * ist nichts zu prüfen. Die Prüfung läuft in der Transaktion der Operation.
 */
export async function assertCustomerUsable(tx: Tx, customerId: string | null): Promise<void> {
  if (!customerId) return;
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { processingRestrictedAt: true, anonymizedAt: true } });
  if (!customer || customer.processingRestrictedAt || customer.anonymizedAt) fail("invalid", "billing.errors.restricted");
}

/** Schnappschuss von Absender (Profil) und Empfänger (Beleg) als Spalten der Tabelle `InvoiceSnapshot` (ohne Kennung). */
export function snapshotColumns(
  workshop: Workshop,
  recipient: { name: string; street: string | null; zip: string | null; city: string | null; email: string | null; customerNumber: string | null },
) {
  const orNull = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
  return {
    sName: workshop.name,
    sStreet: orNull(workshop.street),
    sZip: orNull(workshop.zip),
    sCity: orNull(workshop.city),
    sPhone: orNull(workshop.phone),
    sEmail: orNull(workshop.email),
    sWebsite: orNull(workshop.website),
    sTaxNumber: orNull(workshop.taxNumber),
    sVatId: orNull(workshop.vatId),
    sBankName: orNull(workshop.bankName),
    sIban: orNull(workshop.iban),
    sBic: orNull(workshop.bic),
    sDirector: orNull(workshop.managingDirector),
    sRegisterCourt: orNull(workshop.registerCourt),
    sRegisterNumber: orNull(workshop.registerNumber),
    sSmallBusiness: workshop.smallBusiness,
    rName: recipient.name.trim(),
    rStreet: orNull(recipient.street),
    rZip: orNull(recipient.zip),
    rCity: orNull(recipient.city),
    rEmail: orNull(recipient.email),
    rCustomerNumber: orNull(recipient.customerNumber),
  };
}

/** Die Angaben der Prüfliste aus Beleg und Profil (gemeinsam für das Festschreiben und die Anzeige). */
export function checkInputOf(
  doc: { docType: string; partyName: string; partyStreet: string | null; partyZip: string | null; partyCity: string | null; serviceFrom: string | null; serviceTo: string | null; validUntil: string | null; paymentDays: number | null; paymentMethod: string | null; taxNote: string | null },
  workshop: Pick<Workshop, "name" | "street" | "zip" | "city" | "taxNumber" | "vatId" | "iban" | "smallBusiness">,
  rows: ReadonlyArray<{ taxBp: number }>,
  totals: Totals,
): FinalizeCheckInput {
  return {
    docType: doc.docType,
    sender: { name: workshop.name, street: workshop.street, zip: workshop.zip, city: workshop.city, taxNumber: workshop.taxNumber, vatId: workshop.vatId, iban: workshop.iban, smallBusiness: workshop.smallBusiness },
    recipient: { name: doc.partyName, street: doc.partyStreet, zip: doc.partyZip, city: doc.partyCity },
    serviceFrom: doc.serviceFrom,
    serviceTo: doc.serviceTo,
    validUntil: doc.validUntil,
    paymentDays: doc.paymentDays,
    paymentMethod: doc.paymentMethod ?? "transfer",
    itemCount: rows.length,
    taxRates: [...new Set(rows.map((row) => row.taxBp))],
    taxNote: doc.taxNote,
    exceedsLimit: totals.exceedsLimit,
    grossCents: totals.grossCents,
  };
}
