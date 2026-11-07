/**
 * Öffentliche Schnittstelle der Funktion office.invoices. Andere Funktionen (die Rechnungserstellung, F3) importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 *
 *  - `ledgerWhere`: die Ausgangsliste (Buchungsbelege ohne Angebote und Entwürfe) als Bedingung für Abfragen,
 *  - `paymentState`/`outstandingCents`/`PaymentBadge`: Zahlstatus und offener Betrag eines Beleges, wie die Liste ihn zeigt,
 *  - `cancelInvoiceOperation`/`cancelInvoice`: Storno per Gegenbeleg – **die einzige Stornologik** und **die einzige Server Action dafür** (die Rechnungserstellung nutzt beide für ihre Belege; der Nummernkreis vergibt dann die Nummer),
 *  - `isFinalized`/`cancelBlock`/`outgoingKeyOf`/`normalizeInvoiceNumber`: Regeln der Festschreibung und der Eindeutigkeit der Ausgangsnummern.
 */
export { AGE_BUCKETS, ageBucketOf, ageBucketRange, cancelBlock, isCounterDocument, isFinalized, normalizeInvoiceNumber, outgoingKeyOf, outstandingCents, paymentState, type AgeBucket, type PaymentState } from "./domain";
export { ledgerWhere, openItems, paymentsDue, revenueByMonth, type OpenItem, type OpenItemsData, type PaymentsDue, type RevenueMonth } from "./queries";
export { cancelInvoice } from "./actions";
export { cancelInvoiceOperation } from "./operations";
export { PaymentBadge } from "./ui";
