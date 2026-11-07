import { dayKey, startOfDay } from "@/lib/zone";
import { safeName } from "@/lib/filename";

export const INVOICE_DIRECTIONS = ["incoming", "outgoing"] as const;
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number];

/** Belegarten der Ausgangsliste (Buchungsbelege): Rechnung, Abschlag, Schlussrechnung, Gegenbeleg (Stornorechnung/Gutschrift). */
export const DOC_TYPES_LEDGER = ["invoice", "partial", "final", "credit"] as const;

export const INVOICE_STATUSES = ["open", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Angezeigter Zahlungsstatus: "überfällig" wird aus Status und Fälligkeit berechnet; "teilweise bezahlt" (`partial`) gibt es für Belege der Rechnungserstellung mit Zahlungseingängen
 * (`paidCents` > 0, noch nicht vollständig bezahlt, noch nicht überfällig).
 */
export type PaymentState = "open" | "partial" | "overdue" | "paid" | "cancelled";

export function paymentState(inv: { status: string; dueDate: Date | null; paidCents?: number }, now = new Date()): PaymentState {
  if (inv.status === "paid") return "paid";
  if (inv.status === "cancelled") return "cancelled";
  if (inv.dueDate && startOfDay(inv.dueDate) < startOfDay(now)) return "overdue";
  return (inv.paidCents ?? 0) > 0 ? "partial" : "open";
}

export type InvoiceTotals = { openCents: number; overdueCents: number; paidCents: number; openCount: number; overdueCount: number };

/** Zu zahlen: Brutto abzüglich angerechneter Abschläge (Schlussrechnung) und bisheriger Zahlungen – nie negativ. */
export const outstandingCents = (inv: { grossCents: number; deductedCents?: number; paidCents?: number }): number => Math.max(0, inv.grossCents - (inv.deductedCents ?? 0) - (inv.paidCents ?? 0));

/** Summen über eine Rechnungsliste (Stornierte zählen nicht). Offen = noch zu zahlen (nach Abschlägen und Teilzahlungen). */
export function invoiceTotals(list: Array<{ status: string; dueDate: Date | null; grossCents: number; deductedCents?: number; paidCents?: number }>, now = new Date()): InvoiceTotals {
  const totals: InvoiceTotals = { openCents: 0, overdueCents: 0, paidCents: 0, openCount: 0, overdueCount: 0 };
  for (const inv of list) {
    const state = paymentState(inv, now);
    if (state === "paid") totals.paidCents += inv.grossCents - (inv.deductedCents ?? 0);
    else if (state === "open" || state === "partial") {
      totals.openCents += outstandingCents(inv);
      totals.openCount++;
    }
    else if (state === "overdue") {
      totals.openCents += outstandingCents(inv);
      totals.openCount++;
      totals.overdueCents += outstandingCents(inv);
      totals.overdueCount++;
    }
  }
  return totals;
}

/**
 * Festschreiben und Storno (P4b-3). Eine **festgeschriebene** Ausgangsrechnung ist unveränderlich (Inhalt, Beträge, Beleg) und nicht löschbar; nur der Zahlstatus bleibt änderbar.
 * Korrigiert wird per **Gegenbeleg** (Stornorechnung/Gutschrift: eigene Rechnung mit Bezug auf das Original, negative Beträge, eigene Nummer – die Nummer des Originals wird nie wiederverwendet).
 * Nicht festgeschriebene Ausgangsrechnungen und alle Eingangsrechnungen bleiben frei korrigier- und löschbar (mit Audit).
 */
type LockFields = { direction: string; finalizedAt: Date | null; cancelsInvoiceId: string | null; source?: string };

export const isFinalized = (inv: Pick<LockFields, "finalizedAt">): boolean => inv.finalizedAt !== null;
/** Ist die Rechnung selbst ein Gegenbeleg (Stornorechnung/Gutschrift)? */
export const isCounterDocument = (inv: Pick<LockFields, "cancelsInvoiceId">): boolean => inv.cancelsInvoiceId !== null;

export type FinalizeBlock = "incoming" | "already" | "cancelled" | "billing";
/** Warum sich die Rechnung nicht festschreiben lässt (null = möglich). Nur Ausgangsrechnungen; eine als storniert markierte Rechnung wird erst wieder geöffnet. Belege der Rechnungserstellung schreibt nur diese fest (Nummer, Schnappschuss). */
export function finalizeBlock(inv: LockFields & { status: string }): FinalizeBlock | null {
  if (inv.direction !== "outgoing") return "incoming";
  if (inv.source === "billing") return "billing";
  if (isFinalized(inv)) return "already";
  if (inv.status === "cancelled") return "cancelled";
  return null;
}

export type CancelBlock = "incoming" | "notFinalized" | "counterDocument" | "already" | "deducted";
/**
 * Warum sich die Rechnung nicht per Gegenbeleg stornieren lässt (null = möglich): nur festgeschriebene Ausgangsrechnungen, nur einmal, nie ein Gegenbeleg selbst – und kein Abschlag,
 * den eine festgeschriebene Schlussrechnung anrechnet (erst die Schlussrechnung stornieren).
 */
export function cancelBlock(inv: LockFields & { hasCounterDocument: boolean; deductedInFinal?: boolean }): CancelBlock | null {
  if (inv.direction !== "outgoing") return "incoming";
  if (isCounterDocument(inv)) return "counterDocument";
  if (!isFinalized(inv)) return "notFinalized";
  if (inv.hasCounterDocument) return "already";
  if (inv.deductedInFinal) return "deducted";
  return null;
}

/** Beträge des Gegenbelegs: alle Beträge mit umgekehrtem Vorzeichen (fehlende bleiben fehlend; 0 bleibt 0). */
export function counterAmounts(inv: { netCents: number | null; vatCents: number | null; grossCents: number }): { netCents: number | null; vatCents: number | null; grossCents: number } {
  const negate = (value: number | null) => (value === null ? null : 0 - value);
  return { netCents: negate(inv.netCents), vatCents: negate(inv.vatCents), grossCents: 0 - inv.grossCents };
}

/** Erlaubte Dateien am Rechnungsarchiv. */
export const INVOICE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "application/xml"] as const;
export const INVOICE_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Passen Netto + MwSt zum Brutto (Toleranz 1 Cent wegen Rundung)? */
export function amountsConsistent(netCents: number | null, vatCents: number | null, grossCents: number): boolean {
  if (netCents == null || vatCents == null) return true;
  return Math.abs(netCents + vatCents - grossCents) <= 1;
}

/** Dateiendung je erlaubtem Beleg-Typ. */
const FILE_EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/xml": "xml" };

/**
 * Ort eines Belegs im Dateispeicher – lesbar und auffindbar:
 * `rechnungen/<Jahr>/<eingang|ausgang>/<Rechnungsdatum>_<Geschäftspartner>_<Nummer>.<Endung>`.
 */
export function invoiceFileLocation(inv: { direction: string; issueDate: Date; number: string; partyName: string }, mime: string): { dir: string; name: string } {
  // Das Rechnungsdatum ist ein Kalendertag der Werkstatt-Zone (gespeichert um 12 Uhr), nicht der UTC-Tag des Zeitpunkts
  const day = dayKey(inv.issueDate);
  return {
    dir: `rechnungen/${day.slice(0, 4)}/${inv.direction === "incoming" ? "eingang" : "ausgang"}`,
    name: `${day}_${safeName(inv.partyName, 40)}_${safeName(inv.number, 40)}.${FILE_EXTENSIONS[mime] ?? "bin"}`,
  };
}

export { normalizeInvoiceNumber, outgoingKeyOf } from "@/lib/invoice-number";
