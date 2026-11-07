import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConstrained, linkPrefetch } from "./connection";

describe("Verbindung (P3-6)", () => {
  it("Datensparmodus und langsame Verbindungen sind eingeschränkt; schnelle, unbekannte und fehlende nicht", () => {
    assert.equal(isConstrained({ saveData: true }), true);
    for (const effectiveType of ["slow-2g", "2g", "3g"]) assert.equal(isConstrained({ effectiveType }), true, effectiveType);
    assert.equal(isConstrained({ effectiveType: "4g" }), false);
    assert.equal(isConstrained({ saveData: false, effectiveType: "4g" }), false);
    assert.equal(isConstrained({}), false);
    assert.equal(isConstrained(undefined), false, "Safari kennt die Schnittstelle nicht");
    assert.equal(isConstrained(null), false);
  });

  it("Vorladen: Standard, solange die Verbindung nicht eingeschränkt ist; sonst erst nach Hover/Fokus/Berührung; ein ausdrücklicher Wert des Aufrufers gilt immer", () => {
    assert.equal(linkPrefetch({ constrained: false, armed: false, explicit: undefined }), undefined);
    assert.equal(linkPrefetch({ constrained: true, armed: false, explicit: undefined }), false);
    assert.equal(linkPrefetch({ constrained: true, armed: true, explicit: undefined }), null);
    for (const explicit of [false, true, "auto", null] as const) {
      for (const constrained of [true, false]) assert.equal(linkPrefetch({ constrained, armed: false, explicit }), explicit);
    }
  });
});
