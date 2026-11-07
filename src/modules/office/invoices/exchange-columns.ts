import type { ColumnDef } from "@/server/csv/columns";

/**
 * Spalten des Rechnungsarchivs (Export und Import). Die Schlüssel sind die Felder des Rechnungsformulars; Geld steht als Dezimalzahl in Euro (`1234,56`), Datum als `JJJJ-MM-TT`.
 * `customerNumber` (Kunde einer Ausgangsrechnung) gibt es nur mit dem Recht, Kunden zu sehen. Belege (Dateien) sind nie Teil des Austauschs.
 */
export const INVOICE_COLUMNS: readonly ColumnDef[] = [
  { key: "direction", labelKey: "invoices.exchange.cols.direction", aliases: ["Art", "Richtung", "Belegart", "Direction", "Type"], required: true },
  { key: "number", labelKey: "invoices.exchange.cols.number", aliases: ["Rechnungsnr", "Rechnungs-Nr", "Beleg-Nr", "Nummer", "Invoice number", "Number"], required: true },
  { key: "partyName", labelKey: "invoices.exchange.cols.partyName", aliases: ["Lieferant", "Rechnungsempfänger", "Empfänger", "Geschäftspartner", "Partner", "Supplier", "Recipient"], required: true },
  { key: "issueDate", labelKey: "invoices.exchange.cols.issueDate", aliases: ["Datum", "Rechnungsdatum", "Issue date", "Date"], required: true },
  { key: "dueDate", labelKey: "invoices.exchange.cols.dueDate", aliases: ["Fällig", "Fälligkeit", "Due date"] },
  { key: "net", labelKey: "invoices.exchange.cols.net", aliases: ["Netto", "Nettobetrag", "Net"] },
  { key: "vat", labelKey: "invoices.exchange.cols.vat", aliases: ["MwSt", "USt", "Umsatzsteuer", "Mehrwertsteuer", "VAT"] },
  { key: "gross", labelKey: "invoices.exchange.cols.gross", aliases: ["Brutto", "Bruttobetrag", "Betrag", "Gross", "Amount"], required: true },
  { key: "status", labelKey: "invoices.exchange.cols.status", aliases: ["Zahlstatus", "Status"] },
  { key: "paidAt", labelKey: "invoices.exchange.cols.paidAt", aliases: ["Bezahlt", "Zahldatum", "Paid on"] },
  { key: "category", labelKey: "invoices.exchange.cols.category", aliases: ["Kategorie", "Category"] },
  { key: "reference", labelKey: "invoices.exchange.cols.reference", aliases: ["Referenz", "Ablageort", "Reference"] },
  { key: "notes", labelKey: "invoices.exchange.cols.notes", aliases: ["Bemerkung", "Bemerkungen", "Notes"], multiline: true },
  { key: "customerNumber", labelKey: "invoices.exchange.cols.customerNumber", aliases: ["Kundennummer", "Kundennr", "Kd-Nr", "Customer number", "Customer no"] },
];

/** Nur im Export, nie im Import: Festschreibung und Storno entstehen ausschließlich durch die Operationen (`invoices.finalize`, `invoices.cancel`). Beim Einlesen einer Exportdatei werden sie als unbekannte Spalten ignoriert. */
export const EXPORT_ONLY_COLUMNS: readonly ColumnDef[] = [
  { key: "finalizedAt", labelKey: "invoices.exchange.cols.finalizedAt" },
  { key: "cancelsNumber", labelKey: "invoices.exchange.cols.cancelsNumber" },
];

/** Spalten des Steuerberater-Exports (nur Export). */
export const ACCOUNTANT_COLUMNS = [
  { labelKey: "invoices.exchange.accountant.cols.direction" },
  { labelKey: "invoices.exchange.accountant.cols.number" },
  { labelKey: "invoices.exchange.accountant.cols.issueDate" },
  { labelKey: "invoices.exchange.accountant.cols.partyName" },
  { labelKey: "invoices.exchange.accountant.cols.net" },
  { labelKey: "invoices.exchange.accountant.cols.vat" },
  { labelKey: "invoices.exchange.accountant.cols.gross" },
  { labelKey: "invoices.exchange.accountant.cols.paymentState" },
  { labelKey: "invoices.exchange.accountant.cols.paidAt" },
  { labelKey: "invoices.exchange.accountant.cols.finalizedAt" },
  { labelKey: "invoices.exchange.accountant.cols.cancelsNumber" },
] as const;
