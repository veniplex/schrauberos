import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysUntil, endorsementWarning } from "./expiry";

const now = Date.parse("2026-11-07T12:00:00Z");

describe("Warnung vor ablaufender Beglaubigung", () => {
  it("zählt volle Tage bis zum Ende des Gültigkeitstages", () => {
    assert.equal(daysUntil("2026-11-07", now), 0);
    assert.equal(daysUntil("2026-11-08", now), 1);
    assert.equal(daysUntil("2026-11-06", now), -1);
  });

  it("warnt ab 90 Tagen vor dem Ablauf und danach; bei fernem Ablauf oder ohne Beglaubigung nicht", () => {
    assert.equal(endorsementWarning(undefined, now), null);
    assert.equal(endorsementWarning("2099-12-31", now), null);
    assert.equal(endorsementWarning("2027-02-05", now), null, "90 Tage: noch keine Warnung");
    assert.equal(endorsementWarning("2027-02-04", now), 89, "unter 90 Tagen: Warnung");
    assert.equal(endorsementWarning("2026-01-01", now)! < 0, true, "abgelaufen: negative Tage");
  });
});
