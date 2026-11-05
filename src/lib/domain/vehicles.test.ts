import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { customerDisplayName, formatPlate, normalizePlate } from "./vehicles";

describe("Kennzeichen", () => {
  test("normalizePlate entfernt Trenner und vereinheitlicht", () => {
    assert.equal(normalizePlate("b-ab 1234"), "BAB1234");
    assert.equal(normalizePlate(" HVL-JK 77 "), "HVLJK77");
  });
  test("formatPlate", () => {
    assert.equal(formatPlate("  b-ab   1234 "), "B-AB 1234");
  });
});

describe("customerDisplayName", () => {
  test("Privatkunde", () => {
    assert.equal(customerDisplayName({ firstName: "Anna", lastName: "Becker" }), "Anna Becker");
  });
  test("Firma mit Ansprechpartner", () => {
    assert.equal(customerDisplayName({ firstName: "Max", lastName: "Muster", company: "ACME" }), "ACME (Max Muster)");
  });
  test("reiner Firmenkunde (Nachname = Firma) wird nicht doppelt angezeigt", () => {
    assert.equal(customerDisplayName({ lastName: "Autohaus Nord GmbH", company: "Autohaus Nord GmbH" }), "Autohaus Nord GmbH");
  });
});
