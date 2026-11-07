import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_HOLIDAYS, createHolidayCalendar } from "@/lib/holidays";
import { instantOf } from "@/lib/zone";
import { billableQuantityMilli, billableUnitCents, entryMinutes, formatDuration, hintsFor, plausibleDuration, splitByDay, summarizeDays, weekDays, weekSummary } from "./domain";

const Z = "Europe/Berlin";
const at = (day: string, time: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return instantOf(y, m, d, h, min, 0, 0, Z);
};
const span = (day: string, from: string, to: string | null, breakMinutes = 0, endDay = day) => ({ startedAt: at(day, from), endedAt: to ? at(endDay, to) : null, breakMinutes });
const NOW = at("2026-11-12", "12:00");

describe("Dauer", () => {
  it("rechnet Minuten, zieht die Pause ab und wird nie negativ; laufende Einträge zählen bis jetzt", () => {
    assert.equal(entryMinutes(span("2026-11-10", "07:00", "15:30"), NOW), 510);
    assert.equal(entryMinutes(span("2026-11-10", "07:00", "15:30", 30), NOW), 480);
    assert.equal(entryMinutes(span("2026-11-10", "07:00", "07:10", 30), NOW), 0);
    assert.equal(entryMinutes(span("2026-11-12", "10:00", null), NOW), 120);
  });

  it("formatiert Stunden:Minuten mit Vorzeichen", () => {
    assert.equal(formatDuration(450), "7:30");
    assert.equal(formatDuration(5), "0:05");
    assert.equal(formatDuration(-95), "−1:35");
  });

  it("rechnet Stunden und Arbeitswerte (1 AW = Minuten aus dem Profil) für die Abrechnung", () => {
    assert.equal(billableQuantityMilli(90, "h", 5), 1500);
    assert.equal(billableQuantityMilli(90, "aw", 5), 18_000);
    assert.equal(billableQuantityMilli(7, "aw", 6), 1167);
    assert.equal(billableUnitCents(8500, "h", 5), 8500);
    assert.equal(billableUnitCents(8500, "aw", 5), 708);
  });

  it("eine plausible Dauer ist positiv und höchstens ein Tag", () => {
    assert.ok(plausibleDuration(at("2026-11-10", "07:00"), at("2026-11-10", "08:00")));
    assert.ok(!plausibleDuration(at("2026-11-10", "08:00"), at("2026-11-10", "07:00")));
    assert.ok(!plausibleDuration(at("2026-11-10", "08:00"), at("2026-11-11", "09:00")));
  });
});

describe("Aufteilung auf Tage", () => {
  it("teilt einen Eintrag über Mitternacht und zieht die Pause vom ersten Stück ab", () => {
    const parts = splitByDay(span("2026-11-10", "22:00", "06:00", 30, "2026-11-11"), NOW, Z);
    assert.deepEqual(parts.map((p) => [p.day, p.minutes]), [["2026-11-10", 90], ["2026-11-11", 360]]);
  });

  it("summiert je Tag Arbeitszeit, Lücken als Pause und erfasste Pausen", () => {
    const days = summarizeDays([span("2026-11-10", "07:00", "11:00"), span("2026-11-10", "11:45", "16:00", 10)], NOW, Z);
    const day = days.get("2026-11-10")!;
    assert.equal(day.worked, 240 + 255 - 10);
    assert.equal(day.pause, 45 + 10);
  });
});

describe("Hinweise (keine Sperre)", () => {
  const kinds = (spans: Parameters<typeof hintsFor>[0]) => hintsFor(spans, NOW, Z).map((h) => h.kind);

  it("mehr als 6 Stunden ohne 30 Minuten Pause: Hinweis; mit Pause oder knapp 6 Stunden: keiner", () => {
    assert.deepEqual(kinds([span("2026-11-10", "07:00", "13:30")]), ["break"]);
    assert.deepEqual(kinds([span("2026-11-10", "07:00", "13:30", 30)]), []);
    assert.deepEqual(kinds([span("2026-11-10", "07:00", "13:00")]), []);
    assert.deepEqual(kinds([span("2026-11-10", "07:00", "10:00"), span("2026-11-10", "10:30", "14:30")]), [], "die Lücke zählt als Pause");
  });

  it("mehr als 9 Stunden verlangen 45 Minuten Pause", () => {
    const hints = hintsFor([span("2026-11-10", "07:00", "16:45", 30)], NOW, Z);
    assert.deepEqual(hints.map((h) => h.kind), ["break"]);
    assert.equal(hints[0].kind === "break" ? hints[0].needed : 0, 45);
  });

  it("mehr als 10 Stunden an einem Tag", () => {
    assert.ok(kinds([span("2026-11-10", "06:00", "17:30", 60)]).includes("maxDay"));
    assert.ok(!kinds([span("2026-11-10", "06:00", "16:00", 60)]).includes("maxDay"));
  });

  it("weniger als 11 Stunden Ruhezeit zwischen zwei Arbeitstagen; nahtlos über Mitternacht und 11 Stunden genau sind in Ordnung", () => {
    assert.deepEqual(kinds([span("2026-11-10", "13:00", "21:00", 30), span("2026-11-11", "06:00", "10:00")]), ["rest"]);
    assert.deepEqual(kinds([span("2026-11-10", "13:00", "21:00", 30), span("2026-11-11", "08:00", "12:00")]), [], "11 Stunden");
    assert.deepEqual(kinds([span("2026-11-10", "22:00", "00:00", 0, "2026-11-11"), span("2026-11-11", "00:00", "05:00")]), [], "nahtlos");
  });

  it("ein Eintrag, der über 16 Stunden läuft, wird als vermutlich nicht beendet gemeldet; ein heute laufender Tag meldet keine fehlende Pause", () => {
    assert.ok(kinds([span("2026-11-11", "08:00", null)]).includes("forgotten"));
    assert.deepEqual(kinds([span("2026-11-12", "04:00", null)]), [], "läuft erst 8 Stunden und heute");
  });
});

describe("Woche: Ist, Soll, Saldo", () => {
  const days = weekDays("2026-11-12");
  const summaries = summarizeDays([span("2026-11-09", "07:00", "15:00"), span("2026-11-10", "07:00", "16:00"), span("2026-11-11", "07:00", "11:00")], NOW, Z);

  it("Montag bis Sonntag der Woche", () => {
    assert.deepEqual([days[0], days[6]], ["2026-11-09", "2026-11-15"]);
    assert.deepEqual(weekDays("2026-11-15")[0], "2026-11-09");
    assert.deepEqual(weekDays("2026-11-09")[0], "2026-11-09");
  });

  it("Vollzeit: Soll 5 × 8 Stunden, Saldo aus Ist minus Soll", () => {
    const week = weekSummary({ days, summaries, pattern: new Set([1, 2, 3, 4, 5]), targetMinutes: 480, absentDays: new Set() });
    assert.equal(week.target, 2400);
    assert.equal(week.worked, 480 + 540 + 240);
    assert.equal(week.balance, 1260 - 2400);
  });

  it("Teilzeit-Wochentage, Feiertag und Abwesenheit senken das Soll (Abwesenheit: kein Grund bekannt)", () => {
    const holidays = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW", custom: [{ id: "1", name: "Betriebsfest", month: 11, day: 11, year: 2026, half: true }] });
    const week = weekSummary({ days, summaries, pattern: new Set([1, 2, 3]), targetMinutes: 480, holidays, absentDays: new Set(["2026-11-09"]) });
    assert.equal(week.days[0].target, 0, "abwesend");
    assert.equal(week.days[1].target, 480);
    assert.equal(week.days[2].target, 240, "halber Feiertag");
    assert.equal(week.days[3].target, 0, "kein Arbeitstag");
    assert.equal(week.target, 720);
    assert.equal(week.days[0].absent, true);
  });
});
