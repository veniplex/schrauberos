import { addDaysToKey, daysBetweenKeys, dayKey, startOfDay } from "@/lib/zone";
import { safeName } from "@/lib/filename";
import type { Prisma } from "@/generated/prisma/client";

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

/**
 * Die **Ausgangsliste**: Buchungsbelege (Rechnung, Abschlag, Schlussrechnung, Gegenbeleg) – ohne Angebote und Auftragsbestätigungen (keine Buchungsbelege) und ohne **Entwürfe** der Rechnungserstellung
 * (noch ohne Nummer, nicht festgeschrieben). Von Hand erfasste Rechnungen (`source = "manual"`) gehören immer dazu. Jede Liste, Summe, Suche, jeder Export und die API stützen sich auf diese Bedingung;
 * auch die Operationen, die einen Beleg per Kennung laden (Storno), laden über sie.
 */
export const ledgerWhere = {
  docType: { in: ["invoice", "partial", "final", "credit"] },
  NOT: { source: "billing", finalizedAt: null },
} as const satisfies Prisma.InvoiceWhereInput;

/** Belegarten, die sich per Gegenbeleg stornieren lassen: Rechnung, Abschlag, Schlussrechnung (der Gegenbeleg selbst nicht, Angebote und Auftragsbestätigungen nie). */
export const CANCELLABLE_DOC_TYPES = ["invoice", "partial", "final"] as const;

export type CancelBlock = "incoming" | "notInvoice" | "notFinalized" | "counterDocument" | "already" | "deducted";
/**
 * Warum sich der Beleg nicht per Gegenbeleg stornieren lässt (null = möglich): nur festgeschriebene Ausgangsrechnungen (Rechnung, Abschlag, Schlussrechnung), nur einmal, nie ein Gegenbeleg selbst – und kein Abschlag,
 * den eine festgeschriebene Schlussrechnung anrechnet (erst die Schlussrechnung stornieren).
 */
export function cancelBlock(inv: LockFields & { docType: string; hasCounterDocument: boolean; deductedInFinal?: boolean }): CancelBlock | null {
  if (inv.direction !== "outgoing") return "incoming";
  if (isCounterDocument(inv)) return "counterDocument";
  // Angebote und Auftragsbestätigungen sind keine Rechnungen: ein Gegenbeleg würde eine Rechnungsnummer verbrauchen und eine Stornorechnung ohne Rechnung in die Ausgangsliste stellen
  if (!(CANCELLABLE_DOC_TYPES as readonly string[]).includes(inv.docType)) return "notInvoice";
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

/* ───────────── Offene Posten: Altersstufen (Berichte, F9) ───────────── */

/** Altersstufen offener Posten nach Tagen **über** der Fälligkeit; „nicht fällig“ enthält auch Posten ohne Fälligkeit. */
export const AGE_BUCKETS = ["notDue", "d1_30", "d31_60", "d61_90", "d91plus"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** In welche Stufe fällt ein Posten mit dieser Fälligkeit (Kalendertag oder `null`) am Stichtag `today`? */
export function ageBucketOf(dueDay: string | null, today: string): AgeBucket {
  if (!dueDay) return "notDue";
  const overdue = daysBetweenKeys(dueDay, today);
  if (overdue <= 0) return "notDue";
  if (overdue <= 30) return "d1_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d91plus";
}

/**
 * Die Grenzen der Stufen als Kalendertage für die Datenbankabfrage: `gte`/`lt` auf dem **Tag der Fälligkeit** (ein Tag `d` gehört zur Stufe, wenn `gte ≤ d < lt`; `null` = nach oben/unten offen).
 * „nicht fällig“ ist `d ≥ today` (und kein Tag); die Stufen darunter ziehen 1–30, 31–60, 61–90 und mehr als 90 Tage ab.
 */
export function ageBucketRange(bucket: AgeBucket, today: string): { gte: string | null; lt: string | null } {
  switch (bucket) {
    case "notDue":
      return { gte: today, lt: null };
    case "d1_30":
      return { gte: addDaysToKey(today, -30), lt: today };
    case "d31_60":
      return { gte: addDaysToKey(today, -60), lt: addDaysToKey(today, -30) };
    case "d61_90":
      return { gte: addDaysToKey(today, -90), lt: addDaysToKey(today, -60) };
    case "d91plus":
      return { gte: null, lt: addDaysToKey(today, -90) };
  }
}
