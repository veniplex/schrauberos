import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backoffDelay, nextCronRun, nextRun, parseCron, validateSchedule } from "./schedule";

const BERLIN = "Europe/Berlin";
const iso = (d: Date) => d.toISOString();
const next = (cron: string, after: string, tz = BERLIN) => iso(nextCronRun(parseCron(cron), new Date(after), tz));

describe("Cron-Ausdrücke", () => {
  it("liest Zahlen, Bereiche, Listen und Schrittweiten; Sonntag ist 0 und 7", () => {
    const spec = parseCron("*/15 8-10,22 * 1-3 0,7");
    assert.deepEqual([...spec.minute], [0, 15, 30, 45]);
    assert.deepEqual([...spec.hour], [8, 9, 10, 22]);
    assert.deepEqual([...spec.month], [1, 2, 3]);
    assert.deepEqual([...spec.dow], [0]);
  });

  it("lehnt fehlerhafte Ausdrücke ab (falsche Feldzahl, Bereich, Schritt, Müll)", () => {
    for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "5-1 * * * *", "*/0 * * * *", "a * * * *", "1-2-3 * * * *"]) {
      assert.throws(() => parseCron(bad), bad);
    }
  });

  it("validateSchedule prüft Intervall (mindestens eine Sekunde) und Cron", () => {
    validateSchedule({ every: 1000 });
    validateSchedule({ cron: "0 2 * * *" });
    assert.throws(() => validateSchedule({ every: 10 }));
    assert.throws(() => validateSchedule({ every: Number.NaN }));
    assert.throws(() => validateSchedule({ cron: "kaputt" }));
  });
});

describe("Nächster Lauf (Zeitzone)", () => {
  it("rechnet in der Zeitzone der Werkstatt: 02:00 Berlin im Winter = 01:00 UTC, im Sommer = 00:00 UTC", () => {
    assert.equal(next("0 2 * * *", "2026-01-10T12:00:00Z"), "2026-01-11T01:00:00.000Z");
    assert.equal(next("0 2 * * *", "2026-07-10T12:00:00Z"), "2026-07-11T00:00:00.000Z");
    assert.equal(next("0 2 * * *", "2026-07-10T12:00:00Z", "UTC"), "2026-07-11T02:00:00.000Z");
  });

  it("liefert nie den Zeitpunkt selbst, sondern den nächsten danach", () => {
    assert.equal(next("0 2 * * *", "2026-01-11T01:00:00Z"), "2026-01-12T01:00:00.000Z");
    assert.equal(next("*/10 * * * *", "2026-01-11T01:10:00Z"), "2026-01-11T01:20:00.000Z");
  });

  it("Wochentage, Monate und die Regel „Tag des Monats oder Wochentag“", () => {
    // Montag bis Freitag 08:00 – vom Freitagabend aus kommt der Montag
    assert.equal(next("0 8 * * 1-5", "2026-01-09T20:00:00Z"), "2026-01-12T07:00:00.000Z");
    // 1. des Monats ODER Montag (beide eingeschränkt): Sonntag 31.5. → Montag 1.6. ist beides; Dienstag 2.6. → nächster Montag 8.6.
    assert.equal(next("0 0 1 * 1", "2026-05-31T23:00:00Z", "UTC"), "2026-06-01T00:00:00.000Z");
    assert.equal(next("0 0 1 * 1", "2026-06-02T00:00:00Z", "UTC"), "2026-06-08T00:00:00.000Z");
    // Schalttag
    assert.equal(next("0 0 29 2 *", "2026-03-01T00:00:00Z", "UTC"), "2028-02-29T00:00:00.000Z");
  });

  it("Sommerzeit-Umstellung (vor): 02:30 gibt es am 29.03.2026 nicht – der Lauf kommt unmittelbar nach der Lücke, genau einmal", () => {
    const first = next("30 2 * * *", "2026-03-28T12:00:00Z");
    assert.equal(first, "2026-03-29T01:30:00.000Z", "03:30 Uhr Sommerzeit");
    assert.equal(next("30 2 * * *", first), "2026-03-30T00:30:00.000Z", "am nächsten Tag wieder 02:30 Sommerzeit");
  });

  it("Zurückstellen: 02:30 gibt es am 25.10.2026 zweimal – der Lauf kommt nur beim ersten Mal", () => {
    const first = next("30 2 * * *", "2026-10-24T12:00:00Z");
    assert.equal(first, "2026-10-25T00:30:00.000Z", "02:30 Sommerzeit");
    assert.equal(next("30 2 * * *", first), "2026-10-26T01:30:00.000Z", "nicht um 01:30 UTC (die zweite 02:30), sondern am nächsten Tag");
  });

  it("ein Tagesjob läuft über ein ganzes Jahr hinweg jeden Kalendertag genau einmal", () => {
    const spec = parseCron("30 2 * * *");
    const days: string[] = [];
    let at = new Date("2025-12-31T23:00:00Z");
    for (let i = 0; i < 366; i++) {
      at = nextCronRun(spec, at, BERLIN);
      days.push(new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN, dateStyle: "short" }).format(at));
    }
    assert.equal(new Set(days).size, 366, "kein Tag doppelt oder ausgelassen");
    assert.equal(days[0], "2026-01-01");
    assert.equal(days[365], "2027-01-01");
  });

  it("stündlich über die Umstellung: ohne Lücke und ohne Doppellauf", () => {
    const spec = parseCron("0 * * * *");
    const runs: string[] = [];
    let at = new Date("2026-03-29T00:30:00Z");
    for (let i = 0; i < 5; i++) {
      at = nextCronRun(spec, at, BERLIN);
      runs.push(iso(at));
    }
    assert.deepEqual(runs, ["2026-03-29T01:00:00.000Z", "2026-03-29T02:00:00.000Z", "2026-03-29T03:00:00.000Z", "2026-03-29T04:00:00.000Z", "2026-03-29T05:00:00.000Z"]);
  });

  it("bekannte Grenze: stündlich/unterstündlich per Cron lässt beim Zurückstellen eine Stunde aus (die zweite 02-Uhr-Stunde); ein Intervall (every) nicht", () => {
    // Berlin, 25.10.2026: 03:00 Sommerzeit wird 02:00 Winterzeit – die Wandzeiten 02:xx gibt es zweimal, der Cron nimmt nur das erste Mal
    const spec = parseCron("0 * * * *");
    const runs: string[] = [];
    let at = new Date("2026-10-24T23:30:00Z");
    for (let i = 0; i < 4; i++) {
      at = nextCronRun(spec, at, BERLIN);
      runs.push(iso(at));
    }
    assert.deepEqual(runs, ["2026-10-25T00:00:00.000Z", "2026-10-25T02:00:00.000Z", "2026-10-25T03:00:00.000Z", "2026-10-25T04:00:00.000Z"], "01:00 UTC (= zweites 02:00 Uhr) fehlt");
    // Wer in jeder Stunde laufen muss, nimmt ein Intervall: keine Lücke
    assert.equal(iso(nextRun({ every: 3_600_000 }, new Date("2026-10-25T00:00:00Z"), BERLIN)), "2026-10-25T01:00:00.000Z");
  });

  it("nextRun: Intervall = Zeitpunkt + Intervall, Cron wie oben", () => {
    assert.equal(iso(nextRun({ every: 600_000 }, new Date("2026-01-01T00:00:00Z"), BERLIN)), "2026-01-01T00:10:00.000Z");
    assert.equal(iso(nextRun({ cron: "0 2 * * *" }, new Date("2026-01-10T12:00:00Z"), BERLIN)), "2026-01-11T01:00:00.000Z");
  });
});

describe("Wartezeit zwischen Wiederholungen", () => {
  it("verdoppelt sich je Fehlversuch und ist nach oben begrenzt", () => {
    const delays = [1, 2, 3, 4, 5, 6, 40].map((n) => backoffDelay(n, 60_000, 600_000));
    assert.deepEqual(delays, [60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
    assert.equal(backoffDelay(0, 1000, 5000), 1000, "null zählt wie der erste Versuch");
  });
});
