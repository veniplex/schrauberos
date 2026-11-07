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
  test("normalizePlate: Umlaute Ä/Ö/Ü in Klein- und Großschreibung gleich, zusammengesetzt und zerlegt (Mac) gleich", () => {
    assert.equal(normalizePlate("mü-ab 12"), "MÜAB12");
    assert.equal(normalizePlate("MÜ AB 12"), "MÜAB12");
    assert.equal(normalizePlate("mü-ab 12"), normalizePlate("mu\u0308-ab 12"), "zerlegtes Ü (u + Trema) gleicht dem normalen Ü");
    assert.equal(normalizePlate("Ä-ÖÜ 1"), "ÄÖÜ1");
    assert.notEqual(normalizePlate("MÜ-AB 12"), normalizePlate("MUE-AB 12"), "Umlaute werden nicht zu AE/OE/UE aufgelöst");
  });
  test("normalizePlate: ß wird zu SS (Großschreibung), Sonderzeichen fallen weg", () => {
    assert.equal(normalizePlate("straße 1"), "STRASSE1");
    assert.equal(normalizePlate("ß"), "SS");
  });
  test("normalizePlate: österreichische und Schweizer Kennzeichen", () => {
    assert.equal(normalizePlate("W 12345 A"), "W12345A");
    assert.equal(normalizePlate("G-123 AB"), "G123AB");
    assert.equal(normalizePlate("s 123 ab"), "S123AB");
    assert.equal(normalizePlate("ZH 123 456"), "ZH123456");
    assert.equal(normalizePlate("BE·1234"), "BE1234");
    assert.equal(normalizePlate("GE-12 345"), normalizePlate("ge 12345"));
  });
});
