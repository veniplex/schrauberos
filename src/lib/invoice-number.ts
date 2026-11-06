/**
 * Normalisierte Rechnungsnummer: Grundlage der Eindeutigkeit von Ausgangsrechnungen (`Invoice.outgoingKey`, Unique im Schema).
 * Groß-/Kleinschreibung und Leerraum machen eine Nummer nicht zu einer anderen („re 2026-1“ = „RE  2026-1“).
 */
export function normalizeInvoiceNumber(number: string): string {
  return number.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleUpperCase("de");
}

/** Schlüssel für die Datenbank: nur Ausgangsrechnungen sind eindeutig, bei Eingangsrechnungen NULL. */
export function outgoingKeyOf(direction: string, number: string): string | null {
  return direction === "outgoing" ? normalizeInvoiceNumber(number) : null;
}
