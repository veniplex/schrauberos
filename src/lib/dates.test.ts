import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentYear, nowDate, parseDateParam, parseLocalDateTime, parseMonthParam, toDateInput, toTimeInput, todayInput } from "./dates";

/** Datum/Uhrzeit-Hilfen: Eingaben der Formulare und URL-Parameter werden defensiv gelesen (Serverzeitzone). */
describe("parseLocalDateTime", () => {
  it("liest Datum und Uhrzeit als lokale Zeit", () => {
    const d = parseLocalDateTime("2026-11-05", "09:30");
    assert.ok(d);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 5, 9, 30]);
  });

  it("lehnt ungültige Angaben ab (kein 30. Februar, keine 25. Stunde, kein Text)", () => {
    for (const [date, time] of [["2026-02-30", "09:00"], ["2026-13-01", "09:00"], ["2026-11-05", "25:00"], ["2026-11-05", "09:60"], ["heute", "09:00"], ["", ""], ["2026-11-05", "9"]]) {
      assert.equal(parseLocalDateTime(date, time), null, `${date} ${time}`);
    }
  });

  it("Schaltjahr: 29. Februar nur im Schaltjahr", () => {
    assert.ok(parseLocalDateTime("2028-02-29", "10:00"));
    assert.equal(parseLocalDateTime("2027-02-29", "10:00"), null);
  });

  it("toDateInput/toTimeInput sind die Umkehrung (Formularwerte)", () => {
    const d = parseLocalDateTime("2026-03-01", "07:05")!;
    assert.equal(toDateInput(d), "2026-03-01");
    assert.equal(toTimeInput(d), "07:05");
  });
});

describe("parseDateParam", () => {
  it("liefert den Tagesbeginn des angegebenen Tages", () => {
    const d = parseDateParam("2026-11-05");
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 5, 0, 0]);
  });

  it("fällt bei fehlendem oder ungültigem Wert auf heute zurück", () => {
    const today = parseDateParam(undefined);
    assert.equal(toDateInput(today), todayInput());
    for (const bad of ["", "2026-02-30", "quatsch", "05.11.2026"]) assert.equal(toDateInput(parseDateParam(bad)), todayInput(), bad);
  });
});

describe("parseMonthParam", () => {
  it("liefert den Monatsersten", () => {
    const d = parseMonthParam("2026-02");
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 1, 1]);
  });

  it("fällt bei ungültigem Wert auf den aktuellen Monat zurück", () => {
    const now = nowDate();
    for (const bad of [undefined, "", "2026-13", "2026-00", "2026-1", "2026-02-01", "x"]) {
      const d = parseMonthParam(bad);
      assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [now.getFullYear(), now.getMonth(), 1], String(bad));
    }
  });
});

describe("Gegenwart", () => {
  it("currentYear/todayInput/nowDate stimmen mit der Uhr überein", () => {
    assert.equal(currentYear(), new Date().getFullYear());
    assert.match(todayInput(), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Math.abs(nowDate().getTime() - Date.now()) < 1000);
  });
});
