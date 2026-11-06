import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseTireRows } from "./domain";

describe("parseTireRows (Reifenzeilen aus dem Formular)", () => {
  const row = { dot: "2321", tread: "6,5", condition: "good" };
  const now = new Date("2026-06-01T12:00:00Z");

  test("ohne Ersatzrad vier Positionen, mit Ersatzrad fünf", () => {
    assert.deepEqual(parseTireRows({}, false, now).tires.map((t) => t.position), ["FL", "FR", "RL", "RR"]);
    assert.deepEqual(parseTireRows({}, true, now).tires.map((t) => t.position), ["FL", "FR", "RL", "RR", "SPARE"]);
  });
  test("liest DOT, Profil (Komma erlaubt) und Zustand; Messzeit nur mit Profilwert", () => {
    const { tires, errors } = parseTireRows({ FL: row, FR: { condition: "worn" } }, false, now);
    assert.deepEqual(errors, {});
    assert.deepEqual(tires[0], { position: "FL", dot: "2321", producedWeek: 23, producedYear: 2021, treadDepthMm: 6.5, condition: "good", measuredAt: now });
    assert.deepEqual(tires[1], { position: "FR", dot: null, producedWeek: null, producedYear: null, treadDepthMm: null, condition: "worn", measuredAt: null });
  });
  test("unbekannter Zustand wird „gut“, fehlender auch", () => {
    const { tires } = parseTireRows({ FL: { condition: "kaputt" }, FR: {} }, false, now);
    assert.equal(tires[0].condition, "good");
    assert.equal(tires[1].condition, "good");
  });
  test("meldet ungültiges und zukünftiges DOT je Feld (Vertipper wie 1234 = Woche 12/2034)", () => {
    const { errors } = parseTireRows({ FL: { dot: "99" }, FR: { dot: "1234" }, RL: { dot: "5421" }, RR: { dot: "2326" } }, false, now);
    assert.deepEqual(errors, { "tire.FL.dot": "dot", "tire.FR.dot": "dot", "tire.RL.dot": "dot" });
  });
  test("meldet Profiltiefen außerhalb 0–15 mm und Nichtzahlen; die Grenzen selbst sind gültig", () => {
    const { errors } = parseTireRows({ FL: { tread: "15,1" }, FR: { tread: "-1" }, RL: { tread: "abc" }, RR: { tread: "0" } }, false, now);
    assert.deepEqual(errors, { "tire.FL.tread": "tread", "tire.FR.tread": "tread", "tire.RL.tread": "tread" });
    assert.deepEqual(parseTireRows({ FL: { tread: "15" } }, false, now).errors, {});
  });
  test("Zeilen des Ersatzrads werden ohne Ersatzrad nicht geprüft", () => {
    assert.deepEqual(parseTireRows({ SPARE: { dot: "kaputt" } }, false, now).errors, {});
    assert.deepEqual(parseTireRows({ SPARE: { dot: "kaputt" } }, true, now).errors, { "tire.SPARE.dot": "dot" });
  });
});
