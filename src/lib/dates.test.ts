import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withWorkshopZone } from "@/test/zone";
import { currentYear, nowDate, noon, parseDateParam, parseLocalDateTime, parseMonthParam, toDateInput, toTimeInput, todayInput } from "./dates";
import { wallOf } from "./zone";

/**
 * Datum/Uhrzeit-Hilfen: Eingaben der Formulare und URL-Parameter werden defensiv gelesen – in der **Zeitzone der Werkstatt** (hier Europe/Berlin), während der Prozess
 * in Pacific/Auckland läuft (`withWorkshopZone`): Wer von `TZ` abhängt, scheitert.
 */
const inBerlin = <T>(fn: () => T | Promise<T>) => withWorkshopZone("Europe/Berlin", fn);
const parts = (d: Date) => {
  const w = wallOf(d, "Europe/Berlin");
  return [w.year, w.month - 1, w.day, w.hour, w.minute];
};

describe("parseLocalDateTime", () => {
  it("liest Datum und Uhrzeit als Zeit der Werkstatt", () =>
    inBerlin(() => {
      const d = parseLocalDateTime("2026-11-05", "09:30");
      assert.ok(d);
      assert.equal(d.toISOString(), "2026-11-05T08:30:00.000Z"); // MEZ
      assert.deepEqual(parts(d), [2026, 10, 5, 9, 30]);
    }));

  it("lehnt ungültige Angaben ab (kein 30. Februar, keine 25. Stunde, kein Text)", () =>
    inBerlin(() => {
      for (const [date, time] of [["2026-02-30", "09:00"], ["2026-13-01", "09:00"], ["2026-11-05", "25:00"], ["2026-11-05", "09:60"], ["heute", "09:00"], ["", ""], ["2026-11-05", "9"]]) {
        assert.equal(parseLocalDateTime(date, time), null, `${date} ${time}`);
      }
    }));

  it("Schaltjahr: 29. Februar nur im Schaltjahr", () =>
    inBerlin(() => {
      assert.ok(parseLocalDateTime("2028-02-29", "10:00"));
      assert.equal(parseLocalDateTime("2027-02-29", "10:00"), null);
    }));

  it("lehnt die Lücke der Sommerzeitumstellung ab", () =>
    inBerlin(() => {
      assert.equal(parseLocalDateTime("2030-03-31", "02:30"), null);
      assert.ok(parseLocalDateTime("2030-03-31", "03:30"));
    }));

  it("toDateInput/toTimeInput sind die Umkehrung (Formularwerte)", () =>
    inBerlin(() => {
      const d = parseLocalDateTime("2026-03-01", "07:05")!;
      assert.equal(toDateInput(d), "2026-03-01");
      assert.equal(toTimeInput(d), "07:05");
    }));

  it("die Zone lässt sich ausdrücklich angeben und gewinnt gegen die Werkstatt-Zone", () =>
    inBerlin(() => {
      const d = parseLocalDateTime("2026-11-05", "09:30", "UTC")!;
      assert.equal(d.toISOString(), "2026-11-05T09:30:00.000Z");
      assert.equal(toDateInput(d, "Pacific/Auckland"), "2026-11-05");
      assert.equal(toTimeInput(d, "Pacific/Auckland"), "22:30");
    }));
});

describe("noon: Kalendertage werden um 12 Uhr der Werkstatt-Zone gespeichert", () => {
  it("der Tag bleibt beim Lesen derselbe – unabhängig von der Prozess-Zone", () =>
    inBerlin(() => {
      assert.equal(noon("2030-06-15").toISOString(), "2030-06-15T10:00:00.000Z");
      assert.equal(toDateInput(noon("2030-06-15")), "2030-06-15");
      assert.equal(noon("2030-12-15").toISOString(), "2030-12-15T11:00:00.000Z");
    }));
});

describe("parseDateParam", () => {
  it("liefert den Tagesbeginn des angegebenen Tages", () =>
    inBerlin(() => {
      const d = parseDateParam("2026-11-05");
      assert.equal(d.toISOString(), "2026-11-04T23:00:00.000Z");
      assert.deepEqual(parts(d), [2026, 10, 5, 0, 0]);
    }));

  it("fällt bei fehlendem oder ungültigem Wert auf heute (Werkstatt-Zone) zurück", () =>
    inBerlin(() => {
      const now = new Date("2030-06-01T22:30:00Z"); // in Berlin schon der 2.6., in Auckland der 2.6., in UTC noch der 1.6.
      assert.equal(toDateInput(parseDateParam(undefined, now)), "2030-06-02");
      for (const bad of ["", "2026-02-30", "quatsch", "05.11.2026"]) assert.equal(toDateInput(parseDateParam(bad, now)), "2030-06-02", bad);
    }));
});

describe("parseMonthParam", () => {
  it("liefert den Monatsersten", () =>
    inBerlin(() => {
      const d = parseMonthParam("2026-02");
      assert.deepEqual(parts(d), [2026, 1, 1, 0, 0]);
    }));

  it("fällt bei ungültigem Wert auf den aktuellen Monat der Werkstatt zurück", () =>
    inBerlin(() => {
      const now = new Date("2030-03-31T23:30:00Z"); // in Berlin schon April
      for (const bad of [undefined, "", "2026-13", "2026-00", "2026-1", "2026-02-01", "x"]) {
        assert.deepEqual(parts(parseMonthParam(bad, now)), [2030, 3, 1, 0, 0], String(bad));
      }
    }));
});

describe("Gegenwart", () => {
  it("currentYear/todayInput/nowDate stimmen mit der Uhr überein; Jahreswechsel nach Werkstatt-Zone", () =>
    inBerlin(() => {
      assert.match(todayInput(), /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Math.abs(nowDate().getTime() - Date.now()) < 1000);
      const newYearsEve = new Date("2030-12-31T23:30:00Z"); // Berlin: schon 2031
      assert.equal(currentYear(newYearsEve), 2031);
      assert.equal(currentYear(newYearsEve, "UTC"), 2030);
      assert.equal(todayInput(newYearsEve), "2031-01-01");
    }));
});
