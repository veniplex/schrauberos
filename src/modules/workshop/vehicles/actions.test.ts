import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Fahrzeuge im Aktions-Rahmen: Anlegen mit Halter, Kennzeichen-Dublette, Halterwechsel, Löschen – jeweils mit Audit. */
let env: TestEnv;
let actions: typeof import("./actions");

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  const role = await env.role({ key: `r-${Math.random()}`, permissions: ["vehicles.view", "vehicles.edit", "vehicles.delete"] });
  await env.signIn(await env.user({ username: "werkstatt", roles: [role] }));
});

describe("saveVehicle", () => {
  it("legt ein Fahrzeug mit Halter an (Halter-Historie) und protokolliert", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Halter" } });
    const target = await redirectOf(() => actions.saveVehicle({}, form({ plate: "b ab 1234", customerId: c.id, make: "VW", year: 2018 })));
    const v = await env.db.vehicle.findFirstOrThrow({ include: { ownerships: true } });
    assert.equal(target, `/vehicles/${v.id}`);
    assert.equal(v.plateNorm, "BAB1234");
    assert.equal(v.customerId, c.id);
    assert.equal(v.ownerships.length, 1);
    assert.equal((await env.db.auditLog.findFirstOrThrow({ where: { action: "vehicle.create" } })).entityId, v.id);
  });

  it("meldet doppelte Kennzeichen (mit und ohne Halter) und unbekannte Halter als Feldfehler", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Müller" } });
    await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", customerId: c.id } });
    await env.db.vehicle.create({ data: { plate: "B-AB 2", plateNorm: "BAB2" } });
    assert.match((await actions.saveVehicle({}, form({ plate: "B-AB 1" }))).fieldErrors?.plate ?? "", /Müller/);
    assert.match((await actions.saveVehicle({}, form({ plate: "b ab-2" }))).fieldErrors?.plate ?? "", /ohne Halter/);
    assert.ok((await actions.saveVehicle({}, form({ plate: "B-XY 9", customerId: "gibt-es-nicht" }))).fieldErrors?.customerId);
    assert.ok((await actions.saveVehicle({}, form({ plate: "B-XY 9", vin: "zu-kurz" }))).fieldErrors?.vin);
    assert.equal(await env.db.vehicle.count(), 2);
  });

  it("ändern prüft die Version", async () => {
    await redirectOf(() => actions.saveVehicle({}, form({ plate: "B-AB 1" })));
    const v = await env.db.vehicle.findFirstOrThrow();
    const { versionOf } = await import("@/lib/concurrency");
    const version = versionOf(v);
    assert.ok(await redirectOf(() => actions.saveVehicle({}, form({ id: v.id, version, plate: "B-AB 1", make: "Opel" }))));
    assert.ok((await actions.saveVehicle({}, form({ id: v.id, version, plate: "B-AB 1", make: "Audi" }))).error);
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: v.id } })).make, "Opel");
    assert.equal(await env.db.auditLog.count({ where: { action: "vehicle.update" } }), 1);
  });
});

describe("transferVehicle und deleteVehicle", () => {
  it("Halterwechsel beendet den alten Eintrag, legt den neuen an und protokolliert", async () => {
    const a = await env.db.customer.create({ data: { lastName: "Alt" } });
    const b = await env.db.customer.create({ data: { lastName: "Neu" } });
    await redirectOf(() => actions.saveVehicle({}, form({ plate: "B-AB 1", customerId: a.id })));
    const v = await env.db.vehicle.findFirstOrThrow();
    assert.ok((await actions.transferVehicle({}, form({ vehicleId: v.id, newCustomerId: a.id, date: "2026-05-01" }))).fieldErrors?.newCustomerId, "gleicher Halter");
    assert.ok(await redirectOf(() => actions.transferVehicle({}, form({ vehicleId: v.id, newCustomerId: b.id, date: "2026-05-01" }))));
    const after = await env.db.vehicle.findUniqueOrThrow({ where: { id: v.id }, include: { ownerships: { orderBy: { fromDate: "asc" } } } });
    assert.equal(after.customerId, b.id);
    assert.equal(after.ownerships.length, 2);
    assert.ok(after.ownerships.some((o) => o.customerId === a.id && o.toDate), "alter Eintrag beendet");
    assert.equal(await env.db.auditLog.count({ where: { action: "vehicle.transfer" } }), 1);
  });

  it("löscht ein Fahrzeug mit Audit; ein unbekanntes wird gemeldet", async () => {
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 9", plateNorm: "BAB9" } });
    assert.equal(await redirectOf(() => actions.deleteVehicle(form({ id: "gibt-es-nicht" }))), null);
    assert.equal(await env.db.vehicle.count(), 1);
    assert.equal(await redirectOf(() => actions.deleteVehicle(form({ id: v.id }))), "/vehicles");
    assert.equal(await env.db.vehicle.count(), 0);
    assert.equal((await env.db.auditLog.findFirstOrThrow({ where: { action: "vehicle.delete" } })).target, "B-AB 9");
  });
});
