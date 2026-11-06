import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Arbeitsplätze und Terminarten hängen am eigenen Recht `appointments.configure`, nicht mehr an `settings.manage`. */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

describe("Arbeitsplätze und Terminarten", () => {
  it("settings.manage allein genügt nicht", async () => {
    const user = await env.user({ username: "settings", roles: [await env.role({ permissions: ["settings.manage", "appointments.view"] })] });
    await env.signIn(user);
    assert.equal(await redirectOf(() => actions.saveBay(form({ name: "Grube", sortOrder: 1 }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.saveAppointmentType(form({ name: "Test", color: "#112233", defaultMinutes: 30 }))), "/forbidden");
    assert.equal(await env.db.bay.count(), 0);
  });

  it("appointments.configure darf Arbeitsplätze und Terminarten pflegen", async () => {
    const user = await env.user({ username: "configure", roles: [await env.role({ permissions: ["appointments.configure"] })] });
    await env.signIn(user);
    await actions.saveBay(form({ name: "Grube", sortOrder: 1 }));
    await actions.saveAppointmentType(form({ name: "Test", color: "#112233", defaultMinutes: 30 }));
    assert.equal(await env.db.bay.count({ where: { name: "Grube" } }), 1);
    assert.equal(await env.db.appointmentType.count({ where: { name: "Test" } }), 1);
  });
});

/** Referenzen im Termin: Fremde oder erfundene IDs ergeben Feldfehler statt 500 oder verwaister Verknüpfung. */
describe("Termin: Referenzprüfung", () => {
  const base = { title: "Inspektion", date: "2030-05-06", time: "09:00", duration: 60 };

  const setup = async () => {
    const user = await env.user({ username: `mech-${Math.random()}`, roles: [await env.role({ permissions: ["appointments.view", "appointments.create", "appointments.edit"] })] });
    await env.signIn(user);
    const customer = await env.db.customer.create({ data: { lastName: "Muster" } });
    const car = await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1", customerId: customer.id } });
    const other = await env.db.vehicle.create({ data: { plate: "B CD 2", plateNorm: "BCD2" } });
    const set = await env.db.tireSet.create({ data: { vehicleId: car.id, season: "winter" } });
    const type = await env.db.appointmentType.create({ data: { name: `Art ${Math.random()}`, color: "#112233", defaultMinutes: 30 } });
    const bay = await env.db.bay.create({ data: { name: `Platz ${Math.random()}` } });
    return { user, customer, car, other, set, type, bay };
  };
  const save = (fields: Record<string, string | undefined>) => (fields.id ? actions.updateAppointment : actions.createAppointment)({}, form({ ...base, ...fields }));

  it("unbekannte Terminart, Arbeitsplatz, Mitarbeiter, Satz → Feldfehler, nichts gespeichert", async () => {
    const { car } = await setup();
    const before = await env.db.appointment.count();
    for (const field of ["typeId", "bayId", "assigneeId", "tireSetId"] as const) {
      const state = await save({ vehicleId: car.id, [field]: "gibt-es-nicht" });
      assert.ok(state.fieldErrors?.[field] || state.fieldErrors?.vehicleId, `${field}: Feldfehler erwartet`);
    }
    assert.equal(await env.db.appointment.count(), before);
  });

  it("ein Reifensatz eines anderen Fahrzeugs wird abgelehnt, der des eigenen Fahrzeugs angenommen", async () => {
    const { car, other, set } = await setup();
    const bad = await save({ vehicleId: other.id, tireSetId: set.id });
    assert.ok(bad.fieldErrors?.vehicleId);
    const noVehicle = await save({ tireSetId: set.id });
    assert.ok(noVehicle.fieldErrors?.vehicleId);
    assert.equal(await redirectOf(() => save({ vehicleId: car.id, tireSetId: set.id })), "/appointments?date=2030-05-06");
  });

  it("gültige Terminart, Arbeitsplatz und Mitarbeiter werden angenommen", async () => {
    const { car, type, bay, user } = await setup();
    assert.equal(await redirectOf(() => save({ vehicleId: car.id, typeId: type.id, bayId: bay.id, assigneeId: user.id })), "/appointments?date=2030-05-06");
  });

  it("ein deaktivierter Arbeitsplatz oder eine deaktivierte Terminart lässt sich nicht neu wählen", async () => {
    const { type, bay } = await setup();
    await env.db.bay.update({ where: { id: bay.id }, data: { active: false } });
    await env.db.appointmentType.update({ where: { id: type.id }, data: { active: false } });
    assert.ok((await save({ bayId: bay.id })).fieldErrors?.bayId);
    assert.ok((await save({ typeId: type.id })).fieldErrors?.typeId);
  });
});
