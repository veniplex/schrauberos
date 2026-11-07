import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { withWorkshopZone } from "@/test/zone";
import {
  addDays,
  addDaysToKey,
  addMonths,
  dayKey,
  daysBetweenKeys,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  getDay,
  getISOWeek,
  isSameDay,
  isValidTimeZone,
  minutesOfDay,
  monthKeyOf,
  noon,
  parseZoned,
  resetWorkshopZone,
  setWorkshopZone,
  startOfDay,
  startOfMonth,
  startOfWeek,
  timeKey,
  wallOf,
  weekdayOfKey,
  workshopZone,
} from "./zone";

/**
 * Datum und Uhrzeit in der Zeitzone der Werkstatt (nicht des Prozesses): Testmatrix Berlin, Zürich, UTC, Auckland an den Umstellungstagen (letzter Sonntag im März/Oktober),
 * Speicherung von Kalendertagen um 12 Uhr und Termine über Mitternacht. Alle Rechnungen geben die Zone ausdrücklich an; die Invarianz-Tests wiederholen sie unter
 * verschiedenen Prozess-Zeitzonen (`TZ`) – das Ergebnis darf sich nicht ändern.
 */
const iso = (d: Date) => d.toISOString();
const BERLIN = "Europe/Berlin";
const ZURICH = "Europe/Zurich";
const UTC = "UTC";
const AUCKLAND = "Pacific/Auckland";

afterEach(() => resetWorkshopZone());

describe("Zone: Werkstatt-Zone setzen", () => {
  it("kennt gültige und ungültige Namen; ein ungültiger ändert nichts", () => {
    assert.equal(isValidTimeZone(BERLIN), true);
    assert.equal(isValidTimeZone("UTC"), true);
    for (const bad of ["Mars/Olympus", "", "Berlin"]) assert.equal(isValidTimeZone(bad), false, bad);
    assert.equal(setWorkshopZone(ZURICH), true);
    assert.equal(workshopZone(), ZURICH);
    assert.equal(setWorkshopZone("Mars/Olympus"), false);
    assert.equal(workshopZone(), ZURICH);
  });

  it("ohne gesetzte Zone gilt der Rückfall (Prozess-Zone); mit gesetzter Zone nie die des Prozesses", async () => {
    await withWorkshopZone(BERLIN, () => {
      assert.equal(workshopZone(), BERLIN);
      assert.equal(process.env.TZ, "Pacific/Auckland");
      assert.equal(dayKey(new Date("2030-06-01T22:30:00Z")), "2030-06-02");
    });
  });
});

describe("Zone: Wandzeit, Tag und Wochentag", () => {
  const at = new Date("2030-06-01T22:30:00Z"); // Samstag 22:30 UTC

  it("derselbe Zeitpunkt ist je Zone ein anderer Tag (Mitternachtsfenster)", () => {
    assert.deepEqual([dayKey(at, UTC), timeKey(at, UTC), getDay(at, UTC)], ["2030-06-01", "22:30", 6]);
    assert.deepEqual([dayKey(at, BERLIN), timeKey(at, BERLIN), getDay(at, BERLIN)], ["2030-06-02", "00:30", 0]);
    assert.deepEqual([dayKey(at, ZURICH), timeKey(at, ZURICH), getDay(at, ZURICH)], ["2030-06-02", "00:30", 0]);
    assert.deepEqual([dayKey(at, AUCKLAND), timeKey(at, AUCKLAND)], ["2030-06-02", "10:30"]);
    assert.equal(monthKeyOf(new Date("2030-03-31T23:30:00Z"), BERLIN), "2030-04");
    assert.equal(monthKeyOf(new Date("2030-03-31T23:30:00Z"), UTC), "2030-03");
  });

  it("Termin über Mitternacht: andere Tage, Minuten ab Mitternacht", () => {
    const start = new Date("2030-06-03T21:30:00Z"); // 23:30 Berlin
    const end = new Date("2030-06-03T22:30:00Z"); // 00:30 Berlin am Folgetag
    assert.equal(isSameDay(start, end, BERLIN), false);
    assert.equal(isSameDay(start, end, UTC), true);
    assert.deepEqual([minutesOfDay(start, BERLIN), minutesOfDay(end, BERLIN)], [23 * 60 + 30, 30]);
  });

  it("Wochentag und Tagesrechnung auf Kalendertagen sind zonenfrei", () => {
    assert.equal(weekdayOfKey("2030-03-31"), 0); // Sonntag
    assert.equal(weekdayOfKey("2030-04-01"), 1);
    assert.equal(addDaysToKey("2030-02-28", 1), "2030-03-01");
    assert.equal(addDaysToKey("2028-02-28", 1), "2028-02-29");
    assert.equal(addDaysToKey("2030-01-01", -1), "2029-12-31");
    assert.equal(daysBetweenKeys("2030-03-30", "2030-04-02"), 3);
  });

  it("ISO-Kalenderwoche (Jahreswechsel)", () => {
    const week = (key: string) => getISOWeek(noon(key, BERLIN), BERLIN);
    assert.deepEqual([week("2026-01-01"), week("2020-12-31"), week("2021-01-03"), week("2021-01-04"), week("2030-12-30"), week("2026-11-05")], [1, 53, 53, 1, 1, 45]);
  });
});

describe("Zone: Sommerzeit-Grenzen (letzter Sonntag im März und Oktober)", () => {
  for (const zone of [BERLIN, ZURICH]) {
    it(`${zone}: der Tag der Umstellung auf Sommerzeit hat 23 Stunden, der der Umstellung auf Winterzeit 25`, () => {
      assert.equal(iso(startOfDay("2030-03-31", zone)), "2030-03-30T23:00:00.000Z");
      assert.equal(iso(startOfDay("2030-04-01", zone)), "2030-03-31T22:00:00.000Z");
      assert.equal(iso(startOfDay("2030-10-27", zone)), "2030-10-26T22:00:00.000Z");
      assert.equal(iso(startOfDay("2030-10-28", zone)), "2030-10-27T23:00:00.000Z");
      assert.equal(iso(endOfDay("2030-10-27", zone)), "2030-10-27T22:59:59.999Z");
      // Kalendertage zwischen Mitternachten zählen als 1, obwohl der Abstand 23 bzw. 25 Stunden beträgt
      assert.equal(differenceInCalendarDays(startOfDay("2030-04-01", zone), startOfDay("2030-03-31", zone), zone), 1);
      assert.equal(differenceInCalendarDays(startOfDay("2030-10-28", zone), startOfDay("2030-10-27", zone), zone), 1);
    });

    it(`${zone}: addDays behält die Uhrzeit über die Umstellung`, () => {
      const before = parseZoned("2030-03-30", "09:00", zone)!;
      assert.equal(iso(before), "2030-03-30T08:00:00.000Z"); // MEZ
      assert.equal(iso(addDays(before, 1, zone)), "2030-03-31T07:00:00.000Z"); // MESZ: 09:00 bleibt 09:00
      const autumn = parseZoned("2030-10-26", "09:00", zone)!;
      assert.equal(iso(addDays(autumn, 1, zone)), "2030-10-27T08:00:00.000Z");
      assert.equal(iso(addDays(autumn, 2, zone)), "2030-10-28T08:00:00.000Z"); // MEZ
    });

    it(`${zone}: eine Wandzeit in der Lücke gibt es nicht (Eingabe abgelehnt), die doppelte gilt einmal`, () => {
      assert.equal(parseZoned("2030-03-31", "02:30", zone), null);
      assert.equal(iso(parseZoned("2030-03-31", "03:00", zone)!), "2030-03-31T01:00:00.000Z");
      assert.equal(iso(parseZoned("2030-03-31", "01:59", zone)!), "2030-03-31T00:59:00.000Z");
      // 02:30 am 27.10. gibt es zweimal: der erste Zeitpunkt (noch Sommerzeit) gilt
      assert.equal(iso(parseZoned("2030-10-27", "02:30", zone)!), "2030-10-27T00:30:00.000Z");
    });

    it(`${zone}: Woche über die Umstellung – Montag 00:00 bis Montag 00:00`, () => {
      const monday = startOfWeek("2030-03-31", { weekStartsOn: 1 }, zone); // der Sonntag gehört zur Woche ab Montag, 25.3.
      assert.equal(dayKey(monday, zone), "2030-03-25");
      assert.equal(iso(monday), "2030-03-24T23:00:00.000Z");
      const days = eachDayOfInterval({ start: startOfDay("2030-03-29", zone), end: startOfDay("2030-04-01", zone) }, zone).map((d) => dayKey(d, zone));
      assert.deepEqual(days, ["2030-03-29", "2030-03-30", "2030-03-31", "2030-04-01"]);
    });
  }

  it("UTC kennt keine Lücke", () => {
    assert.equal(iso(parseZoned("2030-03-31", "02:30", UTC)!), "2030-03-31T02:30:00.000Z");
    assert.equal(iso(startOfDay("2030-03-31", UTC)), "2030-03-31T00:00:00.000Z");
  });

  it("Monate: addMonths rückt auf den letzten Tag des Zielmonats; Monatsgrenzen in der Zone", () => {
    assert.equal(dayKey(addMonths(noon("2030-01-31", BERLIN), 1, BERLIN), BERLIN), "2030-02-28");
    assert.equal(dayKey(addMonths(noon("2030-03-31", BERLIN), -1, BERLIN), BERLIN), "2030-02-28");
    assert.equal(dayKey(addMonths(noon("2030-11-15", BERLIN), 3, BERLIN), BERLIN), "2031-02-15");
    assert.equal(iso(startOfMonth("2030-04-17", BERLIN)), "2030-03-31T22:00:00.000Z");
    assert.equal(iso(endOfMonth("2030-03-10", BERLIN)), "2030-03-31T21:59:59.999Z");
  });
});

describe("Zone: Kalendertage werden um 12 Uhr der Werkstatt-Zone gespeichert (noon)", () => {
  it("der gespeicherte Tag bleibt in der Werkstatt-Zone derselbe – auch im Sommer, im Winter und in Auckland", () => {
    for (const zone of [BERLIN, ZURICH, UTC, AUCKLAND, "America/New_York"]) {
      for (const day of ["2030-01-15", "2030-03-31", "2030-06-15", "2030-10-27", "2030-12-31"]) {
        const stored = noon(day, zone);
        assert.equal(dayKey(stored, zone), day, `${zone} ${day}`);
        assert.equal(timeKey(stored, zone), "12:00", `${zone} ${day}`);
      }
    }
  });

  it("Auckland im Januar: Mittag Ortszeit ist am Vortag in UTC – deshalb wird in der Werkstatt-Zone gelesen, nicht in UTC", () => {
    const stored = noon("2030-01-15", AUCKLAND);
    assert.equal(iso(stored), "2030-01-14T23:00:00.000Z");
    assert.equal(dayKey(stored, AUCKLAND), "2030-01-15");
    assert.equal(dayKey(stored, UTC), "2030-01-14");
  });

  it("Berlin: 12:00 ist im Sommer 10:00 UTC, im Winter 11:00 UTC", () => {
    assert.equal(iso(noon("2030-06-15", BERLIN)), "2030-06-15T10:00:00.000Z");
    assert.equal(iso(noon("2030-12-15", BERLIN)), "2030-12-15T11:00:00.000Z");
  });
});

describe("Zone: Eingaben", () => {
  it("lehnt ungültige Tage und Uhrzeiten ab", () => {
    for (const [day, time] of [["2030-02-30", "09:00"], ["2030-13-01", "09:00"], ["2030-11-05", "25:00"], ["2030-11-05", "09:60"], ["heute", "09:00"], ["", ""], ["2030-11-05", "9"]]) {
      assert.equal(parseZoned(day, time, BERLIN), null, `${day} ${time}`);
    }
    assert.ok(parseZoned("2028-02-29", "10:00", BERLIN));
    assert.equal(parseZoned("2027-02-29", "10:00", BERLIN), null);
  });
});

describe("Zone: unabhängig von der Prozess-Zeitzone (TZ)", () => {
  /** Eine Reihe von Rechnungen, die nur von der Werkstatt-Zone abhängen. */
  const battery = () => {
    const at = new Date("2030-03-31T00:30:00Z");
    return [
      dayKey(at),
      timeKey(at),
      getDay(at),
      iso(startOfDay("2030-03-31")),
      iso(endOfDay("2030-03-31")),
      iso(noon("2030-03-31")),
      iso(addDays(at, 1)),
      iso(startOfWeek(at, { weekStartsOn: 1 })),
      iso(parseZoned("2030-03-31", "03:00")!),
      String(parseZoned("2030-03-31", "02:30")),
      monthKeyOf(at),
      getISOWeek(at),
      wallOf(at).hour,
      iso(addMonths(at, 1)),
    ];
  };

  it("das Ergebnis ändert sich nicht, wenn die Prozess-Zeitzone wechselt", async () => {
    const results: string[] = [];
    for (const processZone of ["UTC", "Asia/Tokyo", "America/Los_Angeles", AUCKLAND, "Europe/London"]) {
      results.push(JSON.stringify(await withWorkshopZone(BERLIN, battery, processZone)));
    }
    assert.equal(new Set(results).size, 1, results.join("\n"));
    // und es ist die Berliner Rechnung (Umstellungstag, 01:30 MEZ → 00:30Z ist 01:30 Ortszeit)
    const [dayK, timeK, weekday, startK] = JSON.parse(results[0]);
    assert.deepEqual([dayK, timeK, weekday, startK], ["2030-03-31", "01:30", 0, "2030-03-30T23:00:00.000Z"]);
  });

  it("die Werkstatt-Zone wechselt wirklich das Ergebnis (nicht still die Prozess-Zone)", async () => {
    const berlin = await withWorkshopZone(BERLIN, battery, UTC);
    const utc = await withWorkshopZone(UTC, battery, UTC);
    assert.notDeepEqual(berlin, utc);
  });
});
