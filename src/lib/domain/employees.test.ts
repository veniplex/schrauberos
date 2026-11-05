import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dueState } from "./due";
import { visibleAbsenceType, workdaysBetween, workdaysWithin } from "./employees";

const d = (s: string) => new Date(`${s}T12:00:00`);

describe("workdaysBetween", () => {
  test("Mo–Fr voll", () => assert.equal(workdaysBetween(d("2026-11-02"), d("2026-11-06")), 5));
  test("Wochenende zählt nicht", () => assert.equal(workdaysBetween(d("2026-11-06"), d("2026-11-09")), 2)); // Fr + Mo
  test("nur Wochenende = 0", () => assert.equal(workdaysBetween(d("2026-11-07"), d("2026-11-08")), 0));
  test("ein Tag", () => assert.equal(workdaysBetween(d("2026-11-04"), d("2026-11-04")), 1));
  test("Ende vor Beginn = 0", () => assert.equal(workdaysBetween(d("2026-11-05"), d("2026-11-04")), 0));
});

describe("workdaysWithin (Jahreswechsel)", () => {
  const year = { from: d("2026-01-01"), to: d("2026-12-31") };
  test("nur der Teil im Jahr zählt", () => {
    // 28.12.2026 (Mo) – 08.01.2027 (Fr): im Jahr 2026 = Mo–Do (4 Tage)
    assert.equal(workdaysWithin({ startDate: d("2026-12-28"), endDate: d("2027-01-08") }, year.from, year.to), 4);
  });
  test("komplett außerhalb = 0", () => {
    assert.equal(workdaysWithin({ startDate: d("2025-06-02"), endDate: d("2025-06-06") }, year.from, year.to), 0);
  });
});

describe("dueState", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  test("Zustände", () => {
    assert.equal(dueState(null, 60, now), null);
    assert.equal(dueState(new Date("2026-10-01"), 60, now), "expired");
    assert.equal(dueState(new Date("2026-12-20"), 60, now), "soon");
    assert.equal(dueState(new Date("2027-06-01"), 60, now), "ok");
  });
});

describe("visibleAbsenceType", () => {
  test("Krankheit wird ohne Recht maskiert", () => {
    assert.equal(visibleAbsenceType("sick", false), "masked");
    assert.equal(visibleAbsenceType("sick", true), "sick");
    assert.equal(visibleAbsenceType("vacation", false), "vacation");
    assert.equal(visibleAbsenceType("unbekannt", true), "other");
  });
});
