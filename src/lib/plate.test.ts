import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatPlate, normalizePlate } from "./plate";

describe("Kennzeichen", () => {
  test("normalizePlate entfernt Trenner und vereinheitlicht", () => {
    assert.equal(normalizePlate("b-ab 1234"), "BAB1234");
    assert.equal(normalizePlate(" HVL-JK 77 "), "HVLJK77");
  });
  test("formatPlate", () => {
    assert.equal(formatPlate("  b-ab   1234 "), "B-AB 1234");
  });
  test("normalizePlate: Umlaute bleiben, Sonderzeichen und Leerraum fallen weg, leere Eingabe bleibt leer", () => {
    assert.equal(normalizePlate("b-äö 12"), "BÄÖ12");
    assert.equal(normalizePlate("  - . "), "");
    assert.equal(normalizePlate(""), "");
    assert.equal(normalizePlate("HVL·JK/77"), "HVLJK77");
  });
  test("normalizePlate ist idempotent und gleicht Schreibweisen an (Duplikaterkennung)", () => {
    for (const plate of ["B-AB 1234", "b ab1234", "B–AB·1234"]) assert.equal(normalizePlate(plate), "BAB1234");
    assert.equal(normalizePlate(normalizePlate("b-ab 1234")), "BAB1234");
  });
  test("formatPlate: behält Trenner, kürzt Leerraum, ändert nichts an einer sauberen Eingabe", () => {
    assert.equal(formatPlate("B-AB 1234"), "B-AB 1234");
    assert.equal(formatPlate("\tb ab\t1"), "B AB 1");
    assert.equal(formatPlate(""), "");
  });
});
