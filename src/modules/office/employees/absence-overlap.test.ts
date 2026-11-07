import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { absenceHints, type ExistingAbsence } from "./absence-overlap";

const TZ = "Europe/Berlin";
const day = (key: string) => new Date(`${key}T12:00:00+02:00`);
const row = (type: ExistingAbsence["type"], start: string, end: string): ExistingAbsence => ({ type, startDate: day(start), endDate: day(end) });

describe("absenceHints (Überschneidungswarnung)", () => {
  const planned = { type: "vacation" as const, start: "2026-07-06", end: "2026-07-10" };

  it("keine Überschneidung: keine Hinweise (auch nicht am Rand: Vortag und Folgetag)", () => {
    assert.deepEqual(absenceHints(planned, [row("training", "2026-07-01", "2026-07-05"), row("other", "2026-07-11", "2026-07-12")], TZ), { duplicate: false, overlaps: [] });
  });

  it("Teil-, Voll- und Einschluss-Überschneidung sind Hinweise, keine Dubletten; sortiert nach Beginn", () => {
    const hints = absenceHints(
      planned,
      [row("training", "2026-07-09", "2026-07-14"), row("other", "2026-07-08", "2026-07-08"), row("training", "2026-07-01", "2026-07-06"), row("vacation", "2026-07-01", "2026-07-31")],
      TZ,
    );
    assert.equal(hints.duplicate, false);
    assert.deepEqual(hints.overlaps.map((o) => [o.start, o.end, o.type]), [
      ["2026-07-01", "2026-07-06", "training"],
      ["2026-07-01", "2026-07-31", "vacation"],
      ["2026-07-08", "2026-07-08", "other"],
      ["2026-07-09", "2026-07-14", "training"],
    ]);
  });

  it("exakte Dublette: gleiche Art und gleicher Zeitraum", () => {
    const hints = absenceHints(planned, [row("vacation", "2026-07-06", "2026-07-10")], TZ);
    assert.equal(hints.duplicate, true);
    assert.equal(hints.overlaps.length, 1);
  });

  it("gleicher Zeitraum, andere Art: nur ein Hinweis, keine Dublette", () => {
    assert.equal(absenceHints(planned, [row("training", "2026-07-06", "2026-07-10")], TZ).duplicate, false);
  });

  it("Krankheit ohne Recht (maskiert): Zeitraum ja, Art nie; nie eine Dublette", () => {
    const hints = absenceHints({ type: "other", start: "2026-07-06", end: "2026-07-10" }, [row("masked", "2026-07-06", "2026-07-10")], TZ);
    assert.equal(hints.duplicate, false);
    assert.deepEqual(hints.overlaps, [{ start: "2026-07-06", end: "2026-07-10", type: "masked" }]);
    assert.equal(JSON.stringify(hints).includes("sick"), false);
  });

  it("Tage zählen in der Zone der Werkstatt (Mitternachtsnähe)", () => {
    const late = { type: "vacation" as const, startDate: new Date("2026-07-05T22:30:00Z"), endDate: new Date("2026-07-05T22:30:00Z") }; // 6. Juli 00:30 in Berlin
    assert.equal(absenceHints(planned, [late], "Europe/Berlin").overlaps.length, 1);
    assert.equal(absenceHints(planned, [late], "UTC").overlaps.length, 0);
  });
});
