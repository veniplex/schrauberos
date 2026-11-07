/**
 * Nummernkreis der Rechnungen (P4b-7): Das **Muster** der Rechnungsnummer mit Platzhaltern. Rein, ohne Datenbank; Voraussetzung für die Rechnungserstellung (F3), die die Nummer erst beim
 * Festschreiben vergibt (Zähler in einer Transaktion, keine Lücken).
 *
 *   {YYYY} Jahr vierstellig · {YY} Jahr zweistellig · {MM} Monat zweistellig · {N} … {NNNNNNNN} fortlaufender Zähler, aufgefüllt auf so viele Stellen, wie N im Platzhalter stehen
 *
 * Genau ein Zähler ist Pflicht (sonst wäre die Nummer nicht eindeutig). Dazu Text aus Buchstaben, Ziffern und `- _ / . #`. Der Zähler beginnt neu, sobald sich ein Zeitplatzhalter ändert:
 * mit `{MM}` jeden Monat (dann ist ein Jahr Pflicht), mit `{YYYY}` bzw. `{YY}` jedes Jahr, ohne beides läuft er durch.
 */
export const DEFAULT_INVOICE_NUMBER_FORMAT = "{YYYY}-{NNNN}";
export const MAX_INVOICE_NUMBER_LENGTH = 40;

export type FormatToken = { type: "text"; value: string } | { type: "year"; digits: 2 | 4 } | { type: "month" } | { type: "counter"; digits: number };

/** Meldungsschlüssel der Fehler (unter `settings.errors.numberFormat.*`). */
export type NumberFormatError = "empty" | "unknown" | "noCounter" | "manyCounters" | "monthWithoutYear" | "characters" | "tooLong" | "brace";

export type ParsedNumberFormat = { ok: true; tokens: FormatToken[]; scope: CounterScope } | { ok: false; error: NumberFormatError };

/** Wann der Zähler von vorn beginnt. */
export type CounterScope = "never" | "year" | "month";

const TEXT = /^[A-Za-z0-9\-_/.# ]+$/;

export function parseInvoiceNumberFormat(format: string): ParsedNumberFormat {
  if (!format.trim()) return { ok: false, error: "empty" };
  const tokens: FormatToken[] = [];
  let rest = format;
  while (rest.length > 0) {
    if (rest[0] === "{") {
      const end = rest.indexOf("}");
      if (end < 0) return { ok: false, error: "brace" };
      const name = rest.slice(1, end);
      if (name === "YYYY") tokens.push({ type: "year", digits: 4 });
      else if (name === "YY") tokens.push({ type: "year", digits: 2 });
      else if (name === "MM") tokens.push({ type: "month" });
      else if (/^N{1,8}$/.test(name)) tokens.push({ type: "counter", digits: name.length });
      else return { ok: false, error: "unknown" };
      rest = rest.slice(end + 1);
    } else {
      const next = rest.indexOf("{");
      const text = next < 0 ? rest : rest.slice(0, next);
      if (text.includes("}")) return { ok: false, error: "brace" };
      if (!TEXT.test(text)) return { ok: false, error: "characters" };
      tokens.push({ type: "text", value: text });
      rest = next < 0 ? "" : rest.slice(next);
    }
  }
  const counters = tokens.filter((t) => t.type === "counter").length;
  if (counters === 0) return { ok: false, error: "noCounter" };
  if (counters > 1) return { ok: false, error: "manyCounters" };
  const hasYear = tokens.some((t) => t.type === "year");
  const hasMonth = tokens.some((t) => t.type === "month");
  if (hasMonth && !hasYear) return { ok: false, error: "monthWithoutYear" };
  // Längste mögliche Nummer: Jahr 4, Monat 2, Zähler mit seinen Stellen (er darf wachsen, die Grenze rechnet mit zwei Stellen mehr)
  const longest = tokens.reduce((n, t) => n + (t.type === "text" ? t.value.length : t.type === "year" ? t.digits : t.type === "month" ? 2 : t.digits + 2), 0);
  if (longest > MAX_INVOICE_NUMBER_LENGTH) return { ok: false, error: "tooLong" };
  return { ok: true, tokens, scope: hasMonth ? "month" : hasYear ? "year" : "never" };
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Die Rechnungsnummer zu Muster, Zeitpunkt (Jahr, Monat 1–12 in der Zone der Werkstatt) und Zählerstand; null bei ungültigem Muster. */
export function formatInvoiceNumber(format: string, when: { year: number; month: number }, counter: number): string | null {
  const parsed = parseInvoiceNumberFormat(format);
  if (!parsed.ok || !Number.isInteger(counter) || counter < 1) return null;
  return parsed.tokens
    .map((t) => {
      if (t.type === "text") return t.value;
      if (t.type === "year") return t.digits === 4 ? pad(when.year, 4) : pad(when.year % 100, 2);
      if (t.type === "month") return pad(when.month, 2);
      return pad(counter, t.digits);
    })
    .join("");
}

/** Schlüssel des Zählers für einen Zeitpunkt: gleicher Schlüssel = gleiche Zählreihe (`""`, `2026` oder `2026-03`). */
export function counterKey(scope: CounterScope, when: { year: number; month: number }): string {
  return scope === "never" ? "" : scope === "year" ? String(when.year) : `${when.year}-${pad(when.month, 2)}`;
}

/** Drei Beispielnummern für die Vorschau: die erste, die zweite und eine aus dem Zählerbereich weiter hinten. */
export function previewInvoiceNumbers(format: string, when: { year: number; month: number }): string[] {
  return [1, 2, 123].map((n) => formatInvoiceNumber(format, when, n)).filter((n): n is string => n !== null);
}
