import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthStart, parseMonthInput } from "./month";

describe("Monatseingabe", () => {
  it("versteht die Schreibweisen von Monatsfeld und Tastatur", () => {
    for (const [input, expected] of [
      ["2026-11", "2026-11"],
      ["11/2026", "2026-11"],
      ["11.2026", "2026-11"],
      ["1.2026", "2026-01"],
      ["01 / 2026", "2026-01"],
      ["11-2026", "2026-11"],
      ["  12.2027 ", "2027-12"],
    ] as const) assert.equal(parseMonthInput(input), expected, input);
  });

  it("lehnt Unsinn und nicht vorhandene Monate ab", () => {
    for (const input of ["", "13/2026", "0/2026", "11/26", "November 2026", "2026-13", "2026-11-05", "11/1800", "abc"]) assert.equal(parseMonthInput(input), null, input);
  });

  it("monthStart: der erste Tag des Monats mittags (Ortszeit), ungültig wirft", () => {
    const d = monthStart("2026-11");
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 10, 1, 12]);
    assert.throws(() => monthStart("kaputt"));
  });
});
