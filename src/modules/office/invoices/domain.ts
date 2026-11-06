import { startOfDay } from "date-fns";
import { safeName } from "@/lib/filename";

export const INVOICE_DIRECTIONS = ["incoming", "outgoing"] as const;
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number];

export const INVOICE_STATUSES = ["open", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Angezeigter Zahlungsstatus: "überfällig" wird aus Status und Fälligkeit berechnet. */
export type PaymentState = "open" | "overdue" | "paid" | "cancelled";

export function paymentState(inv: { status: string; dueDate: Date | null }, now = new Date()): PaymentState {
  if (inv.status === "paid") return "paid";
  if (inv.status === "cancelled") return "cancelled";
  return inv.dueDate && startOfDay(inv.dueDate) < startOfDay(now) ? "overdue" : "open";
}

export type InvoiceTotals = { openCents: number; overdueCents: number; paidCents: number; openCount: number; overdueCount: number };

/** Summen über eine Rechnungsliste (Stornierte zählen nicht). */
export function invoiceTotals(list: Array<{ status: string; dueDate: Date | null; grossCents: number }>, now = new Date()): InvoiceTotals {
  const totals: InvoiceTotals = { openCents: 0, overdueCents: 0, paidCents: 0, openCount: 0, overdueCount: 0 };
  for (const inv of list) {
    const state = paymentState(inv, now);
    if (state === "paid") totals.paidCents += inv.grossCents;
    else if (state === "open") {
      totals.openCents += inv.grossCents;
      totals.openCount++;
    }
    else if (state === "overdue") {
      totals.openCents += inv.grossCents;
      totals.openCount++;
      totals.overdueCents += inv.grossCents;
      totals.overdueCount++;
    }
  }
  return totals;
}

/** Erlaubte Dateien am Rechnungsarchiv. */
export const INVOICE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const INVOICE_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Passen Netto + MwSt zum Brutto (Toleranz 1 Cent wegen Rundung)? */
export function amountsConsistent(netCents: number | null, vatCents: number | null, grossCents: number): boolean {
  if (netCents == null || vatCents == null) return true;
  return Math.abs(netCents + vatCents - grossCents) <= 1;
}

/** Dateiendung je erlaubtem Beleg-Typ. */
const FILE_EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Ort eines Belegs im Dateispeicher – lesbar und auffindbar:
 * `rechnungen/<Jahr>/<eingang|ausgang>/<Rechnungsdatum>_<Geschäftspartner>_<Nummer>.<Endung>`.
 */
export function invoiceFileLocation(inv: { direction: string; issueDate: Date; number: string; partyName: string }, mime: string): { dir: string; name: string } {
  const day = inv.issueDate.toISOString().slice(0, 10);
  return {
    dir: `rechnungen/${day.slice(0, 4)}/${inv.direction === "incoming" ? "eingang" : "ausgang"}`,
    name: `${day}_${safeName(inv.partyName, 40)}_${safeName(inv.number, 40)}.${FILE_EXTENSIONS[mime] ?? "bin"}`,
  };
}
