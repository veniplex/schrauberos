import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_TIRE_RULES,
  formatTireSize,
  minTread,
  parseDot,
  producedDate,
  setHealth,
  tireAgeYears,
  tireHealth,
  isValidSeasonWindow,
  isWrongSeason,
  pendingStockBooking,
  suggestedStockStatus,
  wantedSeason,
} from "./domain";

const rules = DEFAULT_TIRE_RULES; // Profil: warn < 4, erneuern < 3 · Alter: warn ≥ 6, erneuern ≥ 10
const now = new Date("2026-11-05T12:00:00Z");
const good = { producedYear: 2024, producedWeek: 10, treadDepthMm: 7, condition: "good" };

describe("parseDot", () => {
  test("liest Woche und Jahr", () => {
    assert.deepEqual(parseDot("2321"), { week: 23, year: 2021 });
    assert.deepEqual(parseDot(" 0124 "), { week: 1, year: 2024 });
  });
  test("lehnt Ungültiges ab", () => {
    for (const bad of ["", null, undefined, "232", "23211", "ab12", "0021", "5421"]) assert.equal(parseDot(bad), null, String(bad));
  });
});

describe("Alter", () => {
  test("producedDate: KW 1/2021 beginnt am Montag, 4. Januar", () => {
    assert.equal(producedDate(2021, 1).toISOString().slice(0, 10), "2021-01-04");
  });
  test("tireAgeYears rechnet ab Produktionswoche", () => {
    const age = tireAgeYears({ producedYear: 2020, producedWeek: 45 }, now)!;
    assert.ok(age > 5.9 && age < 6.1, `Alter ${age}`);
  });
  test("ohne DOT kein Alter", () => {
    assert.equal(tireAgeYears({ producedYear: null, producedWeek: null }, now), null);
  });
});

describe("tireHealth", () => {
  test("gesunder Reifen", () => {
    assert.equal(tireHealth(good, rules, now).health, "ok");
  });
  test("Profil: Grenzwerte", () => {
    assert.equal(tireHealth({ ...good, treadDepthMm: 3.9 }, rules, now).health, "warn");
    assert.equal(tireHealth({ ...good, treadDepthMm: 4 }, rules, now).health, "ok");
    assert.equal(tireHealth({ ...good, treadDepthMm: 2.9 }, rules, now).health, "replace");
  });
  test("Alter: Grenzwerte", () => {
    assert.equal(tireHealth({ ...good, producedYear: 2020, producedWeek: 1 }, rules, now).health, "warn");
    assert.equal(tireHealth({ ...good, producedYear: 2016, producedWeek: 1 }, rules, now).health, "replace");
  });
  test("Zustand schlägt durch, Gründe werden gesammelt", () => {
    const h = tireHealth({ ...good, condition: "damaged", treadDepthMm: 3.5 }, rules, now);
    assert.equal(h.health, "replace");
    assert.deepEqual(h.reasons.sort(), ["condition", "tread"]);
  });
  test("ohne Messwerte: unbekannt", () => {
    assert.equal(tireHealth({ producedYear: null, producedWeek: null, treadDepthMm: null, condition: "good" }, rules, now).health, "unknown");
  });
});

describe("Reifensatz", () => {
  test("setHealth nimmt den schlechtesten Reifen", () => {
    const h = setHealth([good, { ...good, treadDepthMm: 2.5 }, good], rules, now);
    assert.equal(h.health, "replace");
  });
  test("minTread ignoriert fehlende Werte", () => {
    assert.equal(minTread([{ treadDepthMm: null }, { treadDepthMm: 5 }, { treadDepthMm: 3.2 }]), 3.2);
    assert.equal(minTread([{ treadDepthMm: null }]), null);
  });
  test("wantedSeason: Okt–Mär Winter, Apr–Sep Sommer", () => {
    assert.equal(wantedSeason(new Date(2026, 9, 1)), "winter");
    assert.equal(wantedSeason(new Date(2026, 2, 31)), "winter");
    assert.equal(wantedSeason(new Date(2026, 3, 1)), "summer");
    assert.equal(wantedSeason(new Date(2026, 8, 30)), "summer");
  });
  test("wantedSeason: konfigurierbares Fenster, auch ohne Jahreswechsel und mit Randmonaten", () => {
    // November bis Februar: über den Jahreswechsel
    const nov = { winterStartMonth: 11, winterEndMonth: 2 };
    assert.equal(wantedSeason(new Date(2026, 9, 31), nov), "summer");
    assert.equal(wantedSeason(new Date(2026, 10, 1), nov), "winter");
    assert.equal(wantedSeason(new Date(2027, 1, 28), nov), "winter");
    assert.equal(wantedSeason(new Date(2027, 2, 1), nov), "summer");
    // Beginn nicht nach dem Ende: innerhalb eines Jahres (z. B. Südhalbkugel: Mai bis August)
    const south = { winterStartMonth: 5, winterEndMonth: 8 };
    assert.equal(wantedSeason(new Date(2026, 3, 30), south), "summer");
    assert.equal(wantedSeason(new Date(2026, 4, 1), south), "winter");
    assert.equal(wantedSeason(new Date(2026, 7, 31), south), "winter");
    assert.equal(wantedSeason(new Date(2026, 8, 1), south), "summer");
    // ein einzelner Monat
    assert.equal(wantedSeason(new Date(2026, 0, 15), { winterStartMonth: 1, winterEndMonth: 1 }), "winter");
    assert.equal(wantedSeason(new Date(2026, 1, 15), { winterStartMonth: 1, winterEndMonth: 1 }), "summer");
  });
  test("isValidSeasonWindow: Monate 1–12, nie das ganze Jahr", () => {
    assert.ok(isValidSeasonWindow({ winterStartMonth: 10, winterEndMonth: 3 }));
    assert.ok(isValidSeasonWindow({ winterStartMonth: 6, winterEndMonth: 6 }));
    assert.ok(isValidSeasonWindow({ winterStartMonth: 1, winterEndMonth: 11 }), "ein Sommermonat genügt");
    assert.ok(!isValidSeasonWindow({ winterStartMonth: 4, winterEndMonth: 3 }), "April bis März = ganzes Jahr");
    assert.ok(!isValidSeasonWindow({ winterStartMonth: 1, winterEndMonth: 12 }));
    assert.ok(!isValidSeasonWindow({ winterStartMonth: 0, winterEndMonth: 3 }));
    assert.ok(!isValidSeasonWindow({ winterStartMonth: 10, winterEndMonth: 13 }));
    assert.ok(!isValidSeasonWindow({ winterStartMonth: 10.5, winterEndMonth: 3 }));
  });
  test("isWrongSeason: nur montierte Sommer-/Winter-Sätze der anderen Jahreszeit; Ganzjahr, Lager und Entsorgt nie", () => {
    assert.ok(isWrongSeason({ status: "mounted", season: "summer" }, "winter"));
    assert.ok(isWrongSeason({ status: "mounted", season: "winter" }, "summer"));
    assert.ok(!isWrongSeason({ status: "mounted", season: "winter" }, "winter"));
    assert.ok(!isWrongSeason({ status: "mounted", season: "allseason" }, "winter"));
    assert.ok(!isWrongSeason({ status: "mounted", season: "allseason" }, "summer"));
    assert.ok(!isWrongSeason({ status: "stored", season: "summer" }, "winter"));
    assert.ok(!isWrongSeason({ status: "disposed", season: "summer" }, "winter"));
  });
  test("suggestedStockStatus: gelagert → ausbuchen, ausgelagert → einbuchen, entsorgt → nichts", () => {
    assert.equal(suggestedStockStatus("stored"), "mounted");
    assert.equal(suggestedStockStatus("mounted"), "stored");
    assert.equal(suggestedStockStatus("disposed"), null);
    assert.equal(suggestedStockStatus("irgendwas"), null);
  });
  test("pendingStockBooking: erledigter Wechsel, danach nicht gebucht – nur kürzlich und nur buchbare Sätze", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);
    const done = { status: "done", startsAt: day(-1), updatedAt: day(-1) };
    const set = { status: "stored", updatedAt: day(-100) };
    assert.equal(pendingStockBooking(set, [done], now), done);
    // der Satz wurde nach dem Erledigen gebucht (oder angefasst)
    assert.equal(pendingStockBooking({ ...set, updatedAt: day(0) }, [done], now), null);
    // nicht erledigt oder zu lange her
    assert.equal(pendingStockBooking(set, [{ ...done, status: "in_progress" }], now), null);
    assert.equal(pendingStockBooking(set, [{ ...done, startsAt: day(-45), updatedAt: day(-45) }], now), null);
    // entsorgt: nicht buchbar
    assert.equal(pendingStockBooking({ ...set, status: "disposed" }, [done], now), null);
    // mehrere: der jüngste erledigte zählt
    const newer = { status: "done", startsAt: day(-0.5), updatedAt: day(-0.5) };
    assert.equal(pendingStockBooking(set, [done, newer], now), newer);
  });
  test("formatTireSize", () => {
    assert.equal(formatTireSize({ width: 205, aspect: 55, rim: 16, loadIndex: "91", speedIndex: "H" }), "205/55 R16 91H");
    assert.equal(formatTireSize({ width: null, aspect: 55, rim: 16 }), "–");
  });
});
