import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Termin und Kunde (P4b-1): Kunde direkt wählbar, Halter des Fahrzeugs gilt, Halterwechsel zieht offene Termine nach, Hinweise der Abfrage, Termin über Mitternacht. */
let env: TestEnv;
let actions: typeof import("./actions");
let vehicleActions: typeof import("@/modules/workshop/vehicles/actions");
let queries: typeof import("./queries");

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  vehicleActions = await import("@/modules/workshop/vehicles/actions");
  queries = await import("./queries");
});
after(() => env.cleanup());

const base = { title: "Inspektion", date: "2030-06-03", time: "09:00", duration: 60 };
const create = (fields: Record<string, string | number | undefined> = {}) => actions.createAppointment({}, form({ ...base, ...fields }));

beforeEach(async () => {
  await env.db.appointment.deleteMany();
  await env.db.vehicleOwnership.deleteMany();
  await env.db.tireSet.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.absence.deleteMany();
  await env.db.fleetLicenseCheck.deleteMany();
  await env.db.employee.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  const role = await env.role({ key: `r-${Math.random()}`, permissions: ["appointments.view", "appointments.create", "appointments.edit", "vehicles.view", "vehicles.edit", "customers.view"] });
  await env.signIn(await env.user({ username: "werkstatt", roles: [role] }));
});

describe("Kunde im Termin", () => {
  it("ein Kunde lässt sich direkt wählen, auch ganz ohne Fahrzeug", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Laufkunde" } });
    assert.ok(await redirectOf(() => create({ customerId: c.id })));
    const a = await env.db.appointment.findFirstOrThrow();
    assert.deepEqual([a.customerId, a.vehicleId], [c.id, null]);
  });

  it("mit einem Fahrzeug gilt dessen Halter; ein anderer Kunde ist ein Widerspruch", async () => {
    const owner = await env.db.customer.create({ data: { lastName: "Halter" } });
    const other = await env.db.customer.create({ data: { lastName: "Anderer" } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", customerId: owner.id } });
    assert.ok(await redirectOf(() => create({ vehicleId: v.id })));
    assert.equal((await env.db.appointment.findFirstOrThrow()).customerId, owner.id);
    assert.ok(await redirectOf(() => create({ vehicleId: v.id, customerId: owner.id, title: "Gleicher" })), "derselbe Kunde ist kein Widerspruch");
    assert.ok((await create({ vehicleId: v.id, customerId: other.id, title: "Falscher" })).fieldErrors?.customerId);
    assert.equal(await env.db.appointment.count(), 2);
  });

  it("ein Fahrzeug ohne Halter lässt den gewählten Kunden gelten; unbekannte Kunden sind ein Feldfehler", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Kunde" } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 2", plateNorm: "BAB2" } });
    assert.ok(await redirectOf(() => create({ vehicleId: v.id, customerId: c.id })));
    assert.deepEqual((await env.db.appointment.findFirstOrThrow()).customerId, c.id);
    assert.ok((await create({ customerId: "gibt-es-nicht", title: "X" })).fieldErrors?.customerId);
  });

  it("archivierte Kunden und Fahrzeuge sind für neue Termine nicht wählbar, bleiben aber an bestehenden Terminen", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Alt", archivedAt: new Date() } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 3", plateNorm: "BAB3", archivedAt: new Date() } });
    assert.ok((await create({ customerId: c.id })).fieldErrors?.customerId);
    assert.ok((await create({ vehicleId: v.id })).fieldErrors?.vehicleId);
    // ein bestehender Termin behält sie beim Speichern
    const a = await env.db.appointment.create({ data: { title: "Alt", startsAt: new Date("2030-06-03T07:00:00Z"), endsAt: new Date("2030-06-03T08:00:00Z"), customerId: c.id } });
    const row = await env.db.appointment.findUniqueOrThrow({ where: { id: a.id } });
    const { versionOf } = await import("@/lib/concurrency");
    assert.ok(await redirectOf(() => actions.updateAppointment({}, form({ ...base, id: a.id, version: versionOf(row), customerId: c.id, title: "Alt geändert" }))));
  });
});

describe("Halterwechsel zieht offene Termine nach", () => {
  const appt = (vehicleId: string, customerId: string | null, status: string, startsAt: string, minutes = 60) =>
    env.db.appointment.create({ data: { title: `T ${status}`, startsAt: new Date(startsAt), endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000), status, vehicleId, customerId } });

  it("nur offene und noch nicht vergangene Termine des Fahrzeugs bekommen den neuen Halter – in derselben Operation, mit Anzahl im Audit", async () => {
    const a = await env.db.customer.create({ data: { lastName: "Alt" } });
    const b = await env.db.customer.create({ data: { lastName: "Neu" } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 7", plateNorm: "BAB7", customerId: a.id, ownerships: { create: [{ customerId: a.id }] } } });
    const other = await env.db.vehicle.create({ data: { plate: "B-XY 8", plateNorm: "BXY8", customerId: a.id } });
    const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const planned = await appt(v.id, a.id, "scheduled", future(3));
    const confirmed = await appt(v.id, a.id, "confirmed", future(5));
    const running = await appt(v.id, a.id, "in_progress", new Date(Date.now() - 30 * 60_000).toISOString(), 120);
    const done = await appt(v.id, a.id, "done", future(2));
    const cancelled = await appt(v.id, a.id, "cancelled", future(4));
    const past = await appt(v.id, a.id, "scheduled", new Date(Date.now() - 5 * 86_400_000).toISOString());
    const otherVehicle = await appt(other.id, a.id, "scheduled", future(3));

    assert.ok(await redirectOf(() => vehicleActions.transferVehicle({}, form({ vehicleId: v.id, newCustomerId: b.id, date: "2026-05-01" }))));
    const owner = async (id: string) => (await env.db.appointment.findUniqueOrThrow({ where: { id } })).customerId;
    assert.deepEqual(await Promise.all([planned, confirmed, running].map((x) => owner(x.id))), [b.id, b.id, b.id]);
    assert.deepEqual(await Promise.all([done, cancelled, past, otherVehicle].map((x) => owner(x.id))), [a.id, a.id, a.id, a.id], "erledigt, abgesagt, vergangen und andere Fahrzeuge bleiben");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "vehicle.transfer" } });
    assert.match(entry.target ?? "", /3 Termine/);
  });

  it("Fahrzeug ohne neuen Halter: die offenen Termine verlieren den Kunden; nichts zu tun ergibt keinen Zusatz im Audit", async () => {
    const a = await env.db.customer.create({ data: { lastName: "Alt" } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 9", plateNorm: "BAB9", customerId: a.id, ownerships: { create: [{ customerId: a.id }] } } });
    const planned = await appt(v.id, a.id, "scheduled", new Date(Date.now() + 86_400_000).toISOString());
    assert.ok(await redirectOf(() => vehicleActions.transferVehicle({}, form({ vehicleId: v.id, date: "2026-05-01" }))));
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: planned.id } })).customerId, null);

    const c = await env.db.customer.create({ data: { lastName: "Neu" } });
    const empty = await env.db.vehicle.create({ data: { plate: "B-AB 10", plateNorm: "BAB10" } });
    await env.db.auditLog.deleteMany();
    assert.ok(await redirectOf(() => vehicleActions.transferVehicle({}, form({ vehicleId: empty.id, newCustomerId: c.id, date: "2026-05-01" }))));
    assert.equal((await env.db.auditLog.findFirstOrThrow({ where: { action: "vehicle.transfer" } })).target, "B-AB 10");
  });

  it("ein Wechsel mit Datum in der Zukunft lässt Termine davor unberührt", async () => {
    const a = await env.db.customer.create({ data: { lastName: "Alt" } });
    const b = await env.db.customer.create({ data: { lastName: "Neu" } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 11", plateNorm: "BAB11", customerId: a.id, ownerships: { create: [{ customerId: a.id }] } } });
    const soon = await appt(v.id, a.id, "scheduled", new Date(Date.now() + 2 * 86_400_000).toISOString());
    const later = await appt(v.id, a.id, "scheduled", new Date(Date.now() + 20 * 86_400_000).toISOString());
    const { addDaysToKey, dayKey } = await import("@/lib/zone");
    const changeDay = addDaysToKey(dayKey(new Date()), 10);
    assert.ok(await redirectOf(() => vehicleActions.transferVehicle({}, form({ vehicleId: v.id, newCustomerId: b.id, date: changeDay }))));
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: soon.id } })).customerId, a.id);
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: later.id } })).customerId, b.id);
  });
});

describe("Termin über Mitternacht und Arbeitsplatz", () => {
  it("die Doppelbelegung gilt über Mitternacht hinweg; Anschluss um 02:00 ist frei", async () => {
    const bay = await env.db.bay.create({ data: { name: `Nacht ${Math.random()}` } });
    assert.ok(await redirectOf(() => create({ bayId: bay.id, time: "22:00", duration: 240, title: "Nachtarbeit" })));
    const a = await env.db.appointment.findFirstOrThrow();
    assert.equal((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000, 240);
    const clash = await create({ bayId: bay.id, date: "2030-06-04", time: "01:00", duration: 30, title: "Früh" });
    assert.ok(clash.fieldErrors?.bayId, "01:00 am Folgetag liegt noch im Termin");
    assert.ok(await redirectOf(() => create({ bayId: bay.id, date: "2030-06-04", time: "02:00", duration: 30, title: "Anschluss" })));
    assert.equal(await env.db.appointment.count(), 2);
  });
});

describe("Hinweise für das Formular (appointmentHintsFor)", () => {
  const viewer = async () => {
    const { getSession } = await import("@/server/auth/session");
    return (await getSession())!;
  };

  it("Abwesenheit des Zuständigen kommt nur als „abwesend“ – Krankheit verrät nichts, auch nicht mit Recht auf sensible Daten", async () => {
    const worker = await env.user({ username: "helfer" });
    const employee = await env.db.employee.create({ data: { firstName: "Karl", lastName: "Meier", userId: worker.id } });
    await env.db.absence.create({ data: { employeeId: employee.id, type: "sick", note: "Grippe", startDate: new Date("2030-06-03T12:00:00Z"), endDate: new Date("2030-06-04T12:00:00Z") } });
    const hints = await queries.appointmentHintsFor(await viewer(), { date: "2030-06-03", time: "09:00", duration: 60, assigneeId: worker.id });
    assert.ok(hints);
    assert.equal(hints.filter((h) => h.kind === "assigneeAbsent").length, 1);
    const json = JSON.stringify(hints);
    assert.ok(!/sick|Grippe|krank/i.test(json), "weder Art noch Anmerkung: " + json);
    assert.deepEqual(await queries.appointmentHintsFor(await viewer(), { date: "2030-06-10", time: "09:00", duration: 60, assigneeId: worker.id }), [], "an einem anderen Tag nichts");
  });

  it("Fahrzeug mit Termin am selben Tag; der eigene Termin zählt beim Bearbeiten nicht", async () => {
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 20", plateNorm: "BAB20" } });
    assert.ok(await redirectOf(() => create({ vehicleId: v.id, time: "08:00" })));
    const first = await env.db.appointment.findFirstOrThrow();
    const hints = await queries.appointmentHintsFor(await viewer(), { date: "2030-06-03", time: "13:00", duration: 60, vehicleId: v.id });
    assert.deepEqual(hints?.map((h) => h.kind), ["vehicleBooked"]);
    assert.deepEqual(await queries.appointmentHintsFor(await viewer(), { date: "2030-06-03", time: "08:00", duration: 60, vehicleId: v.id, id: first.id }), []);
  });

  it("ohne Recht auf Termine gibt es keine Hinweise; ein ungültiges Fenster liefert null", async () => {
    assert.equal(await queries.appointmentHintsFor(await viewer(), { date: "2030-02-30", time: "09:00", duration: 60 }), null);
    const nobody = await env.role({ key: `n-${Math.random()}`, permissions: ["customers.view"] });
    await env.signIn(await env.user({ username: "nur-kunden", roles: [nobody] }));
    await assert.rejects(async () => queries.appointmentHintsFor(await viewer(), { date: "2030-06-03", time: "09:00", duration: 60 }));
  });

  it("Feiertag der Werkstatt-Region erscheint als Hinweis, Speichern bleibt trotzdem möglich", async () => {
    await env.db.holidaySettings.upsert({ where: { id: "default" }, update: { region: "DE-NW" }, create: { id: "default", region: "DE-NW" } });
    const hints = await queries.appointmentHintsFor(await viewer(), { date: "2030-12-25", time: "09:00", duration: 60 });
    assert.ok(hints?.some((h) => h.kind === "holiday" && h.key === "christmasDay"));
    assert.ok(await redirectOf(() => create({ date: "2030-12-25" })), "ein Hinweis blockiert nichts");
  });
});
