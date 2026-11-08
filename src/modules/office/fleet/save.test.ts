import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Fuhrpark im Aktions-Rahmen: Rechte, Betragsprüfung (Cent), Kilometer-Plausibilität, Versionssperre, Audit. */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

const login = async (permissions: string[]) => {
  const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
  await env.signIn(user);
  return user;
};
const entries = (action: string) => env.db.auditLog.findMany({ where: { action } });
let carId: string;

beforeEach(async () => {
  await env.db.fleetMileage.deleteMany();
  await env.db.fleetCost.deleteMany();
  await env.db.fleetVehicle.deleteMany();
  await env.db.absence.deleteMany();
  await env.db.fleetLicenseCheck.deleteMany();
  await env.db.employee.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
  carId = (await env.db.fleetVehicle.create({ data: { plate: "B XX 1" } })).id;
});

describe("Dienstfahrzeug speichern", () => {
  const save = (fields: Record<string, string | number | undefined> = {}) => actions.saveFleetVehicle({}, form({ plate: "b xx 22", ...fields }));

  it("braucht fleet.edit, formatiert das Kennzeichen, rechnet die Leasingrate in Cent und protokolliert", async () => {
    await login(["fleet.view"]);
    assert.equal(await redirectOf(() => save()), "/forbidden");
    await login(["fleet.edit"]);
    const target = await redirectOf(() => save({ leasingRate: "349,90", huDue: "2031-03-01" }));
    const car = await env.db.fleetVehicle.findFirstOrThrow({ where: { plate: "B XX 22" } });
    assert.equal(target, `/fleet/${car.id}`);
    assert.equal(car.leasingRateCents, 34990);
    const [entry] = await entries("fleet.create");
    assert.deepEqual([entry.target, entry.entityId], ["B XX 22", car.id]);
  });

  it("prüft Betrag, FIN und Fahrer", async () => {
    await login(["fleet.edit"]);
    assert.ok((await save({ leasingRate: "abc" })).fieldErrors?.leasingRate);
    assert.ok((await save({ leasingRate: "-5" })).fieldErrors?.leasingRate);
    assert.ok((await save({ vin: "ZU-KURZ" })).fieldErrors?.vin);
    assert.ok((await save({ driverId: "gibt-es-nicht" })).fieldErrors?.driverId);
    assert.equal(await env.db.fleetVehicle.count(), 1, "nur das Fahrzeug aus dem Setup");
  });

  it("Ändern prüft die Version", async () => {
    await login(["fleet.edit"]);
    const car = await env.db.fleetVehicle.findUniqueOrThrow({ where: { id: carId } });
    const stale = versionOf(car);
    assert.ok(await redirectOf(() => save({ id: carId, version: stale, make: "VW" })));
    assert.ok((await save({ id: carId, version: stale, make: "Veraltet" })).error);
    assert.equal((await env.db.fleetVehicle.findUniqueOrThrow({ where: { id: carId } })).make, "VW");
    assert.equal((await entries("fleet.update")).length, 1);
  });

  it("Löschen braucht fleet.delete; mit Kilometerständen oder Kosten (Historie) wird nicht gelöscht, ohne Verlauf schon (Z7: Restrict)", async () => {
    const mileage = await env.db.fleetMileage.create({ data: { fleetVehicleId: carId, date: new Date(), km: 10 } });
    await login(["fleet.edit"]);
    assert.equal(await redirectOf(() => actions.deleteFleetVehicle(form({ id: carId }))), "/forbidden");
    await login(["fleet.delete"]);
    await actions.deleteFleetVehicle(form({ id: carId }));
    assert.equal(await env.db.fleetVehicle.count({ where: { id: carId } }), 1, "mit Kilometerstand bleibt das Fahrzeug");
    assert.equal(await env.db.fleetMileage.count(), 1);
    await env.db.fleetMileage.delete({ where: { id: mileage.id } });
    await env.db.fleetCost.create({ data: { fleetVehicleId: carId, date: new Date(), category: "fuel", amountCents: 100 } });
    await actions.deleteFleetVehicle(form({ id: carId }));
    assert.equal(await env.db.fleetVehicle.count({ where: { id: carId } }), 1, "mit Kosten bleibt das Fahrzeug");
    await env.db.fleetCost.deleteMany();
    assert.equal(await redirectOf(() => actions.deleteFleetVehicle(form({ id: carId }))), "/fleet");
    assert.equal((await entries("fleet.delete"))[0].target, "B XX 1");
  });
});

describe("Kilometerstände und Kosten", () => {
  it("Kilometerstand darf nicht unter den zuletzt erfassten fallen; Erfassen und Löschen werden protokolliert", async () => {
    await login(["fleet.edit"]);
    assert.equal((await actions.addMileage({}, form({ fleetVehicleId: carId, date: "2030-01-01", km: 1000 }))).ok, true);
    const lower = await actions.addMileage({}, form({ fleetVehicleId: carId, date: "2030-02-01", km: 900 }));
    assert.ok(lower.fieldErrors?.km);
    assert.match(lower.fieldErrors?.km ?? "", /1\.?000/);
    assert.ok((await actions.addMileage({}, form({ fleetVehicleId: carId, date: "2030-02-01", km: -1 }))).fieldErrors?.km);
    const row = await env.db.fleetMileage.findFirstOrThrow();
    await actions.deleteMileage(form({ id: row.id }));
    assert.equal(await env.db.fleetMileage.count(), 0);
    assert.deepEqual([(await entries("fleet.mileageAdd")).length, (await entries("fleet.mileageDelete")).length], [1, 1]);
    assert.equal((await entries("fleet.mileageAdd"))[0].target, "B XX 1: 1000 km");
  });

  it("Kosten: Betrag als Text → Cent, 0 und Unsinn werden abgelehnt, Kategorie ist begrenzt", async () => {
    await login(["fleet.edit"]);
    const add = (fields: Record<string, string>) => actions.addCost({}, form({ fleetVehicleId: carId, date: "2030-01-01", category: "fuel", amount: "50,00", ...fields }));
    assert.equal((await add({ amount: "1.234,56" })).ok, true);
    assert.equal((await env.db.fleetCost.findFirstOrThrow()).amountCents, 123456);
    assert.ok((await add({ amount: "0" })).fieldErrors?.amount);
    assert.ok((await add({ amount: "viel" })).fieldErrors?.amount);
    assert.ok((await add({ category: "kaffee" })).fieldErrors?.category);
    assert.equal(await env.db.fleetCost.count(), 1);
    await actions.deleteCost(form({ id: (await env.db.fleetCost.findFirstOrThrow()).id }));
    assert.deepEqual([(await entries("fleet.costAdd")).length, (await entries("fleet.costDelete")).length], [1, 1]);
  });

  it("verlangt fleet.edit", async () => {
    await login(["fleet.view"]);
    assert.equal(await redirectOf(() => actions.addMileage({}, form({ fleetVehicleId: carId, date: "2030-01-01", km: 1 }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.addCost({}, form({ fleetVehicleId: carId, date: "2030-01-01", category: "fuel", amount: "1" }))), "/forbidden");
    assert.equal(await env.db.fleetMileage.count() + (await env.db.fleetCost.count()), 0);
  });
});

describe("Führerscheinkontrolle", () => {
  it("trägt die Kontrolle ein, berechnet die nächste Fälligkeit (sechs Monate), nennt den Prüfer und protokolliert", async () => {
    const user = await login(["fleet.edit"]);
    const emp = await env.db.employee.create({ data: { firstName: "Fahrer", lastName: "Eins" } });
    assert.ok((await actions.saveLicenseCheck({}, form({ employeeId: "gibt-es-nicht", checkedAt: "2030-01-15" }))).fieldErrors?.employeeId);
    assert.equal(await redirectOf(() => actions.saveLicenseCheck({}, form({ employeeId: emp.id, checkedAt: "2030-01-15", method: "Sichtkontrolle" }))), "/fleet/licenses");
    const check = await env.db.fleetLicenseCheck.findFirstOrThrow();
    assert.equal(check.checkedByName, user.name);
    assert.equal(check.nextDue.getMonth(), 6, "Januar + 6 Monate = Juli");
    assert.equal((await entries("fleet.licenseCheck"))[0].target, "Fahrer Eins");
    await actions.deleteLicenseCheck(form({ id: check.id }));
    assert.equal(await env.db.fleetLicenseCheck.count(), 0);
    assert.equal((await entries("fleet.licenseCheckDelete")).length, 1);
  });
});
