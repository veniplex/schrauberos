import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Schnellstatus „Starten“/„Fertig“: Recht, erlaubte Schritte, Versionsprüfung, Audit; nur der Status ändert sich. */
let env: TestEnv;
let actions: typeof import("./actions");
let carId: string;
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  carId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } })).id;
});
after(() => env.cleanup());

const login = async (permissions: string[]) => {
  const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
  await env.signIn(user);
  return user;
};
const make = (status = "scheduled") =>
  env.db.appointment.create({
    data: { title: "Reifenwechsel", status, startsAt: new Date("2030-05-06T08:00:00"), endsAt: new Date("2030-05-06T09:00:00"), vehicleId: carId, notes: "Felgen mitbringen" },
  });
const fresh = (id: string) => env.db.appointment.findUniqueOrThrow({ where: { id } });
const step = async (id: string, status: string, version?: string) => actions.setAppointmentStatus({}, form({ id, status, version: version ?? versionOf(await fresh(id)) }));

beforeEach(async () => {
  await env.db.appointment.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
});

describe("Schnellstatus (appointments.setStatus)", () => {
  it("braucht appointments.edit: Ansehen allein genügt nicht, ohne Anmeldung geht es nicht", async () => {
    const a = await make();
    await login(["appointments.view"]);
    assert.equal(await redirectOf(() => actions.setAppointmentStatus(form({ id: a.id, status: "in_progress", version: versionOf(a) }))), "/forbidden");
    assert.equal((await fresh(a.id)).status, "scheduled");
    env.signOut();
    assert.ok(await redirectOf(() => actions.setAppointmentStatus(form({ id: a.id, status: "in_progress", version: versionOf(a) }))));
  });

  it("Starten und Fertig: Geplant → In Arbeit → Erledigt; die Antwort nennt den neuen Status, alles andere am Termin bleibt", async () => {
    const a = await make("confirmed");
    await login(["appointments.edit"]);
    const started = await step(a.id, "in_progress");
    assert.deepEqual([started.ok, (started as { status?: string }).status], [true, "in_progress"]);
    assert.match(started.message ?? "", /gestartet/);
    const done = await step(a.id, "done");
    assert.deepEqual([done.ok, (done as { status?: string }).status], [true, "done"]);
    assert.match(done.message ?? "", /erledigt/);
    const row = await fresh(a.id);
    assert.deepEqual([row.status, row.title, row.notes, row.startsAt.toISOString(), row.vehicleId], ["done", a.title, a.notes, a.startsAt.toISOString(), carId]);
  });

  it("„Fertig“ geht auch direkt aus Geplant", async () => {
    const a = await make("scheduled");
    await login(["appointments.edit"]);
    assert.equal((await step(a.id, "done")).ok, true);
    assert.equal((await fresh(a.id)).status, "done");
  });

  it("nur die beiden Schritte: kein Zurück, nichts aus Erledigt/Storniert/Nicht erschienen, keine anderen Zielstatus", async () => {
    await login(["appointments.edit"]);
    for (const [from, to] of [["done", "in_progress"], ["done", "done"], ["cancelled", "done"], ["cancelled", "in_progress"], ["no_show", "done"], ["in_progress", "in_progress"]] as const) {
      const a = await make(from);
      const state = await step(a.id, to);
      assert.ok(state.error && !state.ok, `${from} → ${to} muss abgelehnt werden`);
      assert.equal((await fresh(a.id)).status, from);
    }
    const a = await make();
    for (const to of ["cancelled", "scheduled", "no_show", "kaputt"]) assert.ok((await step(a.id, to)).fieldErrors?.status, to);
    assert.equal((await fresh(a.id)).status, "scheduled");
    assert.equal(await env.db.auditLog.count(), 0, "abgelehnte Schritte hinterlassen keinen Eintrag");
  });

  it("Konflikt: veraltete Version (zwischenzeitlich geändert) oder derselbe Schritt schon getan – nichts wird überschrieben", async () => {
    const a = await make();
    await login(["appointments.edit"]);
    const stale = versionOf(await fresh(a.id));
    assert.equal((await step(a.id, "in_progress", stale)).ok, true);
    // zweite Person bestätigt „Starten“ auf altem Stand
    const again = await step(a.id, "in_progress", stale);
    assert.ok(again.error && !again.ok);
    // „Fertig“ auf altem Stand: Version stimmt nicht mehr
    const old = await step(a.id, "done", stale);
    assert.ok(old.error && !old.ok);
    assert.equal((await fresh(a.id)).status, "in_progress");
    // jemand ändert den Termin (Bearbeiten): der Schnellstatus auf dem Stand davor meldet Konflikt
    const before = versionOf(await fresh(a.id));
    await env.db.appointment.update({ where: { id: a.id }, data: { notes: "geändert" } });
    assert.ok((await step(a.id, "done", before)).error);
    assert.equal((await fresh(a.id)).status, "in_progress");
    // ohne Version wird nicht gespeichert
    assert.ok((await actions.setAppointmentStatus({}, form({ id: a.id, status: "done" }))).fieldErrors?.version);
  });

  it("unbekannter Termin → Fehler; Audit-Eintrag nur bei Erfolg, mit Titel und Zielstatus", async () => {
    await login(["appointments.edit"]);
    const state = await actions.setAppointmentStatus({}, form({ id: "gibt-es-nicht", status: "done", version: "1" }));
    assert.ok(state.error && !state.ok);
    const a = await make();
    await step(a.id, "in_progress");
    const entries = await env.db.auditLog.findMany({ where: { action: "appointment.status" } });
    assert.equal(entries.length, 1);
    assert.deepEqual([entries[0].target, entries[0].entityId], ["Reifenwechsel: in_progress", a.id]);
  });
});
