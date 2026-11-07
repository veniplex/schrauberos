import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHolidayCalendar, type HolidayConfig } from "@/lib/holidays";
import { workdaysBetweenKeys } from "./domain";
import { employedMonths, mergeRanges, proratedDays, vacationBalance, yearEntitlement, type VacationInput } from "./vacation";
import { formatWorkWeekdays, parseWorkWeekdays, workWeekdayList } from "./work-pattern";

const config: HolidayConfig = { region: "DE-NW", rules: {}, custom: [] };
const holidays = createHolidayCalendar(config);
const base = (extra: Partial<VacationInput> = {}): VacationInput => ({
  year: 2026,
  daysPerYear: 30,
  hire: "2019-04-01",
  leave: null,
  carry: null,
  trackingStartYear: null,
  vacations: [],
  pattern: undefined,
  deadline: { month: 3, day: 31 },
  today: "2026-06-15",
  ...extra,
});

describe("Arbeitstage-Muster (Teilzeit)", () => {
  it("Speicherform: sortiert, ohne Doppelte, ungültig → Montag bis Freitag", () => {
    assert.equal(formatWorkWeekdays([5, 1, 3, 3]), "1,3,5");
    assert.deepEqual(workWeekdayList("1,3,5"), [1, 3, 5]);
    assert.deepEqual(workWeekdayList(""), [1, 2, 3, 4, 5]);
    assert.deepEqual(workWeekdayList("1,x"), [1, 2, 3, 4, 5]);
    assert.deepEqual(workWeekdayList("7"), [1, 2, 3, 4, 5]);
    assert.deepEqual(workWeekdayList("0,6"), [0, 6]);
  });

  it("Abwesenheits-Arbeitstage zählen nur die Tage des Musters – ohne Feiertage", () => {
    // Mo 2026-06-01 … So 2026-06-07; Mittwoch 3.6. ist kein Feiertag in NW, Fronleichnam 2026 ist Do 4.6.
    assert.equal(workdaysBetweenKeys("2026-06-01", "2026-06-07"), 5, "Vollzeit: ohne Feiertage Mo–Fr");
    assert.equal(workdaysBetweenKeys("2026-06-01", "2026-06-07", holidays), 4, "Fronleichnam (Do) fällt weg");
    const monWedFri = parseWorkWeekdays("1,3,5");
    assert.equal(workdaysBetweenKeys("2026-06-01", "2026-06-07", holidays, monWedFri), 3);
    const tueThu = parseWorkWeekdays("2,4");
    assert.equal(workdaysBetweenKeys("2026-06-01", "2026-06-07", undefined, tueThu), 2);
    assert.equal(workdaysBetweenKeys("2026-06-01", "2026-06-07", holidays, tueThu), 1, "der Feiertag fällt auf einen Arbeitstag der Person");
    assert.equal(workdaysBetweenKeys("2026-06-01", "2026-06-07", holidays, parseWorkWeekdays("1,2,3")), 3, "ein Feiertag an einem freien Tag ändert nichts");
    assert.equal(workdaysBetweenKeys("2026-06-06", "2026-06-07", holidays, parseWorkWeekdays("0,6")), 2, "Wochenendarbeit");
  });
});

describe("Anteiliger Anspruch bei Ein-/Austritt", () => {
  it("volle Monate: Eintritt am 1. zählt den Monat, am 2. nicht; Austritt am Monatsletzten zählt, am Vortag nicht", () => {
    assert.equal(employedMonths(2026, "2026-07-01", null), 6);
    assert.equal(employedMonths(2026, "2026-07-02", null), 5);
    assert.equal(employedMonths(2026, null, "2026-06-30"), 6);
    assert.equal(employedMonths(2026, null, "2026-06-29"), 5);
    assert.equal(employedMonths(2026, "2026-03-01", "2026-08-31"), 6);
    assert.equal(employedMonths(2026, "2027-01-01", null), 0, "noch nicht eingetreten");
    assert.equal(employedMonths(2026, null, "2025-12-31"), 0, "schon ausgetreten");
    assert.equal(employedMonths(2024, "2024-02-01", "2024-02-29"), 1, "Schaltjahr: 29. Februar ist der letzte Tag");
    assert.equal(employedMonths(2026, "2019-04-01", null), 12);
  });

  it("Rundung wie § 5 Abs. 2 BUrlG: ab einem halben Tag auf, sonst zwei Nachkommastellen", () => {
    assert.equal(proratedDays(30, 5), 13, "12,5 → 13");
    assert.equal(proratedDays(30, 6), 15);
    assert.equal(proratedDays(25, 5), 10.42, "10,4166… bleibt Bruchteil unter ½");
    assert.equal(proratedDays(28, 7), 16.33);
    assert.equal(proratedDays(24, 1), 2);
    assert.equal(proratedDays(30, 3), 8, "7,5 → 8");
    assert.equal(proratedDays(30, 0), 0);
    assert.equal(proratedDays(20, 11), 18.33);
    assert.equal(proratedDays(26, 11), 24, "23,83 → 24");
  });

  it("Jahresanspruch: ganzes Jahr voll, Eintrittsjahr anteilig, nach Austritt 0, ohne Anspruch null", () => {
    assert.deepEqual(yearEntitlement({ year: 2026, daysPerYear: 30, hire: "2019-04-01", leave: null }), { days: 30, months: 12, prorated: false });
    assert.deepEqual(yearEntitlement({ year: 2026, daysPerYear: 30, hire: "2026-07-01", leave: null }), { days: 15, months: 6, prorated: true });
    assert.deepEqual(yearEntitlement({ year: 2026, daysPerYear: 30, hire: "2026-01-01", leave: null }), { days: 30, months: 12, prorated: false }, "Eintritt am 1. Januar = ganzes Jahr");
    assert.deepEqual(yearEntitlement({ year: 2026, daysPerYear: 30, hire: null, leave: "2026-03-31" }), { days: 8, months: 3, prorated: true });
    assert.deepEqual(yearEntitlement({ year: 2026, daysPerYear: 30, hire: "2020-01-01", leave: "2025-12-31" }), { days: 0, months: 0, prorated: true });
    assert.equal(yearEntitlement({ year: 2026, daysPerYear: null, hire: null, leave: null }), null);
    assert.deepEqual(yearEntitlement({ year: 2026, daysPerYear: 30, hire: "2026-03-15", leave: "2026-09-10" }), { days: 13, months: 5, prorated: true }, "April bis August: 5 volle Monate = 12,5 → 13");
  });
});

describe("Rest und Übertrag", () => {
  it("einfacher Fall: Anspruch minus genommene Arbeitstage (ohne Feiertage), Teilzeit rechnet nach Muster", () => {
    const b = vacationBalance(base({ vacations: [{ start: "2026-06-01", end: "2026-06-12" }], holidays }));
    assert.equal(b.used, 9, "zwei Wochen, ein Feiertag (Fronleichnam)");
    assert.equal(b.remaining, 21);
    const part = vacationBalance(base({ daysPerYear: 18, pattern: parseWorkWeekdays("1,2,3"), vacations: [{ start: "2026-06-01", end: "2026-06-12" }], holidays }));
    assert.equal(part.used, 6, "Mo–Mi, zwei Wochen");
    assert.equal(part.remaining, 12);
  });

  it("Eintrittsjahr anteilig", () => {
    const b = vacationBalance(base({ hire: "2026-07-01", vacations: [{ start: "2026-08-03", end: "2026-08-07" }] }));
    assert.deepEqual([b.entitlement?.days, b.used, b.remaining], [15, 5, 10]);
  });

  it("sich überschneidende Urlaubseinträge zählen jeden Tag nur einmal", () => {
    assert.deepEqual(mergeRanges([{ start: "2026-02-10", end: "2026-02-14" }, { start: "2026-02-12", end: "2026-02-20" }, { start: "2026-03-01", end: "2026-03-02" }]), [
      { start: "2026-02-10", end: "2026-02-20" },
      { start: "2026-03-01", end: "2026-03-02" },
    ]);
    const b = vacationBalance(base({ vacations: [{ start: "2026-02-09", end: "2026-02-13" }, { start: "2026-02-11", end: "2026-02-13" }] }));
    assert.equal(b.used, 5);
  });

  it("von Hand erfasster Übertrag: wird zuerst bis zum Stichtag verbraucht, der Rest verfällt danach", () => {
    // 5 Tage Übertrag, 3 davon bis 31.3. genommen (Feb), 2 davon später – vor dem Stichtag noch offen, nach dem Stichtag verfallen
    const vacations = [{ start: "2026-02-09", end: "2026-02-11" }, { start: "2026-05-04", end: "2026-05-08" }];
    const before = vacationBalance(base({ carry: { year: 2026, days: 5 }, trackingStartYear: 2026, vacations, today: "2026-03-01" }));
    assert.deepEqual([before.carryIn, before.carryUsed, before.carryOpen, before.carryExpired], [5, 3, 2, 0]);
    assert.equal(before.remaining, 30 + 5 - 8, "Anspruch + Übertrag − genommen (8 Arbeitstage), der offene Rest des Übertrags zählt noch");
    const after = vacationBalance(base({ carry: { year: 2026, days: 5 }, trackingStartYear: 2026, vacations, today: "2026-06-15" }));
    assert.deepEqual([after.carryUsed, after.carryOpen, after.carryExpired], [3, 0, 2]);
    assert.equal(after.remaining, 30 - (8 - 3), "der verfallene Übertrag zählt nicht mehr");
    assert.equal(after.carryOut, 25);
  });

  it("Stichtag einstellbar; Urlaub über den Stichtag hinweg wird tageweise zugeordnet", () => {
    // Übertrag 5, Urlaub Mo 2026-03-30 – Fr 2026-04-03 (Stichtag 31.03.: 2 Tage davor, 3 danach)
    const v = [{ start: "2026-03-30", end: "2026-04-03" }];
    const a = vacationBalance(base({ carry: { year: 2026, days: 5 }, trackingStartYear: 2026, vacations: v }));
    assert.deepEqual([a.carryUsed, a.carryExpired, a.used], [2, 3, 5]);
    const may = vacationBalance(base({ carry: { year: 2026, days: 5 }, trackingStartYear: 2026, vacations: v, deadline: { month: 5, day: 31 } }));
    assert.deepEqual([may.carryUsed, may.carryExpired, may.used, may.deadline], [5, 0, 5, "2026-05-31"]);
  });

  it("Übertrag aus dem Vorjahr wird gerechnet: Anspruch minus Rest des Vorjahres; erst ab dem Jahr der Anlage", () => {
    const vacations = [{ start: "2025-07-07", end: "2025-07-25" }, { start: "2026-01-12", end: "2026-01-16" }];
    // ab 2025 geführt: 2025 Anspruch 30, 15 genommen → Übertrag 15 nach 2026; im Januar 2026 fünf Tage davon
    const tracked = vacationBalance(base({ trackingStartYear: 2025, vacations }));
    assert.deepEqual([tracked.carryIn, tracked.carryUsed, tracked.used], [15, 5, 5]);
    assert.equal(tracked.carryExpired, 10, "nach dem Stichtag verfällt der Rest des Übertrags (today 15.6.)");
    assert.equal(tracked.remaining, 30);
    // erst ab 2026 geführt: für 2025 weiß die Anwendung nichts – kein Übertrag
    const fresh = vacationBalance(base({ trackingStartYear: 2026, vacations }));
    assert.deepEqual([fresh.carryIn, fresh.carryUsed, fresh.remaining], [0, 0, 25]);
  });

  it("Übertrag vor dem Eintritt gibt es nicht; Austritt: Anspruch bis dahin anteilig, Rest bleibt Rest", () => {
    const start = vacationBalance(base({ hire: "2026-04-01", trackingStartYear: 2020 }));
    assert.equal(start.carryIn, 0);
    assert.equal(start.entitlement?.days, 23, "9 volle Monate: 22,5 → 23");
    const leaver = vacationBalance(base({ leave: "2026-06-30", vacations: [{ start: "2026-05-04", end: "2026-05-08" }] }));
    assert.deepEqual([leaver.entitlement?.days, leaver.used, leaver.remaining], [15, 5, 10]);
  });

  it("ohne hinterlegten Jahresanspruch: Anspruch 0, genommene Tage werden trotzdem gezählt", () => {
    const b = vacationBalance(base({ daysPerYear: null, vacations: [{ start: "2026-02-09", end: "2026-02-10" }] }));
    assert.deepEqual([b.entitlement, b.used], [null, 2]);
  });

  it("zu viel genommen: negativer Rest, kein negativer Übertrag", () => {
    const b = vacationBalance(base({ daysPerYear: 2, vacations: [{ start: "2026-09-07", end: "2026-09-11" }] }));
    assert.deepEqual([b.remaining, b.carryOut], [-3, 0]);
  });

  it("Stichtag 29. Februar fällt im Nichtschaltjahr auf den 28.", () => {
    const b = vacationBalance(base({ deadline: { month: 2, day: 29 } }));
    assert.equal(b.deadline, "2026-02-28");
    assert.equal(vacationBalance(base({ year: 2028, deadline: { month: 2, day: 29 } })).deadline, "2028-02-29");
  });
});
