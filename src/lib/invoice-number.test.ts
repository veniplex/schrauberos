import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInvoiceNumber, outgoingKeyOf } from "./invoice-number";

describe("Rechnungsnummer", () => {
  it("normalisiert Schreibweise und Leerraum", () => {
    assert.equal(normalizeInvoiceNumber(" re  2026-0187 "), "RE 2026-0187");
    assert.equal(normalizeInvoiceNumber("ｒｅ-1"), "RE-1");
  });
  it("hat nur für Ausgangsrechnungen einen Schlüssel", () => {
    assert.equal(outgoingKeyOf("outgoing", "2026-1 a"), "2026-1 A");
    assert.equal(outgoingKeyOf("incoming", "2026-1"), null);
  });
});
