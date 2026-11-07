import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHolidayCalendar, NO_HOLIDAYS } from "@/lib/holidays";
import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/lib/opening-hours";
import { ageBucketOf, ageBucketRange, AGE_BUCKETS } from "@/modules/office/invoices/domain";
import { daysOf, lastDayOfMonth, monthKeys, nextMonth, openingIntervals, overlapMinutes, parsePeriod, parseRevenuePeriod, snapToMonths, totalMinutes, utilizationPercent } from "./domain";

/** Rechenregeln der Berichte gegen handgerechnete Fälle: Zeiträume und Monate, Altersstufen offener Posten, Öffnungszeiten (Feiertage, Sommerzeit-Umstellung), Überschneidung, Auslastung. */
const BERLIN = "Europe/Berlin";

describe("Monate und Zeiträume", () => {
  it("letzter Tag und nächster Monat (Schaltjahr, Jahreswechsel)", () => {
    assert.equal(lastDayOfMonth("2026-02"), "2026-02-28");
    assert.equal(lastDayOfMonth("2028-02"), "2028-02-29");
    assert.equal(lastDayOfMonth("2026-12"), "2026-12-31");
    assert.equal(nextMonth("2026-12"), "2027-01");
    assert.equal(nextMonth("2026-03"), "2026-04");
  });

  it("der Zeitraum wird auf ganze Monate gerundet; die Monatsliste ist lückenlos und aufsteigend", () => {
    assert.deepEqual(snapToMonths("2026-03-15", "2026-05-10"), { from: "2026-03-01", to: "2026-05-31" });
    assert.deepEqual(monthKeys("2026-11-20", "2027-02-01"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
    assert.deepEqual(monthKeys("2026-05-31", "2026-05-31"), ["2026-05"]);
  });

  it("parsePeriod: ungültige Tage, vertauscht, zu lang; beide Enden zählen", () => {
    assert.deepEqual(parsePeriod("2026-01-01", "2026-01-31", { maxDays: 31 }), { ok: true, from: "2026-01-01", to: "2026-01-31" });
    assert.deepEqual(parsePeriod("2026-01-01", "2026-02-01", { maxDays: 31 }), { ok: false, problem: "tooLong" });
    assert.deepEqual(parsePeriod("2026-02-01", "2026-01-01", { maxDays: 31 }), { ok: false, problem: "reversed" });
    for (const bad of [undefined, "", "2026-02-30", "26-01-01", 5]) assert.deepEqual(parsePeriod(bad, "2026-01-01", { maxDays: 31 }), { ok: false, problem: "invalid" }, String(bad));
  });

  it("Umsatzzeitraum: höchstens 36 Monate nach dem Runden (ein Zeitraum von 35 Monaten, der 37 Monate berührt, ist zu lang)", () => {
    assert.equal(parseRevenuePeriod("2026-01-01", "2028-12-31").ok, true, "36 Monate");
    assert.deepEqual(parseRevenuePeriod("2026-01-01", "2029-01-01"), { ok: false, problem: "tooLong" });
    assert.deepEqual(parseRevenuePeriod("2026-01-31", "2029-01-01"), { ok: false, problem: "tooLong" }, "berührt 37 Monate");
  });

  it("daysOf zählt beide Enden", () => {
    assert.deepEqual(daysOf("2026-03-28", "2026-03-31"), ["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
  });
});

describe("Altersstufen offener Posten", () => {
  const today = "2026-11-07";
  it("Stufen nach Tagen über der Fälligkeit; ohne Fälligkeit und heute fällig = nicht fällig", () => {
    const cases: Array<[string | null, string]> = [
      [null, "notDue"],
      ["2026-11-08", "notDue"],
      ["2026-11-07", "notDue"],
      ["2026-11-06", "d1_30"],
      ["2026-10-08", "d1_30"],
      ["2026-10-07", "d31_60"],
      ["2026-09-08", "d31_60"],
      ["2026-09-07", "d61_90"],
      ["2026-08-09", "d61_90"],
      ["2026-08-08", "d91plus"],
    ];
    for (const [due, bucket] of cases) assert.equal(ageBucketOf(due, today), bucket, String(due));
  });

  it("die Grenzen für die Datenbank decken jeden Tag genau einer Stufe zu – dieselbe Zuordnung wie ageBucketOf", () => {
    for (let offset = -120; offset <= 10; offset++) {
      const day = new Date(Date.UTC(2026, 10, 7 + offset)).toISOString().slice(0, 10);
      const hits = AGE_BUCKETS.filter((bucket) => {
        const range = ageBucketRange(bucket, today);
        return (range.gte === null || day >= range.gte) && (range.lt === null || day < range.lt);
      });
      assert.deepEqual(hits, [ageBucketOf(day, today)], day);
    }
  });
});

describe("Öffnungszeiten und Auslastung", () => {
  const hours = DEFAULT_OPENING_HOURS; // Mo–Do 07:30–17:00 (9,5 h), Fr 07:30–16:00 (8,5 h)
  const noHolidays = createHolidayCalendar(NO_HOLIDAYS);

  it("eine Woche: Mo–Do je 9,5 Stunden, Freitag 8,5, Wochenende nichts = 46,5 Stunden", () => {
    const week = daysOf("2026-11-02", "2026-11-08"); // Montag bis Sonntag
    assert.equal(totalMinutes(openingIntervals(week, hours, noHolidays, BERLIN)), 46.5 * 60);
  });

  it("ganzer Feiertag: keine Öffnung; halber Feiertag: die erste Hälfte", () => {
    const calendar = createHolidayCalendar({ region: "", rules: {}, custom: [{ id: "a", name: "Brückentag", month: 11, day: 3, year: 2026, half: false }, { id: "b", name: "Halber Tag", month: 11, day: 4, year: 2026, half: true }] });
    const intervals = openingIntervals(daysOf("2026-11-02", "2026-11-04"), hours, calendar, BERLIN);
    assert.equal(intervals.length, 2, "Dienstag (ganz frei) fehlt");
    assert.equal(totalMinutes(intervals), 9.5 * 60 + (9.5 * 60) / 2);
  });

  it("Tag der Sommerzeit-Umstellung (Sonntag 29.3.2026, geschlossen) und der Montag danach: Öffnung bleibt 9,5 Stunden Ortszeit", () => {
    const monday = openingIntervals(["2026-03-30"], hours, noHolidays, BERLIN);
    assert.equal(totalMinutes(monday), 9.5 * 60);
    const open: OpeningHours = { ...hours, sun: ["00:00", "05:00"] };
    // 29.3.2026: 02:00 → 03:00, die Nacht von 00:00 bis 05:00 Ortszeit hat nur 4 Stunden
    assert.equal(totalMinutes(openingIntervals(["2026-03-29"], open, noHolidays, BERLIN)), 4 * 60);
    // 25.10.2026: 03:00 → 02:00, 00:00 bis 05:00 Ortszeit sind 6 Stunden
    assert.equal(totalMinutes(openingIntervals(["2026-10-25"], open, noHolidays, BERLIN)), 6 * 60);
  });

  it("ein Termin zählt nur innerhalb der Öffnungszeit; über Mitternacht, am Wochenende und vor Öffnung nichts", () => {
    const week = openingIntervals(daysOf("2026-11-02", "2026-11-08"), hours, noHolidays, BERLIN);
    const at = (iso: string) => new Date(iso).getTime();
    // Montag 09:00–10:30 Berlin (MEZ = UTC+1): 90 Minuten
    assert.equal(overlapMinutes(at("2026-11-02T08:00:00Z"), at("2026-11-02T09:30:00Z"), week), 90);
    // Montag 06:30–08:30 Berlin: nur 07:30–08:30 zählen = 60 Minuten
    assert.equal(overlapMinutes(at("2026-11-02T05:30:00Z"), at("2026-11-02T07:30:00Z"), week), 60);
    // Freitag 15:00 bis Montag 08:00 Berlin: Freitag 15:00–16:00 (60) + Montag nicht im Zeitraum
    assert.equal(overlapMinutes(at("2026-11-06T14:00:00Z"), at("2026-11-09T07:00:00Z"), week), 60);
    // Samstag: nichts
    assert.equal(overlapMinutes(at("2026-11-07T09:00:00Z"), at("2026-11-07T12:00:00Z"), week), 0);
    // Ende vor/gleich Beginn: nichts
    assert.equal(overlapMinutes(at("2026-11-02T09:00:00Z"), at("2026-11-02T09:00:00Z"), week), 0);
    // zwei Tage: Montag 16:00–17:00 (60) und Dienstag 07:30–08:00 (30) Berlin
    assert.equal(overlapMinutes(at("2026-11-02T15:00:00Z"), at("2026-11-03T07:00:00Z"), week), 90);
  });

  it("Auslastung: Prozent mit einer Nachkommastelle; ohne Öffnungszeit keine Aussage", () => {
    assert.equal(utilizationPercent(570, 2280), 25);
    assert.equal(utilizationPercent(1, 3), 33.3);
    assert.equal(utilizationPercent(0, 600), 0);
    assert.equal(utilizationPercent(100, 0), null);
  });
});
