import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { costPerKm, currentMileage, fleetDues, nextLicenseCheck } from "./domain";
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
  test("Kosten pro km", () => {
    assert.equal(costPerKm(50000, [{ km: 1000 }, { km: 3000 }]), 25);
    assert.equal(costPerKm(50000, [{ km: 1000 }]), null);
    assert.equal(costPerKm(50000, [{ km: 1000 }, { km: 1000 }]), null);
  });
  test("nächste Führerscheinkontrolle nach 6 Monaten", () => {
    assert.equal(nextLicenseCheck(new Date("2026-08-31T12:00:00")).toISOString().slice(0, 10), "2027-02-28");
  });
});
