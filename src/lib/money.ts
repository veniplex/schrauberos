// Geldbeträge werden überall als ganze Cent (Int) gespeichert – keine Rundungsfehler, portabel SQLite/Postgres.

/**
 * Eingabe wie "1.234,56", "1234,5", "12.50", "1 234,56 €" oder "-20" -> Cent. null bei ungültiger Eingabe.
 * Ein einzelner Punkt mit genau drei Nachkommastellen ("1.234") gilt als Tausendertrenner.
 */
export function parseMoneyToCents(input: string): number | null {
  let s = input.replace(/[\s€]|EUR/gi, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // das letzte Trennzeichen ist das Dezimalzeichen
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

/** Cent -> "1.234,56 €" (Locale-abhängig). */
export function formatCents(cents: number, intlLocale = "de-DE"): string {
  return new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Cent -> "1234,56" für Eingabefelder. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
