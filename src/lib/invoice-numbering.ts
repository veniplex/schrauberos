import { counterKey, DEFAULT_INVOICE_NUMBER_FORMAT, formatInvoiceNumber, parseInvoiceNumberFormat } from "./invoice-number-format";

/**
 * Nummernkreise der Belege (F3), rein: Aus Belegart, Muster des Werkstattprofils und Zeitpunkt ergibt sich die Zählerreihe (`Counter`) und das Format der Nummer. Die Vergabe selbst (der
 * Zähler in der Transaktion) steht in `src/server/invoice-numbering.ts`.
 *
 * Rechnungen aller Arten (Rechnung, Abschlag, Schluss, Gegenbeleg/Stornorechnung) teilen **eine** Reihe nach dem Muster des Werkstattprofils (`{YYYY}-{NNNN}` …); die Reihe beginnt neu, wenn sich
 * ein Zeitplatzhalter ändert. Angebote und Auftragsbestätigungen haben eigene Reihen (`AN-JJJJ-NNNN`, `AB-JJJJ-NNNN`), jährlich.
 */
export const COUNTER_INVOICES = "invoices";
export const COUNTER_OFFERS = "offers";
export const COUNTER_CONFIRMATIONS = "confirmations";
export const OFFER_NUMBER_FORMAT = "AN-{YYYY}-{NNNN}";
export const CONFIRMATION_NUMBER_FORMAT = "AB-{YYYY}-{NNNN}";

export type NumberSlot = {
  /** Schlüssel der Zählerreihe (`Counter.key`) */
  key: string;
  /** Zählerjahr: 0 = ohne Jahreswechsel, sonst Jahr (JJJJ) bzw. Monat (JJJJMM) – je nach Muster */
  year: number;
  /** Muster mit Platzhaltern (`lib/invoice-number-format.ts`) */
  format: string;
};

export function numberSlot(docType: string, workshopFormat: string | null | undefined, when: { year: number; month: number }): NumberSlot {
  if (docType === "offer") return { key: COUNTER_OFFERS, year: when.year, format: OFFER_NUMBER_FORMAT };
  if (docType === "confirmation") return { key: COUNTER_CONFIRMATIONS, year: when.year, format: CONFIRMATION_NUMBER_FORMAT };
  const parsed = parseInvoiceNumberFormat(workshopFormat ?? "");
  const format = parsed.ok ? (workshopFormat as string) : DEFAULT_INVOICE_NUMBER_FORMAT;
  const scope = parsed.ok ? parsed.scope : "year";
  const key = counterKey(scope, when);
  // "" → 0, "2026" → 2026, "2026-03" → 202603
  return { key: COUNTER_INVOICES, year: key === "" ? 0 : Number(key.replace("-", "")), format };
}

/** Die Nummer zum Zählerstand; das Muster ist beim Anlegen des Slots geprüft, ein Fehler hier wäre ein Programmfehler. */
export function renderNumber(slot: NumberSlot, when: { year: number; month: number }, value: number): string {
  const number = formatInvoiceNumber(slot.format, when, value);
  if (number === null) throw new Error(`Ungültiges Nummernmuster: ${slot.format}`);
  return number;
}
