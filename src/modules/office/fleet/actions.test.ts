import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

/** Fuhrpark: Kilometerstände und Kosten brauchen ein vorhandenes Fahrzeug (Feldfehler statt Datenbankfehler). */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  await env.signIn(await env.user({ username: "fuhrpark", roles: [await env.role({ permissions: ["fleet.view", "fleet.edit"] })] }));
});
after(() => env.cleanup());

describe("Fuhrpark: Referenzprüfung", () => {
  it("addMileage mit unbekannter Fahrzeug-ID → Fehler, kein Eintrag", async () => {
    const state = await actions.addMileage({}, form({ fleetVehicleId: "gibt-es-nicht", date: "2030-01-01", km: 1000 }));
    assert.ok(state.error || state.fieldErrors);
    assert.equal(await env.db.fleetMileage.count(), 0);
  });

  it("addCost mit unbekannter Fahrzeug-ID → Fehler, kein Eintrag", async () => {
    const state = await actions.addCost({}, form({ fleetVehicleId: "gibt-es-nicht", date: "2030-01-01", category: "fuel", amount: "50,00" }));
    assert.ok(state.error || state.fieldErrors);
    assert.equal(await env.db.fleetCost.count(), 0);
  });

  it("mit vorhandenem Fahrzeug funktionieren beide", async () => {
    const car = await env.db.fleetVehicle.create({ data: { plate: "B XX 1" } });
    assert.equal((await actions.addMileage({}, form({ fleetVehicleId: car.id, date: "2030-01-01", km: 1000 }))).ok, true);
    assert.equal((await actions.addCost({}, form({ fleetVehicleId: car.id, date: "2030-01-01", category: "fuel", amount: "50,00" }))).ok, true);
  });
});

describe("Fuhrpark: Kennzeichen-Dublette", () => {
  it("warnt bei gleichem Kennzeichen (andere Schreibweise) mit dem vorhandenen Fahrzeug; „Trotzdem“ speichert, das Fahrzeug selbst zählt nicht als Dublette", async () => {
    await env.db.fleetVehicle.deleteMany();
    const first = await env.db.fleetVehicle.create({ data: { plate: "B-FW 100" } });
    const warning = await actions.saveFleetVehicle({}, form({ plate: "b fw-100" }));
    assert.ok(warning.fieldErrors?.plate);
    assert.deepEqual(warning.data, { duplicateId: first.id, duplicatePlate: "B-FW 100" });
    assert.equal(await env.db.fleetVehicle.count(), 1);

    const { redirectOf } = await import("@/test/harness");
    assert.ok(await redirectOf(() => actions.saveFleetVehicle({}, form({ plate: "b fw-100", allowDuplicate: "1" }))));
    assert.equal(await env.db.fleetVehicle.count(), 2);
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "fleet.create" }, orderBy: { createdAt: "desc" } })).target ?? "", /Dublette bestätigt/);

    // Bearbeiten des ersten: sein eigenes Kennzeichen ist keine Dublette seiner selbst – das zweite Fahrzeug trägt aber dasselbe, also Warnung
    const { versionOf } = await import("@/lib/concurrency");
    const current = await env.db.fleetVehicle.findUniqueOrThrow({ where: { id: first.id } });
    assert.ok((await actions.saveFleetVehicle({}, form({ id: first.id, version: versionOf(current), plate: "B-FW 100" }))).data?.duplicateId);
  });
});
