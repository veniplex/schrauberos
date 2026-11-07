import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COUNTRIES, NO_HOLIDAYS, createHolidayCalendar, easterKey, easterSunday, easterSundayGauss, holidayOnDate, holidaysInYear, isHolidayRegion, regionsOf, statutoryDays, type HolidayConfig } from "./holidays";

/** Ostersonntage 2000–2050 und die äußersten Grenzen des Kalenders (22. März / 25. April), aus den veröffentlichten Osterdaten. */
const KNOWN_EASTER: Record<number, string> = {
  2000: "2000-04-23", 2001: "2001-04-15", 2002: "2002-03-31", 2003: "2003-04-20", 2004: "2004-04-11", 2005: "2005-03-27", 2006: "2006-04-16", 2007: "2007-04-08",
  2008: "2008-03-23", 2009: "2009-04-12", 2010: "2010-04-04", 2011: "2011-04-24", 2012: "2012-04-08", 2013: "2013-03-31", 2014: "2014-04-20", 2015: "2015-04-05",
  2016: "2016-03-27", 2017: "2017-04-16", 2018: "2018-04-01", 2019: "2019-04-21", 2020: "2020-04-12", 2021: "2021-04-04", 2022: "2022-04-17", 2023: "2023-04-09",
  2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16", 2029: "2029-04-01", 2030: "2030-04-21", 2031: "2031-04-13",
  2032: "2032-03-28", 2033: "2033-04-17", 2034: "2034-04-09", 2035: "2035-03-25", 2036: "2036-04-13", 2037: "2037-04-05", 2038: "2038-04-25", 2039: "2039-04-10",
  2040: "2040-04-01", 2041: "2041-04-21", 2042: "2042-04-06", 2043: "2043-03-29", 2044: "2044-04-17", 2045: "2045-04-09", 2046: "2046-03-25", 2047: "2047-04-14",
  2048: "2048-04-05", 2049: "2049-04-18", 2050: "2050-04-10",
  // früheste und späteste Lage, und die Jahre der Sonderregeln der Gaußschen Formel (18. und 19. April)
  1818: "1818-03-22", 1943: "1943-04-25", 1886: "1886-04-25", 2285: "2285-03-22", 1981: "1981-04-19", 1954: "1954-04-18"
};

describe("Ostern", () => {
  it("stimmt mit den bekannten Osterdaten überein", () => {
    for (const [year, expected] of Object.entries(KNOWN_EASTER)) assert.equal(easterKey(Number(year)), expected, year);
  });

  it("die Berechnung nach Meeus/Jones/Butcher und die Gaußsche Formel stimmen von 1583 bis 2600 überein", () => {
    for (let year = 1583; year <= 2600; year++) assert.deepEqual(easterSundayGauss(year), easterSunday(year), String(year));
  });

  it("Ostern liegt immer zwischen dem 22. März und dem 25. April und auf einem Sonntag", () => {
    for (let year = 1583; year <= 2600; year++) {
      const { month, day } = easterSunday(year);
      const value = month * 100 + day;
      assert.ok(value >= 322 && value <= 425, String(year));
      assert.equal(new Date(Date.UTC(year, month - 1, day)).getUTCDay(), 0, String(year));
    }
  });
});

const day = (config: HolidayConfig, year: number) => holidaysInYear(year, config).map((h) => `${h.day}:${h.key}`);

describe("Regionen", () => {
  it("Deutschland hat 16 Länder, Österreich 9, die Schweiz 26", () => {
    assert.deepEqual(COUNTRIES.map((c) => regionsOf(c).length), [16, 9, 26]);
    assert.ok(isHolidayRegion("DE-NW") && isHolidayRegion("AT-9") && isHolidayRegion("CH-ZH"));
    assert.ok(!isHolidayRegion("") && !isHolidayRegion("DE-XX") && !isHolidayRegion("FR-75") && !isHolidayRegion("AT-0"));
  });

  it("ohne Region gibt es keine Feiertage", () => {
    assert.deepEqual(holidaysInYear(2026, NO_HOLIDAYS), []);
    assert.equal(createHolidayCalendar(NO_HOLIDAYS).on("2026-12-25"), null);
  });
});

describe("Feiertage Deutschland", () => {
  it("Nordrhein-Westfalen 2026", () => {
    const days = day({ ...NO_HOLIDAYS, region: "DE-NW" }, 2026);
    assert.deepEqual(days, [
      "2026-01-01:newYear", "2026-04-03:goodFriday", "2026-04-06:easterMonday", "2026-05-01:labourDay", "2026-05-14:ascension", "2026-05-25:whitMonday",
      "2026-06-04:corpusChristi", "2026-10-03:germanUnity", "2026-11-01:allSaints", "2026-12-25:christmasDay", "2026-12-26:secondChristmasDay",
    ]);
  });

  it("Sachsen: Buß- und Bettag ist der Mittwoch vor dem 23. November, kein Fronleichnam", () => {
    const sn = { ...NO_HOLIDAYS, region: "DE-SN" };
    assert.ok(day(sn, 2025).includes("2025-11-19:repentanceDay"));
    assert.ok(day(sn, 2026).includes("2026-11-18:repentanceDay"));
    // der 23. November selbst ist ein Mittwoch (2022): der Feiertag ist der 16.
    assert.ok(day(sn, 2022).includes("2022-11-16:repentanceDay"));
    assert.ok(!day(sn, 2026).some((d) => d.endsWith("corpusChristi")));
    assert.ok(day(sn, 2026).some((d) => d.endsWith("reformationDay")));
  });

  it("Länderunterschiede: Heilige Drei Könige, Frauentag, Weltkindertag, Brandenburg (Ostern, Pfingsten)", () => {
    const has = (region: string, key: string, year = 2026) => day({ ...NO_HOLIDAYS, region }, year).some((d) => d.endsWith(`:${key}`));
    assert.ok(has("DE-BW", "epiphany") && has("DE-BY", "epiphany") && has("DE-ST", "epiphany") && !has("DE-NW", "epiphany"));
    assert.ok(has("DE-BE", "womensDay") && has("DE-MV", "womensDay") && !has("DE-BB", "womensDay"));
    assert.ok(has("DE-TH", "worldChildrensDay") && !has("DE-SN", "worldChildrensDay"));
    assert.ok(has("DE-BB", "easterSunday") && has("DE-BB", "pentecostSunday") && !has("DE-BE", "easterSunday"));
    assert.ok(has("DE-HH", "reformationDay") && !has("DE-BE", "reformationDay"));
    assert.ok(has("DE-SL", "assumption") && has("DE-BY", "assumption") && !has("DE-HE", "assumption"));
  });

  it("jedes Land hat die neun bundesweiten Feiertage", () => {
    for (const region of regionsOf("DE")) {
      const keys = new Set(day({ ...NO_HOLIDAYS, region }, 2027).map((d) => d.split(":")[1]));
      for (const key of ["newYear", "goodFriday", "easterMonday", "labourDay", "ascension", "whitMonday", "germanUnity", "christmasDay", "secondChristmasDay"]) assert.ok(keys.has(key), `${region} ${key}`);
    }
  });

  it("Bayern: Mariä Himmelfahrt gilt nur in Teilen des Landes", () => {
    const by = holidaysInYear(2026, { ...NO_HOLIDAYS, region: "DE-BY" }).find((h) => h.key === "assumption");
    assert.equal(by?.partial, true);
    assert.equal(holidaysInYear(2026, { ...NO_HOLIDAYS, region: "DE-SL" }).find((h) => h.key === "assumption")?.partial, false);
  });
});

describe("Feiertage Österreich und Schweiz", () => {
  it("Österreich: bundesweite Feiertage ohne Karfreitag; Landesfeiertage sind nur Vorschläge", () => {
    const wien = { ...NO_HOLIDAYS, region: "AT-9" };
    const keys = day(wien, 2026).map((d) => d.split(":")[1]);
    assert.deepEqual(keys, ["newYear", "epiphany", "easterMonday", "labourDay", "ascension", "whitMonday", "corpusChristi", "assumption", "austrianNationalDay", "allSaints", "immaculateConception", "christmasDay", "secondChristmasDay"]);
    assert.ok(!keys.includes("goodFriday") && !keys.includes("stLeopold"));
    // eingeschaltet erscheint der Leopoldi-Tag
    assert.ok(day({ ...wien, rules: { "AT.stLeopold": "on" } }, 2026).includes("2026-11-15:stLeopold"));
    // in einem anderen Bundesland gibt es ihn nicht, auch nicht als Vorschlag
    assert.ok(!statutoryDays(2026, "AT-4").some((s) => s.key === "stLeopold"));
    assert.ok(statutoryDays(2026, "AT-9").find((s) => s.key === "stLeopold")?.optional);
  });

  it("Schweiz: Genfer Bettag, Lundi du Jeûne, Näfelser Fahrt, Karfreitag", () => {
    const ch = (region: string, year: number) => day({ ...NO_HOLIDAYS, region }, year);
    // 2026: erster Sonntag im September = 6.9. → Donnerstag 10.9.; dritter Sonntag = 20.9. → Montag 21.9.
    assert.ok(ch("CH-GE", 2026).includes("2026-09-10:jeuneGeneve"));
    assert.ok(ch("CH-VD", 2026).includes("2026-09-21:lundiJeune"));
    // Näfelser Fahrt 2026: erster Donnerstag im April ist der 2.4. (Karwoche, Ostern 5.4.) → Donnerstag nach Ostern, 9.4.
    assert.ok(ch("CH-GL", 2026).includes("2026-04-09:nafelserFahrt"));
    // 2025: erster Donnerstag 3.4., Ostern 20.4. → bleibt
    assert.ok(ch("CH-GL", 2025).includes("2025-04-03:nafelserFahrt"));
    assert.ok(ch("CH-ZH", 2026).includes("2026-04-03:goodFriday") && !ch("CH-TI", 2026).some((d) => d.endsWith("goodFriday")));
    assert.ok(ch("CH-ZH", 2026).includes("2026-08-01:swissNationalDay") && ch("CH-VS", 2026).includes("2026-08-01:swissNationalDay"));
  });

  it("jede Region hat Neujahr, Auffahrt, den 1. August bzw. Weihnachten", () => {
    for (const region of [...regionsOf("CH")]) {
      const keys = new Set(day({ ...NO_HOLIDAYS, region }, 2026).map((d) => d.split(":")[1]));
      for (const key of ["newYear", "ascension", "swissNationalDay", "christmasDay"]) assert.ok(keys.has(key), `${region} ${key}`);
    }
  });
});

describe("Pflege: Streichen, halbe Tage, eigene Tage", () => {
  const base: HolidayConfig = { ...NO_HOLIDAYS, region: "DE-BY" };

  it("ein gestrichener Tag entfällt, ein halber bleibt als halber Tag", () => {
    const off = createHolidayCalendar({ ...base, rules: { "DE.assumption": "off", "DE.epiphany": "half" } });
    assert.equal(off.on("2026-08-15"), null);
    assert.equal(off.on("2026-01-06")?.half, true);
    assert.equal(off.on("2026-01-01")?.half, false);
  });

  it("eigene Tage: einmalig mit Jahr, jedes Jahr ohne Jahr; halbe Tage; der 29. Februar nur im Schaltjahr", () => {
    const calendar = createHolidayCalendar({
      ...base,
      custom: [
        { id: "a", name: "Heiligabend", month: 12, day: 24, year: null, half: true },
        { id: "b", name: "Betriebsferien", month: 8, day: 3, year: 2026, half: false },
        { id: "c", name: "Schalttag", month: 2, day: 29, year: null, half: false },
      ],
    });
    assert.equal(calendar.on("2026-12-24")?.name, "Heiligabend");
    assert.equal(calendar.on("2026-12-24")?.half, true);
    assert.equal(calendar.on("2027-12-24")?.custom, true);
    assert.equal(calendar.on("2026-08-03")?.name, "Betriebsferien");
    assert.equal(calendar.on("2027-08-03"), null);
    assert.equal(calendar.on("2028-02-29")?.name, "Schalttag");
    assert.equal(calendar.on("2027-02-28"), null);
  });

  it("fällt ein eigener Tag auf einen gesetzlichen, zählt der ganze vor dem halben", () => {
    const calendar = createHolidayCalendar({ ...base, rules: { "DE.newYear": "half" }, custom: [{ id: "x", name: "Neujahrsruhe", month: 1, day: 1, year: null, half: false }] });
    assert.equal(calendar.on("2026-01-01")?.half, false);
    assert.equal(calendar.on("2026-01-01")?.custom, true);
  });

  it("between liefert die Tage im Bereich, auch über den Jahreswechsel", () => {
    const calendar = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW" });
    assert.deepEqual(calendar.between("2026-12-20", "2027-01-05").map((h) => h.day), ["2026-12-25", "2026-12-26", "2027-01-01"]);
    assert.deepEqual(calendar.between("2026-12-31", "2026-12-01"), []);
    assert.equal(calendar.on("kein-datum"), null);
  });

  it("holidayOnDate rechnet in der Zone der Werkstatt (23:30 UTC am Vortag ist in Berlin schon Weihnachten)", () => {
    const calendar = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW" });
    const instant = new Date("2026-12-24T23:30:00Z");
    assert.equal(holidayOnDate(calendar, instant, "Europe/Berlin")?.key, "christmasDay");
    assert.equal(holidayOnDate(calendar, instant, "UTC"), null);
  });
});
