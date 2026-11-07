import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { costPerKm, costPeriod, costsInPeriod, currentMileage, fleetDues, nextLicenseCheck } from "./domain";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/money";

describe("parseMoneyToCents", () => {
  test("deutsche und englische Schreibweisen", () => {
    assert.equal(parseMoneyToCents("1.234,56"), 123456);
    assert.equal(parseMoneyToCents("1234,5"), 123450);
    assert.equal(parseMoneyToCents("12.50"), 1250);
    assert.equal(parseMoneyToCents("1,234.56"), 123456);
    assert.equal(parseMoneyToCents("1 234,56 €"), 123456);
    assert.equal(parseMoneyToCents("19"), 1900);
  });
  test("Tausenderpunkt vs. Dezimalpunkt", () => {
    assert.equal(parseMoneyToCents("1.234"), 123400);
    assert.equal(parseMoneyToCents("12.345.678"), 1234567800);
    assert.equal(parseMoneyToCents("0.5"), 50);
  });
  test("negativ (Gutschrift)", () => assert.equal(parseMoneyToCents("-20,00"), -2000));
  test("ungültig", () => {
    for (const bad of ["", "abc", "1,2,3", "12,345", "--1"]) assert.equal(parseMoneyToCents(bad), null, bad);
  });
  test("kein Gleitkomma-Fehler (0,1 + 0,2)", () => {
    assert.equal(parseMoneyToCents("0,10")! + parseMoneyToCents("0,20")!, 30);
    assert.equal(parseMoneyToCents("1,005"), null);
  });
});

describe("Geld formatieren", () => {
  test("EUR in de-DE", () => assert.match(formatCents(123456), /1\.234,56\s€/));
  test("Eingabefeld", () => {
    assert.equal(centsToInput(123456), "1234,56");
    assert.equal(centsToInput(null), "");
  });
});

describe("fleetDues", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const base = { huDue: null, serviceDue: null, serviceDueKm: null, insuranceUntil: null, leasingUntil: null };
  test("nichts fällig", () => assert.deepEqual(fleetDues({ ...base, huDue: new Date("2027-11-01") }, 10000, now), []));
  test("abgelaufen vor bald, Datum sortiert", () => {
    const d = fleetDues({ ...base, huDue: new Date("2026-12-01"), insuranceUntil: new Date("2026-10-01"), leasingUntil: new Date("2026-11-20") }, null, now);
    assert.deepEqual(d.map((x) => [x.kind, x.state]), [["insurance", "expired"], ["leasing", "soon"], ["hu", "soon"]]);
  });
  test("Wartung nach Kilometern", () => {
    assert.equal(fleetDues({ ...base, serviceDueKm: 60000 }, 58000, now).length, 0);
    assert.deepEqual(fleetDues({ ...base, serviceDueKm: 60000 }, 59000, now).map((x) => [x.kind, x.state, x.kmLeft]), [["serviceKm", "soon", 1000]]);
    assert.equal(fleetDues({ ...base, serviceDueKm: 60000 }, 61000, now)[0].state, "expired");
    assert.equal(fleetDues({ ...base, serviceDueKm: 60000 }, null, now).length, 0);
  });
});

describe("Kilometer & Kosten", () => {
  test("aktueller Stand = Maximum", () => {
    assert.equal(currentMileage([{ km: 100 }, { km: 900 }, { km: 500 }]), 900);
    assert.equal(currentMileage([]), null);
  });
  const day = (s: string) => new Date(`${s}T12:00:00Z`);
  const cost = (s: string, amountCents: number) => ({ date: day(s), amountCents });

  test("Kostenzeitraum: vom ersten bis zum letzten Kilometerstand nach Datum (nicht nach Höhe), mit den gefahrenen Kilometern", () => {
    assert.deepEqual(costPeriod([{ date: day("2026-03-01"), km: 3000 }, { date: day("2026-01-01"), km: 1000 }, { date: day("2026-02-01"), km: 2000 }]), { from: day("2026-01-01"), to: day("2026-03-01"), km: 2000 });
    assert.equal(costPeriod([{ date: day("2026-01-01"), km: 1000 }]), null, "ein Stand genügt nicht");
    assert.equal(costPeriod([{ date: day("2026-01-01"), km: 1000 }, { date: day("2026-01-01"), km: 1500 }]), null, "derselbe Tag: kein Zeitraum");
    assert.equal(costPeriod([{ date: day("2026-01-01"), km: 1000 }, { date: day("2026-02-01"), km: 1000 }]), null, "nichts gefahren");
    assert.equal(costPeriod([{ date: day("2026-01-01"), km: 2000 }, { date: day("2026-02-01"), km: 1000 }]), null, "Stand sinkt (Tachotausch): keine gefahrenen km");
  });

  test("Kosten pro km nur über den Kostenzeitraum: Kosten davor und danach zählen nicht", () => {
    const period = costPeriod([{ date: day("2026-01-01"), km: 1000 }, { date: day("2026-03-01"), km: 3000 }]);
    assert.ok(period);
    const costs = [cost("2025-12-31", 900_000), cost("2026-01-01", 10_000), cost("2026-02-15", 30_000), cost("2026-03-01", 10_000), cost("2026-03-02", 700_000)];
    assert.equal(costsInPeriod(costs, period), 50_000, "beide Randtage zählen, die Anschaffung davor und die Rechnung danach nicht");
    assert.equal(costPerKm(costs, period), 25, "50.000 Cent / 2.000 km");
    assert.equal(costPerKm(costs, null), null);
    assert.equal(costPerKm([], period), 0, "ohne Kosten im Zeitraum 0 pro km");
  });

  test("Kosten pro km: der Alt-Fehler – alle Kosten durch alle Kilometer – kommt nicht mehr vor", () => {
    // 1.000 € Anschaffung vor dem ersten Stand, im Zeitraum 100 € für 500 km
    const period = costPeriod([{ date: day("2026-02-01"), km: 10_000 }, { date: day("2026-04-01"), km: 10_500 }]);
    const costs = [cost("2026-01-05", 100_000), cost("2026-03-01", 10_000)];
    assert.equal(costPerKm(costs, period), 20, "10.000 Cent / 500 km = 20 Cent/km (nicht 110.000 / 500)");
  });
  test("nächste Führerscheinkontrolle nach 6 Monaten", () => {
    assert.equal(nextLicenseCheck(new Date("2026-08-31T12:00:00")).toISOString().slice(0, 10), "2027-02-28");
  });
});
