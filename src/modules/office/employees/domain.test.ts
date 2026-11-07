import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dueState } from "@/lib/due";
import { NO_HOLIDAYS, createHolidayCalendar } from "@/lib/holidays";
import { visibleAbsenceType, workdaysBetween, workdaysBetweenKeys, workdaysWithin, workdaysWithinKeys } from "./domain";

const d = (s: string) => new Date(`${s}T12:00:00`);

describe("workdaysBetween", () => {
  test("Mo–Fr voll", () => assert.equal(workdaysBetween(d("2026-11-02"), d("2026-11-06")), 5));
  test("Wochenende zählt nicht", () => assert.equal(workdaysBetween(d("2026-11-06"), d("2026-11-09")), 2)); // Fr + Mo
  test("nur Wochenende = 0", () => assert.equal(workdaysBetween(d("2026-11-07"), d("2026-11-08")), 0));
  test("ein Tag", () => assert.equal(workdaysBetween(d("2026-11-04"), d("2026-11-04")), 1));
  test("Ende vor Beginn = 0", () => assert.equal(workdaysBetween(d("2026-11-05"), d("2026-11-04")), 0));
});

describe("Arbeitstage mit Feiertagen (P4b-0)", () => {
  const nrw = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW" });

  test("ein Feiertag auf einem Wochentag zählt nicht (Weihnachtswoche 2026: Mo–Mi, 25. und 26. fallen auf Fr/Sa)", () => {
    assert.equal(workdaysBetweenKeys("2026-12-21", "2026-12-25"), 5);
    assert.equal(workdaysBetweenKeys("2026-12-21", "2026-12-25", nrw), 4);
  });

  test("Feiertage am Wochenende ändern nichts; ohne Region verhält es sich wie bisher", () => {
    assert.equal(workdaysBetweenKeys("2026-12-26", "2026-12-27", nrw), 0);
    assert.equal(workdaysBetweenKeys("2026-12-21", "2026-12-25", createHolidayCalendar(NO_HOLIDAYS)), 5);
  });

  test("ein halber Feiertag zählt als halber Arbeitstag; ein gestrichener Tag wieder voll", () => {
    const half = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW", rules: { "DE.christmasDay": "half" } });
    assert.equal(workdaysBetweenKeys("2026-12-21", "2026-12-25", half), 4.5);
    const off = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW", rules: { "DE.christmasDay": "off" } });
    assert.equal(workdaysBetweenKeys("2026-12-21", "2026-12-25", off), 5);
  });

  test("eigene Tage (Betriebsferien) zählen ebenfalls, über Zeitpunkte und das Jahr gerechnet", () => {
    const custom = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW", custom: [{ id: "1", name: "Brückentag", month: 5, day: 15, year: 2026, half: false }] });
    // 14. Mai 2026 = Christi Himmelfahrt (Do), 15. Mai Brückentag (Fr)
    assert.equal(workdaysBetween(d("2026-05-11"), d("2026-05-15"), custom), 3);
    assert.equal(workdaysWithinKeys({ startDate: d("2026-05-11"), endDate: d("2026-05-15") }, "2026-01-01", "2026-12-31", custom), 3);
  });
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
