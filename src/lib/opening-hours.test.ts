import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withWorkshopZone } from "@/test/zone";
import { noon } from "./zone";
import { DEFAULT_OPENING_HOURS, isValidTime, parseOpeningHours, weekdayKey } from "./opening-hours";

/** Öffnungszeiten (als JSON in den Werkstatt-Einstellungen): defensiv gelesen, Wochentage aus Datum. */
describe("parseOpeningHours", () => {
  it("leere oder fehlende Einstellung = Standardzeiten (noch nie konfiguriert)", () => {
    for (const empty of [null, undefined, "", "{}"]) assert.deepEqual(parseOpeningHours(empty), DEFAULT_OPENING_HOURS);
  });

  it("liefert eine Kopie, nicht das geteilte Standardobjekt", () => {
    const a = parseOpeningHours(null);
    a.mon = null;
    assert.notEqual(DEFAULT_OPENING_HOURS.mon, null);
  });

  it("kaputtes JSON und Nicht-Objekte ergeben die Standardzeiten", () => {
    for (const bad of ["{", "kein json", "[]", "null", "42", '"text"']) assert.deepEqual(parseOpeningHours(bad), DEFAULT_OPENING_HOURS, bad);
  });

  it("übernimmt gültige Zeiten; nicht genannte oder ungültige Tage sind geschlossen", () => {
    const hours = parseOpeningHours(JSON.stringify({ mon: ["08:00", "12:30"], tue: ["8:00", "12:00"], wed: ["08:00"], thu: ["25:00", "26:00"], fri: null, sat: "08:00-12:00" }));
    assert.deepEqual(hours.mon, ["08:00", "12:30"]);
    for (const day of ["tue", "wed", "thu", "fri", "sat", "sun"] as const) assert.equal(hours[day], null, day);
  });
});

describe("isValidTime", () => {
  it("akzeptiert HH:MM von 00:00 bis 23:59", () => {
    for (const ok of ["00:00", "07:30", "12:59", "23:59"]) assert.equal(isValidTime(ok), true, ok);
  });
  it("lehnt alles andere ab", () => {
    for (const bad of ["24:00", "7:30", "07:60", "0730", "07:30:00", "", " 07:30", "ab:cd"]) assert.equal(isValidTime(bad), false, bad);
  });
});

describe("weekdayKey", () => {
  it("Montag bis Sonntag (die Woche beginnt am Montag)", () => {
    const expected = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    for (let i = 0; i < 7; i++) assert.equal(weekdayKey(noon(`2026-11-0${2 + i}`, "Europe/Berlin"), "Europe/Berlin"), expected[i]); // 2. November 2026 ist ein Montag
  });

  it("der Wochentag zählt in der Zone der Werkstatt, nicht in der des Prozesses", () =>
    withWorkshopZone("Europe/Berlin", () => {
      const lateSaturdayUtc = new Date("2030-06-01T22:30:00Z"); // Samstag in UTC, in Berlin schon Sonntag 00:30
      assert.equal(weekdayKey(lateSaturdayUtc), "sun");
      assert.equal(weekdayKey(lateSaturdayUtc, "UTC"), "sat");
    }));
});
