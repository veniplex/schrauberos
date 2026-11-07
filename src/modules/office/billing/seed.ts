import type { PrismaClient } from "@/generated/prisma/client";
import { computeTotals } from "@/lib/line-items";
import { searchKey } from "@/lib/search-key";
import { atDay, noonOf } from "@/lib/seed-days";
import { addDays } from "@/lib/zone";
import { allocateDocumentNumber } from "@/server/invoice-numbering";
import type { SeedDef } from "@/modules/types";

/**
 * Beispiele der Rechnungserstellung für die Browser-CI und zum Ausprobieren: Angebote (offen, angenommen mit Auftragsbestätigung, abgelehnt, abgelaufen), ein Entwurf, Rechnungen
 * (offen, teilweise bezahlt, bezahlt), Abschlags- und Schlussrechnung, eine stornierte Rechnung mit Stornorechnung. Alles gehört den ersten Demo-Kunden, soweit es sie gibt. Ist das
 * Werkstattprofil noch leer, bekommt es Beispielangaben (Anschrift, Steuernummer, IBAN), damit die Belege festgeschrieben aussehen. Seeds importieren nichts mit `server-only`.
 */
type Item = { description: string; unit?: string; quantityMilli: number; unitCents: number; taxBp?: number; discountBp?: number; kind?: string };

async function demo(db: PrismaClient) {
  if ((await db.invoice.count({ where: { source: "billing" } })) > 0) return;
  const customers = await db.customer.findMany({ take: 3, orderBy: { customerNumber: "asc" } });
  if (customers.length === 0) return;
  console.log("Demo-Daten (Angebote & Rechnungen) werden angelegt …");

  let workshop = (await db.workshop.findUnique({ where: { id: "default" } })) ?? (await db.workshop.create({ data: { id: "default" } }));
  if (!workshop.street && !workshop.taxNumber && !workshop.iban) {
    workshop = await db.workshop.update({
      where: { id: "default" },
      data: { street: "Werkstattweg 1", zip: "12345", city: "Musterstadt", phone: "01234 567890", email: "info@werkstatt.example", taxNumber: "12/345/67890", iban: "DE89370400440532013000", bic: "COBADEFFXXX", bankName: "Beispielbank", managingDirector: "Max Meister" },
    });
  }
  const exempt = workshop.smallBusiness;
  const labor: Item = { description: "Inspektion nach Herstellervorgabe", unit: "Std", quantityMilli: 2000, unitCents: 8500, kind: "labor" };
  const oil: Item = { description: "Motoröl 5W-30", unit: "l", quantityMilli: 5500, unitCents: 1290, kind: "part", discountBp: 500 };
  const filter: Item = { description: "Ölfilter", unit: "Stk", quantityMilli: 1000, unitCents: 1890, kind: "part" };
  const brakes: Item = { description: "Bremsbeläge vorn (Satz)", unit: "Satz", quantityMilli: 1000, unitCents: 6900, kind: "part" };

  type Spec = {
    docType: "offer" | "confirmation" | "invoice" | "partial" | "final";
    customer: number;
    items: Item[];
    issuedAgo: number | null;
    extra?: Record<string, unknown>;
    paid?: number;
    deduct?: string[];
    cancelled?: boolean;
  };
  const created: Record<string, string> = {};
  async function make(key: string, spec: Spec) {
    const customer = customers[spec.customer % customers.length];
    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() || customer.company || customer.lastName;
    const rows = spec.items.map((item, position) => ({ position, kind: item.kind ?? "labor", description: item.description, unit: item.unit ?? "", quantityMilli: item.quantityMilli, unitCents: item.unitCents, taxBp: exempt ? 0 : (item.taxBp ?? 1900), discountBp: item.discountBp ?? 0 }));
    const totals = computeTotals(rows, { exempt });
    const issued = spec.issuedAgo !== null;
    const issueDate = noonOf(atDay(-(spec.issuedAgo ?? 0)));
    const invoiceLike = spec.docType === "invoice" || spec.docType === "partial" || spec.docType === "final";
    const deductions = (spec.deduct ?? []).map((k) => created[k]).filter(Boolean);
    const deductedRows = deductions.length ? await db.invoice.findMany({ where: { id: { in: deductions } }, select: { id: true, grossCents: true, netCents: true, vatCents: true } }) : [];
    const deductedCents = deductedRows.reduce((sum, r) => sum + r.grossCents, 0);
    const deductedNetCents = deductedRows.reduce((sum, r) => sum + (r.netCents ?? r.grossCents), 0);
    const deductedVatCents = deductedCents - deductedNetCents;
    let number = "";
    let outgoingKey: string | null = null;
    if (issued) ({ number, key: outgoingKey } = await allocateDocumentNumber(db, spec.docType, workshop.invoiceNumberFormat, new Date()));
    const paidCents = spec.paid ?? 0;
    const doc = await db.invoice.create({
      data: {
        source: "billing",
        direction: "outgoing",
        docType: spec.docType,
        number,
        outgoingKey,
        partyName: name,
        partyKey: searchKey(name),
        customerId: customer.id,
        partyStreet: customer.street ?? "Beispielstraße 5",
        partyZip: customer.zip ?? "12345",
        partyCity: customer.city ?? "Musterstadt",
        buyerEmail: customer.email,
        issueDate,
        dueDate: issued && invoiceLike ? noonOf(addDays(atDay(-(spec.issuedAgo ?? 0)), 14)) : null,
        netCents: totals.netCents,
        vatCents: totals.taxCents,
        grossCents: totals.grossCents,
        deductedCents,
        deductedNetCents,
        deductedVatCents,
        paidCents,
        status: spec.cancelled ? "cancelled" : paidCents > 0 && paidCents >= totals.grossCents - deductedCents ? "paid" : "open",
        paidAt: paidCents > 0 && paidCents >= totals.grossCents - deductedCents ? noonOf(atDay(-Math.max((spec.issuedAgo ?? 0) - 3, 1))) : null,
        finalizedAt: issued ? issueDate : null,
        finalizedByName: issued ? "Demo" : null,
        offerStatus: issued && spec.docType === "offer" ? "open" : null,
        validUntil: spec.docType === "offer" ? noonOf(atDay(14 - (spec.issuedAgo ?? 0))) : null,
        serviceFrom: invoiceLike ? issueDate : null,
        paymentDays: invoiceLike ? 14 : null,
        paymentMethod: invoiceLike ? "transfer" : null,
        exempt,
        introText: spec.docType === "offer" ? "Vielen Dank für Ihre Anfrage. Gern erstellen wir Ihnen folgendes Angebot." : null,
        createdByName: "Demo",
        ...spec.extra,
      },
      select: { id: true },
    });
    await db.invoiceItem.createMany({ data: rows.map((r) => ({ ...r, invoiceId: doc.id })) });
    if (issued) {
      await db.invoiceSnapshot.create({
        data: {
          invoiceId: doc.id,
          sName: workshop.name,
          sStreet: workshop.street,
          sZip: workshop.zip,
          sCity: workshop.city,
          sPhone: workshop.phone,
          sEmail: workshop.email,
          sTaxNumber: workshop.taxNumber,
          sVatId: workshop.vatId,
          sBankName: workshop.bankName,
          sIban: workshop.iban,
          sBic: workshop.bic,
          sDirector: workshop.managingDirector,
          sSmallBusiness: exempt,
          rName: name,
          rStreet: customer.street ?? "Beispielstraße 5",
          rZip: customer.zip ?? "12345",
          rCity: customer.city ?? "Musterstadt",
          rEmail: customer.email,
          rCustomerNumber: customer.customerNumber,
        },
      });
    }
    if (paidCents > 0) await db.invoicePayment.create({ data: { invoiceId: doc.id, paidAt: noonOf(atDay(-Math.max((spec.issuedAgo ?? 0) - 3, 1))), amountCents: paidCents, method: "transfer", recordedByName: "Demo" } });
    for (const partialId of deductions) await db.invoiceDeduction.create({ data: { finalId: doc.id, partialId, finalKey: issued ? partialId : null } });
    created[key] = doc.id;
    return doc.id;
  }

  // Angebote: offen, angenommen (mit Auftragsbestätigung als Entwurf), abgelehnt, abgelaufen
  await make("offerOpen", { docType: "offer", customer: 0, items: [labor, oil, filter], issuedAgo: 2 });
  const accepted = await make("offerAccepted", { docType: "offer", customer: 1, items: [brakes, { ...labor, quantityMilli: 1500 }], issuedAgo: 6 });
  await db.invoice.update({ where: { id: accepted }, data: { offerStatus: "accepted", acceptedAt: noonOf(atDay(-4)), acceptedByName: "Demo" } });
  await make("confirmation", { docType: "confirmation", customer: 1, items: [brakes, { ...labor, quantityMilli: 1500 }], issuedAgo: null, extra: { sourceDocId: accepted } });
  const rejected = await make("offerRejected", { docType: "offer", customer: 2, items: [{ description: "Klimaservice", quantityMilli: 1000, unitCents: 9900, kind: "labor" }], issuedAgo: 12 });
  await db.invoice.update({ where: { id: rejected }, data: { offerStatus: "rejected" } });
  await make("offerExpired", { docType: "offer", customer: 0, items: [{ description: "Winterräder montieren und wuchten", quantityMilli: 4000, unitCents: 1500, kind: "labor" }], issuedAgo: 30, extra: { validUntil: noonOf(atDay(-16)) } });

  // Entwurf, offene und bezahlte Rechnungen, Teilzahlung
  await make("draft", { docType: "invoice", customer: 2, items: [labor, filter], issuedAgo: null });
  await make("invoiceOpen", { docType: "invoice", customer: 0, items: [labor, oil, filter], issuedAgo: 5 });
  const partlyPaid = computeTotals([labor, brakes].map((i) => ({ quantityMilli: i.quantityMilli, unitCents: i.unitCents, taxBp: exempt ? 0 : 1900, discountBp: i.discountBp ?? 0 })), { exempt }).grossCents;
  await make("invoicePartial", { docType: "invoice", customer: 1, items: [labor, brakes], issuedAgo: 9, paid: Math.floor(partlyPaid / 2) });
  await make("invoicePaid", { docType: "invoice", customer: 2, items: [{ description: "Reifenwechsel Sommer", quantityMilli: 1000, unitCents: 4900, kind: "labor" }], issuedAgo: 25, paid: computeTotals([{ quantityMilli: 1000, unitCents: 4900, taxBp: exempt ? 0 : 1900, discountBp: 0 }], { exempt }).grossCents });

  // Abschlag und Schlussrechnung (Entwurf mit Anrechnung)
  await make("partial", { docType: "partial", customer: 0, items: [{ description: "Abschlag Motorinstandsetzung", quantityMilli: 1000, unitCents: 50000, kind: "other" }], issuedAgo: 15 });
  await make("final", { docType: "final", customer: 0, items: [{ description: "Motorinstandsetzung komplett", quantityMilli: 1000, unitCents: 180000, kind: "other" }], issuedAgo: null, deduct: ["partial"] });

  // Storno: Rechnung und Stornorechnung (Gegenbeleg mit negativen Positionen)
  const original = await make("invoiceCancelled", { docType: "invoice", customer: 1, items: [filter, labor], issuedAgo: 20, cancelled: true });
  const source = await db.invoice.findUniqueOrThrow({ where: { id: original }, include: { items: true, snapshot: true } });
  const credit = await make("credit", {
    docType: "invoice",
    customer: 1,
    items: source.items.map((i) => ({ description: i.description, unit: i.unit, quantityMilli: 0 - i.quantityMilli, unitCents: i.unitCents, taxBp: i.taxBp, discountBp: i.discountBp, kind: i.kind })),
    issuedAgo: 18,
    cancelled: true,
    extra: { cancelsInvoiceId: original, notes: "Falscher Betrag" },
  });
  await db.invoice.update({ where: { id: credit }, data: { docType: "credit" } });
}

export const seeds: SeedDef[] = [{ id: "billing", feature: "office.billing", order: 125, demo }];
