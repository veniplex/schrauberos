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
  await env.db.vehicleOwnership.deleteMany();
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

  it("warnt bei doppelten Kennzeichen (mit und ohne Halter) mit dem vorhandenen Fahrzeug, statt zu sperren; unbekannte Halter und ungültige FIN bleiben Feldfehler", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Müller" } });
    const first = await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", customerId: c.id } });
    const second = await env.db.vehicle.create({ data: { plate: "B-AB 2", plateNorm: "BAB2" } });
    const withOwner = await actions.saveVehicle({}, form({ plate: "B-AB 1" }));
    assert.match(withOwner.fieldErrors?.plate ?? "", /Müller/);
    assert.deepEqual(withOwner.data, { duplicateId: first.id, duplicatePlate: "B-AB 1", duplicateOwner: "Müller" }, "das Formular bekommt das vorhandene Fahrzeug für „Vorhandenes Fahrzeug öffnen“");
    const noOwner = await actions.saveVehicle({}, form({ plate: "b ab-2" }));
    assert.match(noOwner.fieldErrors?.plate ?? "", /ohne Halter/);
    assert.equal(noOwner.data?.duplicateId, second.id);
    assert.ok((await actions.saveVehicle({}, form({ plate: "B-XY 9", customerId: "gibt-es-nicht" }))).fieldErrors?.customerId);
    assert.ok((await actions.saveVehicle({}, form({ plate: "B-XY 9", vin: "zu-kurz" }))).fieldErrors?.vin);
    assert.equal(await env.db.vehicle.count(), 2, "nichts wurde gespeichert");
  });

  it("„Trotzdem anlegen“ (allowDuplicate) speichert die Dublette und vermerkt es im Audit; die Warnung kommt auch bei anderer Schreibweise (Umlaut zerlegt, Trenner)", async () => {
    await env.db.vehicle.create({ data: { plate: "MÜ-AB 12", plateNorm: "MÜAB12" } });
    const warning = await actions.saveVehicle({}, form({ plate: "mu\u0308 ab-12" }));
    assert.ok(warning.data?.duplicateId, "zerlegtes Ü wird als dasselbe Kennzeichen erkannt");
    const target = await redirectOf(() => actions.saveVehicle({}, form({ plate: "MÜ-AB 12", allowDuplicate: "1" })));
    assert.ok(target);
    assert.equal(await env.db.vehicle.count({ where: { plateNorm: "MÜAB12" } }), 2);
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "vehicle.create" } })).target ?? "", /Dublette bestätigt/);
  });

  it("beim Ändern zählt das Fahrzeug selbst nicht als Dublette", async () => {
    await redirectOf(() => actions.saveVehicle({}, form({ plate: "B-AB 1" })));
    const v = await env.db.vehicle.findFirstOrThrow();
    const { versionOf } = await import("@/lib/concurrency");
    assert.ok(await redirectOf(() => actions.saveVehicle({}, form({ id: v.id, version: versionOf(v), plate: "b-ab 1", make: "Opel" }))));
  });

  it("speichert Prüffrist (Monat in verschiedenen Schreibweisen), weitere Prüfung, Kilometerstand, Kraftstoff, HSN/TSN und Erstzulassung", async () => {
    await redirectOf(() =>
      actions.saveVehicle({}, form({ plate: "B-HU 1", inspectionDue: "11/2026", extraInspectionKind: "gas", extraInspectionDue: "2027-03-15", mileageKm: "123.456", fuel: "diesel", hsn: "0603", tsn: "bgd", firstRegistration: "2019-04-02" })),
    );
    const v = await env.db.vehicle.findFirstOrThrow();
    assert.equal(v.inspectionDue, "2026-11");
    assert.equal(v.extraInspectionKind, "gas");
    assert.equal(v.extraInspectionDue?.toISOString().slice(0, 10), "2027-03-15");
    assert.equal(v.mileageKm, 123456);
    assert.equal(v.fuel, "diesel");
    assert.equal(v.hsn, "0603");
    assert.equal(v.tsn, "BGD");
    assert.equal(v.firstRegistration?.toISOString().slice(0, 10), "2019-04-02");
    const { version } = { version: (await import("@/lib/concurrency")).versionOf(v) };
    // „2027-01“ im Monatsfeld des Browsers
    assert.ok(await redirectOf(() => actions.saveVehicle({}, form({ id: v.id, version, plate: "B-HU 1", inspectionDue: "2027-01" }))));
    const changed = await env.db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
    assert.equal(changed.inspectionDue, "2027-01");
    assert.equal(changed.extraInspectionDue, null, "ein weggelassenes Feld wird geleert (wie im Formular)");
  });

  it("prüft die neuen Felder: Monat, Kilometerstand, HSN/TSN, Kraftstoff, weitere Prüfung braucht Art und Datum", async () => {
    const errors = async (data: Record<string, string>) => (await actions.saveVehicle({}, form({ plate: "B-ZZ 9", ...data }))).fieldErrors ?? {};
    assert.ok((await errors({ inspectionDue: "13/2026" })).inspectionDue);
    assert.ok((await errors({ inspectionDue: "nächstes Jahr" })).inspectionDue);
    assert.ok((await errors({ mileageKm: "viel" })).mileageKm);
    assert.ok((await errors({ mileageKm: "12345678" })).mileageKm);
    assert.ok((await errors({ hsn: "123" })).hsn);
    assert.ok((await errors({ tsn: "ABCD" })).tsn);
    assert.ok((await errors({ fuel: "wasser" })).fuel);
    assert.ok((await errors({ extraInspectionKind: "sp" })).extraInspectionDue);
    assert.ok((await errors({ extraInspectionDue: "2027-01-01" })).extraInspectionKind);
    assert.ok((await errors({ firstRegistration: "2019-02-30" })).firstRegistration);
    assert.equal(await env.db.vehicle.count(), 0);
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
