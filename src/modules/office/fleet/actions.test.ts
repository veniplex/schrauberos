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
