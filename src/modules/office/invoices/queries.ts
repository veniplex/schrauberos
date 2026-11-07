import "server-only";
import { addMonths as addMonthsTo } from "@/lib/month";
import { addDaysToKey as addDaysTo, daysBetweenKeys, dayKey, startOfDay, wallOf } from "@/lib/zone";
import type { Viewer } from "@/modules/types";
import { unrestrictedCustomerWhere } from "@/modules/workshop/customers/public";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { contains, keyContains } from "@/server/search";
import { AGE_BUCKETS, ageBucketOf, ageBucketRange, ledgerWhere, outstandingCents, type AgeBucket, type InvoiceTotals } from "./domain";

/**
 * Suchbedingungen für Rechnungen (Liste, Schnellsuche, API): der Geschäftspartner über die normalisierte Spalte `partyKey` (Umlaute, Groß-/Kleinschreibung, Trenner), Nummer, Referenz
 * und Kategorie als Teilstring. Jedes Element ist eine ODER-Alternative; `category: false` lässt die Kategorie weg (Schnellsuche).
 */
export function invoiceTextWhere(term: string, options: { category?: boolean } = { category: true }): Prisma.InvoiceWhereInput[] {
  return [{ number: contains(term) }, keyContains("partyKey", term), { reference: contains(term) }, ...(options.category === false ? [] : [{ category: contains(term) }])];
}

export { ledgerWhere };

/**
 * Summen über alle Rechnungen, die `where` trifft – von der Datenbank gerechnet (`aggregate`), nicht über eine geladene Seite: Die Kacheln über der Liste
 * stimmen so unabhängig von Seite, Sortierung und Seitengröße. Gleiche Regeln wie `paymentState`: stornierte zählen nicht, offen mit Fälligkeit vor heute = überfällig.
 */
export async function invoiceSums(where: Prisma.InvoiceWhereInput = {}, now = new Date()): Promise<InvoiceTotals> {
  const today = startOfDay(now);
  const sum = (extra: Prisma.InvoiceWhereInput) => db.invoice.aggregate({ where: { AND: [ledgerWhere, where, extra] }, _sum: { grossCents: true, deductedCents: true, paidCents: true }, _count: { _all: true } });
  const [open, overdue, paid] = await Promise.all([
    sum({ status: "open", OR: [{ dueDate: null }, { dueDate: { gte: today } }] }),
    sum({ status: "open", dueDate: { lt: today } }),
    sum({ status: "paid" }),
  ]);
  // offen = noch zu zahlen (nach angerechneten Abschlägen und Teilzahlungen); bezahlt = Brutto nach Abschlägen
  type Sum = { _sum: { grossCents: number | null; deductedCents: number | null; paidCents: number | null } };
  const outstanding = (r: Sum) => Math.max(0, (r._sum.grossCents ?? 0) - (r._sum.deductedCents ?? 0) - (r._sum.paidCents ?? 0));
  const settled = (r: Sum) => (r._sum.grossCents ?? 0) - (r._sum.deductedCents ?? 0);
  return {
    openCents: outstanding(open) + outstanding(overdue),
    openCount: open._count._all + overdue._count._all,
    overdueCents: outstanding(overdue),
    overdueCount: overdue._count._all,
    paidCents: settled(paid),
  };
}

/** Die Jahre, für die es Rechnungen gibt (von der Datenbank: kleinstes und größtes Datum), absteigend; das laufende Jahr ist immer dabei. */
export async function invoiceYears(currentYear: number): Promise<number[]> {
  const { _min, _max } = await db.invoice.aggregate({ where: ledgerWhere, _min: { issueDate: true }, _max: { issueDate: true } });
  const first = Math.min((_min.issueDate ? wallOf(_min.issueDate).year : currentYear), currentYear);
  const last = Math.max((_max.issueDate ? wallOf(_max.issueDate).year : currentYear), currentYear);
  return Array.from({ length: last - first + 1 }, (_, i) => last - i);
}

/* ───────────── Berichte (F9): Umsatz je Monat, offene Posten, Zahlungsziele ───────────── */

/**
 * Nicht storniert **ohne Gegenbeleg**: Eine von Hand als „storniert“ markierte Ausgangsrechnung ohne Gegenbeleg war nie gültig und zählt nicht. Ein **Gegenbeleg** (`cancelsInvoiceId`) und das stornierte Original
 * (`cancelledBy`) zählen dagegen beide: Der Gegenbeleg hat negative Beträge und hebt das Original auf, im Monat des Gegenbelegs (Soll nach Rechnungsdatum).
 */
const COUNTS_AS_REVENUE = { NOT: { status: "cancelled", cancelsInvoiceId: null, cancelledBy: { is: null } } } as const satisfies Prisma.InvoiceWhereInput;

const INCOMPLETE_BLOCK = 2_000;
type IncompleteRow = { issueDate: Date; netCents: number | null; vatCents: number | null; grossCents: number; deductedCents: number; deductedNetCents: number; deductedVatCents: number };

/** Die Belege des Zeitraums ohne Netto oder ohne Steuer, blockweise nach Kennung gelesen. */
async function incompleteRows(base: Prisma.InvoiceWhereInput): Promise<IncompleteRow[]> {
  const out: IncompleteRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const block = await db.invoice.findMany({
      where: { AND: [base, { OR: [{ netCents: null }, { vatCents: null }] }] },
      orderBy: { id: "asc" },
      take: INCOMPLETE_BLOCK,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, issueDate: true, netCents: true, vatCents: true, grossCents: true, deductedCents: true, deductedNetCents: true, deductedVatCents: true },
    });
    for (const row of block) out.push(row);
    if (block.length < INCOMPLETE_BLOCK) return out;
    cursor = block[block.length - 1].id;
  }
}

export type RevenueMonth = {
  month: string;
  count: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
  /** Belege **ohne** Netto- und ohne Steuerangabe (von Hand erfasste Rechnungen): sie zählen nur im Brutto, Netto + Steuer ergibt in diesem Monat weniger als das Brutto */
  incomplete: number;
  /** Belege mit nur einer der beiden Angaben: die fehlende wird als Brutto − Angabe abgeleitet (Brutto = Netto + Steuer) */
  derived: number;
};

/**
 * **Umsatz je Monat** (Ausgangsrechnungen nach Rechnungsdatum, Monate der Werkstatt-Zone) – Rechnung, Abschlag, Schlussrechnung und **Gegenbeleg als negative Beträge**. Gerechnet wird in der Datenbank
 * (`aggregate` je Monat), und zwar **nur über die Ausgangsliste** (`ledgerWhere`): **Angebote, Auftragsbestätigungen und Entwürfe sind nie Umsatz**.
 *
 * Alle drei Beträge eines Monats stammen **aus den Spalten der Belege dieses Monats** – nie aus anderen Tabellen oder dem späteren Zustand: Eine Schlussrechnung zählt Brutto, Netto und Steuer abzüglich des
 * Anteils der angerechneten Abschläge (`deductedCents`/`deductedNetCents`/`deductedVatCents`, beim Festschreiben am Beleg festgeschrieben; die Abschläge zählen in ihrem eigenen Monat – sonst stünde dieselbe Leistung
 * doppelt im Bericht). Der Gegenbeleg trägt dieselben Spalten negiert und ist damit das exakte Negativ des Originals im Monat des Gegenbelegs; ein abgeschlossener Monat ändert sich nie rückwirkend, und je Monat gilt
 * Netto + Steuer = Brutto (außer bei Belegen ganz ohne Netto-/Steuerangabe, s. `incomplete`). Verlangt `invoices.view`. `months`: `JJJJ-MM`, aufsteigend.
 *
 * Von Hand erfasste Rechnungen können Netto oder Steuer auslassen: Fehlt eines, wird es aus dem Brutto abgeleitet (`derived`); fehlen beide, zählt der Beleg nur im Brutto (`incomplete`).
 */
export async function revenueByMonth(viewer: Viewer, months: readonly string[]): Promise<RevenueMonth[] | null> {
  if (!viewer.can("invoices.view")) return null;
  if (months.length === 0) return [];
  const rangeOf = (from: string, to: string) => ({ issueDate: { gte: startOfDay(`${from}-01`), lt: startOfDay(`${addMonthsTo(to, 1)}-01`) } });
  const baseOf = (range: Prisma.InvoiceWhereInput): Prisma.InvoiceWhereInput => ({ AND: [ledgerWhere, COUNTS_AS_REVENUE, { direction: "outgoing" }, range] });
  const SUMS = { netCents: true, vatCents: true, grossCents: true, deductedCents: true, deductedNetCents: true, deductedVatCents: true } as const;

  const [complete, partial] = await Promise.all([
    // vollständige Belege (Netto und Steuer vorhanden): ein Aggregat je Monat
    Promise.all(
      months.map((month) =>
        db.invoice.aggregate({ where: { AND: [baseOf(rangeOf(month, month)), { netCents: { not: null } }, { vatCents: { not: null } }] }, _sum: SUMS, _count: { _all: true } }),
      ),
    ),
    // unvollständige Belege (selten, von Hand erfasst): über den ganzen Zeitraum, in Blöcken von je 2 000 Zeilen (der Speicher bleibt begrenzt, auch bei sehr vielen Handbelegen); die Monate ordnet die Werkstatt-Zone zu
    incompleteRows(baseOf(rangeOf(months[0], months[months.length - 1]))),
  ]);

  const rows = months.map((month, index): RevenueMonth => {
    const sum = complete[index]._sum;
    const row: RevenueMonth = {
      month,
      count: complete[index]._count._all,
      netCents: (sum.netCents ?? 0) - (sum.deductedNetCents ?? 0),
      vatCents: (sum.vatCents ?? 0) - (sum.deductedVatCents ?? 0),
      grossCents: (sum.grossCents ?? 0) - (sum.deductedCents ?? 0),
      incomplete: 0,
      derived: 0,
    };
    return row;
  });
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  for (const doc of partial) {
    const row = byMonth.get(dayKey(doc.issueDate).slice(0, 7));
    if (!row) continue;
    row.count += 1;
    row.grossCents += doc.grossCents - doc.deductedCents;
    if (doc.netCents === null && doc.vatCents === null) {
      row.incomplete += 1;
    } else {
      // nur eine Angabe vorhanden: die andere ist Brutto − Angabe (Brutto = Netto + Steuer)
      const net = doc.netCents ?? doc.grossCents - (doc.vatCents ?? 0);
      const vat = doc.vatCents ?? doc.grossCents - (doc.netCents ?? 0);
      row.netCents += net - doc.deductedNetCents;
      row.vatCents += vat - doc.deductedVatCents;
      row.derived += 1;
    }
  }
  return rows;
}

/**
 * Offene Posten: Ausgangs- oder Eingangsrechnungen mit Status „offen“ (Rechnung, Abschlag, Schlussrechnung – kein Gegenbeleg), nur Ausgangsliste, **mit positivem Betrag**. Ein von Hand erfasster Beleg mit
 * **negativem** Brutto (z. B. eine Lieferanten-Gutschrift als Eingangsrechnung) ist kein Posten, der zu zahlen ist: Er steht weder in den Summen noch in der Liste, sondern wird getrennt genannt (`creditsWhere`,
 * `OpenItemsData.credits`) – so ist die Summe immer die Summe der Liste und nichts wird still verrechnet. (Ein bezahlter Betrag über dem Brutto ist bei offenen Belegen nicht möglich: `billing.addPayment`
 * lehnt mehr als den Rest ab, der Rest macht den Beleg „bezahlt“; Test in `reports.test.ts`.)
 */
const openWhere = (direction: "outgoing" | "incoming"): Prisma.InvoiceWhereInput => ({ AND: [ledgerWhere, { direction, status: "open", docType: { in: ["invoice", "partial", "final"] }, grossCents: { gt: 0 } }] });
const creditsWhere = (direction: "outgoing" | "incoming"): Prisma.InvoiceWhereInput => ({ AND: [ledgerWhere, { direction, status: "open", docType: { in: ["invoice", "partial", "final"] }, grossCents: { lt: 0 } }] });
const UNRESTRICTED_PARTY: Prisma.InvoiceWhereInput = { OR: [{ customerId: null }, { customer: { is: unrestrictedCustomerWhere } }] };
const RESTRICTED_PARTY: Prisma.InvoiceWhereInput = { customerId: { not: null }, customer: { is: { processingRestrictedAt: { not: null } } } };

const OPEN_SUMS = { grossCents: true, deductedCents: true, paidCents: true } as const;
type OpenSums = { grossCents: number | null; deductedCents: number | null; paidCents: number | null };
const toOutstanding = (sum: OpenSums) => outstandingCents({ grossCents: sum.grossCents ?? 0, deductedCents: sum.deductedCents ?? 0, paidCents: sum.paidCents ?? 0 });

export type OpenItem = { id: string; number: string; partyName: string; /** Kalendertag der Fälligkeit */ dueDay: string | null; outstandingCents: number; daysOverdue: number; bucket: AgeBucket };
export type OpenItemsData = {
  direction: "outgoing" | "incoming";
  buckets: Array<{ bucket: AgeBucket; count: number; cents: number }>;
  total: { count: number; cents: number };
  /** die ältesten offenen Posten (ohne Kunden mit eingeschränkter Verarbeitung) */
  items: OpenItem[];
  /** offene Posten, die nicht aufgeführt sind, weil der Kunde eingeschränkt verarbeitet wird (Art. 18 DSGVO) – sie zählen in den Summen */
  hiddenCount: number;
  /** offene Belege mit **negativem** Betrag (von Hand erfasste Gutschriften): nicht in den Summen und nicht in der Liste, hier getrennt (Summe negativ) */
  credits: { count: number; cents: number };
};

/**
 * **Offene Posten** nach Alter (Tage über der Fälligkeit am Stichtag `today`): Summen je Stufe von der Datenbank gerechnet (`aggregate`), dazu die ältesten `limit` Posten. Kunden mit **eingeschränkter
 * Verarbeitung** (Art. 18) stehen nie in der Liste, ihre Beträge aber in den Summen (die Zahl der nicht aufgeführten steht dabei). Verlangt `invoices.view`.
 */
export async function openItems(viewer: Viewer, options: { direction: "outgoing" | "incoming"; today: string; limit: number }): Promise<OpenItemsData | null> {
  if (!viewer.can("invoices.view")) return null;
  const { direction, today, limit } = options;
  const open = openWhere(direction);
  const dueWhere = (bucket: AgeBucket): Prisma.InvoiceWhereInput => {
    const range = ageBucketRange(bucket, today);
    const due: Prisma.DateTimeNullableFilter = { ...(range.gte ? { gte: startOfDay(range.gte) } : {}), ...(range.lt ? { lt: startOfDay(range.lt) } : {}) };
    return bucket === "notDue" ? { OR: [{ dueDate: null }, { dueDate: due }] } : { dueDate: due };
  };
  const [buckets, rows, hiddenCount, credits] = await Promise.all([
    Promise.all(AGE_BUCKETS.map(async (bucket) => {
      const sum = await db.invoice.aggregate({ where: { AND: [open, dueWhere(bucket)] }, _sum: OPEN_SUMS, _count: { _all: true } });
      return { bucket, count: sum._count._all, cents: toOutstanding(sum._sum) };
    })),
    // die Ältesten zuerst; Posten ohne Fälligkeit (nicht fällig) ans Ende
    db.invoice.findMany({
      where: { AND: [open, UNRESTRICTED_PARTY] },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { issueDate: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, number: true, partyName: true, dueDate: true, grossCents: true, deductedCents: true, paidCents: true },
    }),
    db.invoice.count({ where: { AND: [open, RESTRICTED_PARTY] } }),
    db.invoice.aggregate({ where: creditsWhere(direction), _sum: OPEN_SUMS, _count: { _all: true } }),
  ]);
  const items = rows.map((r): OpenItem => {
    const dueDay = r.dueDate ? dayKey(r.dueDate) : null;
    return { id: r.id, number: r.number, partyName: r.partyName, dueDay, outstandingCents: outstandingCents(r), daysOverdue: dueDay ? Math.max(0, daysBetweenKeys(dueDay, today)) : 0, bucket: ageBucketOf(dueDay, today) };
  });
  return { direction, buckets, total: { count: buckets.reduce((n, b) => n + b.count, 0), cents: buckets.reduce((n, b) => n + b.cents, 0) }, items, hiddenCount, credits: { count: credits._count._all, cents: (credits._sum.grossCents ?? 0) - (credits._sum.deductedCents ?? 0) - (credits._sum.paidCents ?? 0) } };
}

export type PaymentsDue = { direction: "outgoing" | "incoming"; count: number; cents: number; items: Array<{ id: string; number: string; partyName: string; dueDay: string; outstandingCents: number }>; hiddenCount: number };

/**
 * **Zahlungsziele** der nächsten `days` Tage (Fälligkeit von heute bis heute + `days`, noch nicht überfällig): was in den nächsten Wochen eingeht bzw. zu bezahlen ist. Summen von der Datenbank, die ersten
 * `limit` Posten ohne Kunden mit eingeschränkter Verarbeitung (Art. 18). Verlangt `invoices.view`.
 */
export async function paymentsDue(viewer: Viewer, options: { direction: "outgoing" | "incoming"; today: string; days: number; limit: number }): Promise<PaymentsDue | null> {
  if (!viewer.can("invoices.view")) return null;
  const { direction, today, days, limit } = options;
  // Fälligkeit von heute bis einschließlich dem Tag heute + days (Kalendertage der Werkstatt-Zone)
  const where: Prisma.InvoiceWhereInput = { AND: [openWhere(direction), { dueDate: { gte: startOfDay(today), lt: startOfDay(addDaysTo(today, days + 1)) } }] };
  const [sum, rows, hiddenCount] = await Promise.all([
    db.invoice.aggregate({ where, _sum: OPEN_SUMS, _count: { _all: true } }),
    db.invoice.findMany({ where: { AND: [where, UNRESTRICTED_PARTY] }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: limit, select: { id: true, number: true, partyName: true, dueDate: true, grossCents: true, deductedCents: true, paidCents: true } }),
    db.invoice.count({ where: { AND: [where, RESTRICTED_PARTY] } }),
  ]);
  return {
    direction,
    count: sum._count._all,
    cents: toOutstanding(sum._sum),
    items: rows.map((r) => ({ id: r.id, number: r.number, partyName: r.partyName, dueDay: dayKey(r.dueDate!), outstandingCents: outstandingCents(r) })),
    hiddenCount,
  };
}
