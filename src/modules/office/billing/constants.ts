/**
 * Belegarten und Zustandswerte der Rechnungserstellung (F3). Die Werte sind API-Vertrag und stehen als Text in der Datenbank (keine Enums).
 *
 *  - `offer` Angebot und `confirmation` Auftragsbestätigung sind **keine Buchungsbelege**: Sie stehen nie in der Ausgangsliste und zählen in keiner Summe.
 *  - `invoice` Rechnung, `partial` Teil-/Abschlagsrechnung, `final` Schlussrechnung (rechnet bereits gestellte Abschläge ab) und `credit` Stornorechnung/Gutschrift sind Buchungsbelege der Ausgangsliste.
 */
export const DOC_TYPES = ["offer", "confirmation", "invoice", "partial", "final", "credit"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Buchungsbelege (Ausgangsliste, Summen, XRechnung). */
export const INVOICE_TYPES = ["invoice", "partial", "final", "credit"] as const satisfies readonly DocType[];
/** Belege ohne Buchungswirkung. */
export const QUOTE_TYPES = ["offer", "confirmation"] as const satisfies readonly DocType[];
/** Belegarten, die man neu anlegen kann (Gegenbelege entstehen nur durch das Stornieren). */
export const CREATABLE_TYPES = ["offer", "confirmation", "invoice", "partial", "final"] as const satisfies readonly DocType[];

export const isInvoiceType = (value: string): boolean => (INVOICE_TYPES as readonly string[]).includes(value);
export const isQuoteType = (value: string): boolean => (QUOTE_TYPES as readonly string[]).includes(value);

/** Angebotsstatus; „abgelaufen“ ergibt sich aus der Gültigkeit (`offerState`). */
export const OFFER_STATUSES = ["open", "accepted", "rejected"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const PAYMENT_METHODS = ["transfer", "cash", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ITEM_KINDS = ["labor", "part", "other"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Steuersätze in Basispunkten: 19 %, 7 %, 0 %. Bei Kleinunternehmern (§ 19 UStG) gibt es keine Steuer. */
export const ALLOWED_TAX_BP = [1900, 700, 0] as const;

/** Gültigkeit eines Angebots in Tagen (Vorbelegung). */
export const OFFER_VALIDITY_DAYS = 14;

/** Kleinbetragsrechnung (§ 33 UStDV): bis 250 € brutto – nur ein Hinweis, keine Sonderlogik. */
export const SMALL_AMOUNT_GROSS_CENTS = 25_000;

/** Obergrenze der Ablage im Dateispeicher für versendete Anhänge (relativer Ordner unter `files/`). */
export const SENT_FILES_DIR = "rechnungen/versand";

/**
 * Frist (Tage nach dem Versand), nach der der Aufräumlauf die Anhänge **versendeter Angebote und Auftragsbestätigungen** vom Datenträger löst (`billing.sentFiles`). Rechnungen haben keine Frist:
 * ihre Kopie „wie versendet“ bleibt, bis die Anonymisierung des Kunden sie freigibt (Aufbewahrungsfristen, Steuerberater).
 */
export const SENT_QUOTE_FILES_KEEP_DAYS = 30;
