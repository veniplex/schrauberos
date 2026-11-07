import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filenameFromDisposition } from "./download";
import { presetPeriod } from "./period";

describe("Zeitraum-Voreinstellungen", () => {
  it("laufendes und vergangenes Jahr", () => {
    assert.deepEqual(presetPeriod("thisYear", "2026-11-07"), { from: "2026-01-01", to: "2026-12-31" });
    assert.deepEqual(presetPeriod("lastYear", "2026-11-07"), { from: "2025-01-01", to: "2025-12-31" });
  });

  it("letztes Quartal, auch über den Jahreswechsel", () => {
    assert.deepEqual(presetPeriod("lastQuarter", "2026-11-07"), { from: "2026-07-01", to: "2026-09-30" });
    assert.deepEqual(presetPeriod("lastQuarter", "2026-07-01"), { from: "2026-04-01", to: "2026-06-30" });
    assert.deepEqual(presetPeriod("lastQuarter", "2026-02-15"), { from: "2025-10-01", to: "2025-12-31" });
    assert.deepEqual(presetPeriod("lastQuarter", "2026-03-31"), { from: "2025-10-01", to: "2025-12-31" });
  });

  it("letzter Monat, mit Schaltjahr und Jahreswechsel", () => {
    assert.deepEqual(presetPeriod("lastMonth", "2026-11-07"), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(presetPeriod("lastMonth", "2024-03-01"), { from: "2024-02-01", to: "2024-02-29" });
    assert.deepEqual(presetPeriod("lastMonth", "2026-03-01"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(presetPeriod("lastMonth", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("Dateiname aus Content-Disposition", () => {
  it("UTF-8-Form gewinnt, einfache Form, Rückfall, Sonderzeichen werden ersetzt", () => {
    assert.equal(filenameFromDisposition(`attachment; filename="kunden.csv"; filename*=UTF-8''k%C3%BCnden.csv`), "künden.csv");
    assert.equal(filenameFromDisposition(`attachment; filename="kunden-2026-11-07.csv"`), "kunden-2026-11-07.csv");
    assert.equal(filenameFromDisposition("attachment; filename=plain.csv"), "plain.csv");
    assert.equal(filenameFromDisposition(null, "x.csv"), "x.csv");
    assert.equal(filenameFromDisposition("attachment", "x.csv"), "x.csv");
    assert.equal(filenameFromDisposition(`attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd`), ".._.._etc_passwd");
    assert.equal(filenameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A`), "export.csv", "kaputte Kodierung → Rückfall auf die einfache Form bzw. den Standard");
  });
});
