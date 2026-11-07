import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { startOfDay } from "@/lib/zone";
import { db } from "@/server/db";
import { contains, keyContains } from "@/server/search";
import { getWorkshop } from "@/server/workshop";
import { INVOICE_TYPES, QUOTE_TYPES } from "./constants";
import { viewOf, type DocView, type ViewRow } from "./view";

/**
 * Lesezugriffe der Rechnungserstellung (README, „Datenzugriff“): Abfragen mit ausdrücklichem `select`/`include`, Betrachter nur dort, wo Daten vom Recht abhängen. Kunden erscheinen nur als Name
 * auf dem Beleg (der Empfänger ist Teil des Beleges); die Kundenseite selbst öffnet nur, wer `customers.view` hat.
 */

/** Alles, was das Ansichtsmodell (`viewOf`) braucht. */
export const viewInclude = {
  items: { orderBy: { position: "asc" } },
  snapshot: true,
  deductions: { include: { partial: { select: { number: true, issueDate: true, grossCents: true } } } },
  cancels: { select: { number: true, issueDate: true } },
  order: { select: { number: true } },
  sourceDoc: { select: { number: true } },
  customer: { select: { customerNumber: true } },
} as const satisfies Prisma.InvoiceInclude;

/** Das Ansichtsmodell eines Beleges der Rechnungserstellung (PDF, XRechnung, Detailseite); `null`, wenn es ihn nicht gibt oder er nicht aus der Rechnungserstellung stammt. */
export async function loadDocView(id: string): Promise<{ view: DocView; row: ViewRow } | null> {
  const [row, workshop] = await Promise.all([db.invoice.findFirst({ where: { id, source: "billing" }, include: viewInclude }), getWorkshop()]);
  return row ? { view: viewOf(row as ViewRow, workshop), row: row as ViewRow } : null;
}

/** Suchbedingung: Nummer, Empfänger (normalisiert), Fahrzeug, Referenz. */
export function billingTextWhere(term: string): Prisma.InvoiceWhereInput[] {
  return [{ number: contains(term) }, keyContains("partyKey", term), { vehicleLabel: contains(term) }, { buyerReference: contains(term) }];
}

export const BILLING_STATUS_FILTERS = ["all", "draft", "issued", "open", "unpaid", "paid", "accepted", "rejected"] as const;
export type BillingStatusFilter = (typeof BILLING_STATUS_FILTERS)[number];
export const BILLING_TYPE_FILTERS = ["all", "offer", "confirmation", "invoice", "partial", "final", "credit"] as const;
export type BillingTypeFilter = (typeof BILLING_TYPE_FILTERS)[number];

export const parseTypeFilter = (value: string | undefined): BillingTypeFilter => ((BILLING_TYPE_FILTERS as readonly string[]).includes(value ?? "") ? (value as BillingTypeFilter) : "all");
export const parseStatusFilter = (value: string | undefined): BillingStatusFilter => ((BILLING_STATUS_FILTERS as readonly string[]).includes(value ?? "") ? (value as BillingStatusFilter) : "all");

export type BillingListFilters = { q: string; type: BillingTypeFilter; status: BillingStatusFilter; customerId?: string; orderId?: string };

/** Bedingung der Belegliste: nur Belege der Rechnungserstellung (auch Entwürfe und Angebote). */
export function billingListWhere(filters: BillingListFilters): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [{ source: "billing" }];
  if (filters.q) and.push({ OR: billingTextWhere(filters.q) });
  if (filters.type !== "all") and.push({ docType: filters.type });
  if (filters.customerId) and.push({ customerId: filters.customerId });
  if (filters.orderId) and.push({ orderId: filters.orderId });
  switch (filters.status) {
    case "draft":
      and.push({ finalizedAt: null });
      break;
    case "issued":
      and.push({ finalizedAt: { not: null } });
      break;
    case "open":
      and.push({ finalizedAt: { not: null }, OR: [{ docType: { in: [...INVOICE_TYPES] }, status: "open" }, { docType: "offer", offerStatus: "open" }] });
      break;
    case "unpaid":
      // offene Rechnungen (noch zu zahlen), ohne Angebote – die Zahl des Dashboards
      and.push({ finalizedAt: { not: null }, docType: { in: ["invoice", "partial", "final"] }, status: "open" });
      break;
    case "paid":
      and.push({ docType: { in: [...INVOICE_TYPES] }, status: "paid" });
      break;
    case "accepted":
    case "rejected":
      and.push({ docType: "offer", offerStatus: filters.status });
      break;
  }
  return { AND: and };
}

export const BILLING_ISSUED_QUOTES = [...QUOTE_TYPES];

/** Abschläge, die eine Schlussrechnung anrechnen kann: festgeschriebene Abschlagsrechnungen des Kunden, nicht storniert, noch in keiner festgeschriebenen Schlussrechnung angerechnet. */
export async function deductionCandidates(customerId: string | null): Promise<Array<{ id: string; number: string; issueDate: Date; grossCents: number; orderNumber: string | null }>> {
  if (!customerId) return [];
  const rows = await db.invoice.findMany({
    where: { source: "billing", docType: "partial", customerId, finalizedAt: { not: null }, status: { not: "cancelled" }, cancelledBy: null, deductedIn: { none: { finalKey: { not: null } } } },
    orderBy: { issueDate: "asc" },
    select: { id: true, number: true, issueDate: true, grossCents: true, order: { select: { number: true } } },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, issueDate: r.issueDate, grossCents: r.grossCents, orderNumber: r.order?.number ?? null }));
}

/** Belege zu einem Auftrag (Abschnitt auf der Auftragsseite). */
export async function documentsOfOrder(orderId: string) {
  return db.invoice.findMany({
    where: { source: "billing", orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, docType: true, number: true, finalizedAt: true, status: true, grossCents: true },
  });
}

/** Kennzahlen für die Listenseite und das Dashboard: Entwürfe, offene (nicht abgelaufene) Angebote, offene Rechnungen (noch zu zahlen) und davon überfällige. */
export async function billingStats(now = new Date()) {
  const today = startOfDay(now);
  const invoiceBase: Prisma.InvoiceWhereInput = { source: "billing", docType: { in: ["invoice", "partial", "final"] }, finalizedAt: { not: null }, status: "open" };
  const outstanding = async (extra: Prisma.InvoiceWhereInput) => {
    const r = await db.invoice.aggregate({ where: { AND: [invoiceBase, extra] }, _sum: { grossCents: true, deductedCents: true, paidCents: true }, _count: { _all: true } });
    return { cents: Math.max(0, (r._sum.grossCents ?? 0) - (r._sum.deductedCents ?? 0) - (r._sum.paidCents ?? 0)), count: r._count._all };
  };
  const [drafts, openOffers, open, overdue] = await Promise.all([
    db.invoice.count({ where: { source: "billing", finalizedAt: null } }),
    db.invoice.count({ where: { source: "billing", docType: "offer", finalizedAt: { not: null }, offerStatus: "open", OR: [{ validUntil: null }, { validUntil: { gte: today } }] } }),
    outstanding({}),
    outstanding({ dueDate: { lt: today } }),
  ]);
  return { drafts, openOffers, outstandingCents: open.cents, outstandingCount: open.count, overdueCents: overdue.cents, overdueCount: overdue.count };
}

/**
 * Alles, was die Detailseite eines Beleges braucht, über das Ansichtsmodell hinaus: Zahlungen, Folgebelege, der Gegenbeleg, der Auftrag und – ob der Kunde noch bearbeitet werden darf (Art. 18, anonymisiert) –
 * seine aktuelle E-Mail-Adresse für den Versand. Die Adresse wird hier nur gelesen, damit die Seite „Per E-Mail senden“ anbieten kann (der Versand liest sie selbst noch einmal).
 */
export async function documentDetail(id: string) {
  const loaded = await loadDocView(id);
  if (!loaded) return null;
  const { view, row } = loaded;
  const [payments, derived, counter, customer] = await Promise.all([
    db.invoicePayment.findMany({ where: { invoiceId: id }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] }),
    db.invoice.findMany({ where: { sourceDocId: id }, select: { id: true, docType: true, number: true, finalizedAt: true }, orderBy: { createdAt: "asc" } }),
    db.invoice.findFirst({ where: { cancelsInvoiceId: id }, select: { id: true, number: true } }),
    row.customerId ? db.customer.findUnique({ where: { id: row.customerId }, select: { email: true, processingRestrictedAt: true, anonymizedAt: true } }) : null,
  ]);
  const restricted = Boolean(customer?.processingRestrictedAt || customer?.anonymizedAt);
  const sendTo = restricted ? null : ((customer?.email?.trim() || view.recipient.email) ?? null);
  const original = row.cancelsInvoiceId ? await db.invoice.findUnique({ where: { id: row.cancelsInvoiceId }, select: { id: true } }) : null;
  // Ein Abschlag, den eine festgeschriebene Schlussrechnung anrechnet, lässt sich nicht stornieren (erst die Schlussrechnung)
  const deductedInFinal = (await db.invoiceDeduction.count({ where: { partialId: id, finalKey: { not: null } } })) > 0;
  // Entwurf einer Schlussrechnung: wie viele der gewählten Abschläge sich nicht mehr anrechnen lassen (storniert, anderswo angerechnet) – die Prüfliste nennt es, statt dass erst das Festschreiben scheitert
  let invalidDeductions = 0;
  if (view.draft && view.docType === "final") {
    const chosen = row.deductions.map((d) => d.partialId);
    const valid = chosen.length === 0 ? 0 : await db.invoice.count({ where: { id: { in: chosen }, source: "billing", docType: "partial", customerId: row.customerId, finalizedAt: { not: null }, status: { not: "cancelled" }, cancelledBy: null, deductedIn: { none: { finalKey: { not: null }, finalId: { not: id } } } } });
    invalidDeductions = chosen.length - valid;
  }
  return { view, row, payments, derived, counter, restricted, sendTo, originalId: original?.id ?? null, deductedInFinal, invalidDeductions };
}
