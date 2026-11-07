import { centsToInput, parseMoneyToCents } from "@/lib/money";

/** Brutto-Vorschlag aus Netto + MwSt. (Text im Eingabeformat, „“ wenn nicht berechenbar) */
export function grossSuggestion(net: string, vat: string): string {
  const n = parseMoneyToCents(net);
  const v = vat.trim() === "" ? 0 : parseMoneyToCents(vat);
  return n === null || v === null ? "" : centsToInput(n + v);
}

export type Amounts = { net: string; vat: string; gross: string; grossTouched: boolean };
export type AmountChange = { field: "net" | "vat" | "gross"; value: string };

/**
 * Beträge: Brutto folgt Netto + MwSt., solange es nicht selbst eingegeben wurde. Ein Reducer statt mehrerer Zustände mit Kopien: Jede Änderung rechnet aus dem **aktuellen** Stand
 * (die Wiederherstellung eines Entwurfs schreibt mehrere Felder nacheinander; ein Rückruf mit einer Kopie des Zustands aus dem Rendern würde die anderen Felder überschreiben).
 * Eine eigene Eingabe im Brutto-Feld (nicht leer) schaltet den Vorschlag ab, ein geleertes Feld wieder an.
 */
export function amountsReducer(state: Amounts, { field, value }: AmountChange): Amounts {
  if (field === "gross") {
    return { ...state, gross: value, grossTouched: value !== "" };
  }
  const next = { ...state, [field]: value };
  const suggestion = grossSuggestion(next.net, next.vat);
  return !state.grossTouched && suggestion ? { ...next, gross: suggestion } : next;
}
