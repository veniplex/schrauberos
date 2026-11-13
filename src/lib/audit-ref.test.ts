import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { personRef } from "./audit-ref";

describe("personRef: Audit-Einträge nennen Personen nie mit Namen", () => {
  it("Kunden mit Kundennummer, sonst mit dem Ende der Kennung", () => {
    assert.equal(personRef("Kunde", { id: "ckabcdefgh12345678", number: " K-17 " }), "Kunde K-17");
    assert.equal(personRef("Kunde", { id: "ckabcdefgh12345678", number: null }), "Kunde 12345678");
  });

  it("Mitarbeiter immer nur mit dem Ende der Kennung – die Personalnummer ist Freitext und gehört nicht ins Audit-Log", () => {
    assert.equal(personRef("Mitarbeiter", { id: "ckabcdefgh12345678", number: "Erika Muster" }), "Mitarbeiter 12345678");
    assert.equal(personRef("Mitarbeiter", { id: "ckabcdefgh12345678" }), "Mitarbeiter 12345678");
  });
});
