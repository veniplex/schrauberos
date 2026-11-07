import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HSN_PATTERN, TSN_PATTERN, addMonths, extraInspectionState, inspectionState, isInspectionAttention, isMonth, monthOf, monthsBetween, normalizeKey, parseMileage } from "./domain";

describe("Prüffrist (Monat)", () => {
  it("gültige Monate: JJJJ-MM mit 01–12 und vernünftigem Jahr", () => {
    for (const m of ["2026-01", "2026-12", "1999-06"]) assert.equal(isMonth(m), true, m);
    for (const m of ["2026-00", "2026-13", "26-05", "2026-5", "2026-05-01", "", "abcd-ef", "1800-01", "2200-01"]) assert.equal(isMonth(m), false, m);
  });

  it("Monat einer Zeit in Ortszeit, Monate addieren über den Jahreswechsel, Abstand in Monaten", () => {
    assert.equal(monthOf(new Date(2026, 0, 31, 23, 59)), "2026-01");
    assert.equal(monthOf(new Date(2026, 11, 1)), "2026-12");
    assert.equal(addMonths("2026-11", 3), "2027-02");
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-12", 24), "2028-12");
    assert.equal(monthsBetween("2026-11", "2027-02"), 3);
    assert.equal(monthsBetween("2026-11", "2026-09"), -2);
    assert.throws(() => addMonths("kaputt", 1));
  });

  it("Stand: überfällig, laufender Monat, bald (die nächsten zwei Monate), in Ordnung, keine Frist", () => {
    const now = "2026-11";
    assert.equal(inspectionState("2026-10", now), "overdue");
    assert.equal(inspectionState("2025-01", now), "overdue");
    assert.equal(inspectionState("2026-11", now), "thisMonth");
    assert.equal(inspectionState("2026-12", now), "soon");
    assert.equal(inspectionState("2027-01", now), "soon");
    assert.equal(inspectionState("2027-02", now), "ok");
    assert.equal(inspectionState(null, now), null);
    assert.equal(inspectionState("", now), null);
    assert.equal(inspectionState("kaputt", now), null);
  });

  it("„bald fällig“ umfasst überfällig, laufenden Monat und das Fenster; nicht in Ordnung und nicht ohne Frist", () => {
    assert.equal(isInspectionAttention("2026-09", "2026-11"), true);
    assert.equal(isInspectionAttention("2026-11", "2026-11"), true);
    assert.equal(isInspectionAttention("2027-01", "2026-11"), true);
    assert.equal(isInspectionAttention("2027-02", "2026-11"), false);
    assert.equal(isInspectionAttention(null, "2026-11"), false);
    assert.equal(isInspectionAttention("2027-03", "2026-11", 4), true, "größeres Fenster");
  });

  it("die weitere Prüfung wird nach dem Monat ihres Datums bewertet", () => {
    assert.equal(extraInspectionState(new Date(2026, 10, 30), "2026-11"), "thisMonth");
    assert.equal(extraInspectionState(new Date(2026, 8, 1), "2026-11"), "overdue");
    assert.equal(extraInspectionState(null, "2026-11"), null);
  });
});

describe("Kilometerstand und Schlüsselnummern", () => {
  it("Kilometerstand: ganze Zahlen, Tausenderpunkte und Leerzeichen erlaubt, sonst ungültig", () => {
    assert.equal(parseMileage("123456"), 123456);
    assert.equal(parseMileage("123.456"), 123456);
    assert.equal(parseMileage("123 456"), 123456);
    assert.equal(parseMileage("0"), 0);
    for (const bad of ["", "abc", "-5", "12,5", "12345678", "1e5"]) assert.equal(parseMileage(bad), null, bad);
  });

  it("HSN vierstellig, TSN dreistellig (Großbuchstaben/Ziffern), Eingabe wird vereinheitlicht", () => {
    assert.equal(HSN_PATTERN.test(normalizeKey("0603")), true);
    assert.equal(HSN_PATTERN.test(normalizeKey(" 06 03 ")), true);
    assert.equal(TSN_PATTERN.test(normalizeKey("bgd")), true);
    assert.equal(normalizeKey("bgd"), "BGD");
    assert.equal(HSN_PATTERN.test("060"), false);
    assert.equal(TSN_PATTERN.test("BGDX"), false);
    assert.equal(TSN_PATTERN.test("B-D"), false);
  });
});
