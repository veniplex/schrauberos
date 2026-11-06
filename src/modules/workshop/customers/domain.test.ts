import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { customerDisplayName } from "./domain";

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
  test("ohne Kunde", () => {
    assert.equal(customerDisplayName(null), "–");
  });
});
