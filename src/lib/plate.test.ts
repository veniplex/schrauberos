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
});
