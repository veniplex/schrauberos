import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amountsReducer, grossSuggestion, type Amounts } from "./amounts";

const empty: Amounts = { net: "", vat: "", gross: "", grossTouched: false };
const run = (start: Amounts, ...changes: Array<["net" | "vat" | "gross", string]>) => changes.reduce((state, [field, value]) => amountsReducer(state, { field, value }), start);

describe("Rechnungsbeträge", () => {
  it("Brutto-Vorschlag aus Netto + MwSt. (deutsches Eingabeformat), leer wenn nicht berechenbar", () => {
    assert.equal(grossSuggestion("100,00", "19,00"), "119,00");
    assert.equal(grossSuggestion("100", ""), "100,00");
    assert.equal(grossSuggestion("", "19"), "");
    assert.equal(grossSuggestion("abc", "19"), "");
  });

  it("Brutto folgt Netto und MwSt., solange es nicht selbst eingegeben wurde", () => {
    const state = run(empty, ["net", "100,00"], ["vat", "19,00"]);
    assert.deepEqual(state, { net: "100,00", vat: "19,00", gross: "119,00", grossTouched: false });
  });

  it("eine eigene Brutto-Eingabe schaltet den Vorschlag ab; ein geleertes Feld schaltet ihn wieder an", () => {
    const manual = run(empty, ["net", "100,00"], ["gross", "150,00"], ["vat", "19,00"]);
    assert.equal(manual.gross, "150,00");
    assert.equal(manual.grossTouched, true);
    const cleared = run(manual, ["gross", ""], ["vat", "7,00"]);
    assert.equal(cleared.gross, "107,00");
  });

  it("jede Änderung rechnet aus dem aktuellen Stand: mehrere Felder nacheinander ohne Zwischenstand (Wiederherstellung eines Entwurfs) ergeben alle drei Werte", () => {
    // der Entwurf schreibt Netto, MwSt. und Brutto direkt hintereinander – jeder Schritt sieht das Ergebnis des vorigen
    const restored = run(empty, ["net", "100,00"], ["vat", "19,00"], ["gross", "119,00"]);
    assert.deepEqual([restored.net, restored.vat, restored.gross], ["100,00", "19,00", "119,00"]);
  });
});
