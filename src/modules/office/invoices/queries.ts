import "server-only";
import { startOfDay } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { InvoiceTotals } from "./domain";

/**
 * Summen über alle Rechnungen, die `where` trifft – von der Datenbank gerechnet (`aggregate`), nicht über eine geladene Seite: Die Kacheln über der Liste
 * stimmen so unabhängig von Seite, Sortierung und Seitengröße. Gleiche Regeln wie `paymentState`: stornierte zählen nicht, offen mit Fälligkeit vor heute = überfällig.
 */
export async function invoiceSums(where: Prisma.InvoiceWhereInput = {}, now = new Date()): Promise<InvoiceTotals> {
  const today = startOfDay(now);
  const sum = (extra: Prisma.InvoiceWhereInput) => db.invoice.aggregate({ where: { AND: [where, extra] }, _sum: { grossCents: true }, _count: { _all: true } });
  const [open, overdue, paid] = await Promise.all([
    sum({ status: "open", OR: [{ dueDate: null }, { dueDate: { gte: today } }] }),
    sum({ status: "open", dueDate: { lt: today } }),
    sum({ status: "paid" }),
  ]);
  const cents = (r: { _sum: { grossCents: number | null } }) => r._sum.grossCents ?? 0;
  return {
    openCents: cents(open) + cents(overdue),
    openCount: open._count._all + overdue._count._all,
    overdueCents: cents(overdue),
    overdueCount: overdue._count._all,
    paidCents: cents(paid),
  };
}

/** Die Jahre, für die es Rechnungen gibt (von der Datenbank: kleinstes und größtes Datum), absteigend; das laufende Jahr ist immer dabei. */
export async function invoiceYears(currentYear: number): Promise<number[]> {
  const { _min, _max } = await db.invoice.aggregate({ _min: { issueDate: true }, _max: { issueDate: true } });
  const first = Math.min(_min.issueDate?.getFullYear() ?? currentYear, currentYear);
  const last = Math.max(_max.issueDate?.getFullYear() ?? currentYear, currentYear);
  return Array.from({ length: last - first + 1 }, (_, i) => last - i);
}
