import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { presetRange, rangeDays, rangeState, RANGE_PRESETS } from "./date-range";

describe("Zeitraum-Voreinstellungen", () => {
  it("heute, gestern, letzte 7/30 Tage (beide Enden eingeschlossen)", () => {
    assert.deepEqual(presetRange("today", "2026-11-07"), { from: "2026-11-07", to: "2026-11-07" });
    assert.deepEqual(presetRange("yesterday", "2026-11-01"), { from: "2026-10-31", to: "2026-10-31" });
    assert.deepEqual(presetRange("last7", "2026-11-07"), { from: "2026-11-01", to: "2026-11-07" });
    assert.deepEqual(presetRange("last30", "2026-11-07"), { from: "2026-10-09", to: "2026-11-07" });
    assert.equal(rangeDays(presetRange("last7", "2026-11-07").from, "2026-11-07"), 7);
    assert.equal(rangeDays(presetRange("last30", "2026-11-07").from, "2026-11-07"), 30);
  });

  it("dieser und letzter Monat, auch über Jahres- und Schaltjahresgrenzen", () => {
    assert.deepEqual(presetRange("thisMonth", "2026-11-07"), { from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(presetRange("thisMonth", "2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
    assert.deepEqual(presetRange("thisMonth", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(presetRange("thisMonth", "2027-02-10"), { from: "2027-02-01", to: "2027-02-28" });
    assert.deepEqual(presetRange("lastMonth", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
    assert.deepEqual(presetRange("lastMonth", "2026-03-01"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(presetRange("thisYear", "2026-11-07"), { from: "2026-01-01", to: "2026-12-31" });
  });

  it("jede Voreinstellung ergibt einen gültigen Zeitraum", () => {
    for (const preset of RANGE_PRESETS) {
      const range = presetRange(preset, "2026-11-07");
      assert.equal(rangeState(range.from, range.to), "ok", preset);
    }
  });
});

describe("Zeitraum prüfen", () => {
  it("leer, unvollständig, ungültig, vertauscht, zu lang, gültig", () => {
    assert.equal(rangeState("", ""), "empty");
    assert.equal(rangeState("2026-11-01", ""), "incomplete");
    assert.equal(rangeState("", "2026-11-01"), "incomplete");
    assert.equal(rangeState("2026-02-30", "2026-03-01"), "invalid");
    assert.equal(rangeState("abc", ""), "invalid");
    assert.equal(rangeState("2026-11-07", "2026-11-01"), "reversed");
    assert.equal(rangeState("2026-01-01", "2026-12-31", { maxDays: 92 }), "tooLong");
    assert.equal(rangeState("2026-11-01", "2026-11-01"), "ok");
    assert.equal(rangeDays("2026-11-07", "2026-11-01"), 0);
  });
});
