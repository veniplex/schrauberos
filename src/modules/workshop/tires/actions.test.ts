import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Reifensätze im Aktions-Rahmen: Rechte je Aktion, Zeilenprüfung, Audit, Versionssperre, Statuswechsel, Einstellungen. */
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
const base = { vehicleId: "", season: "winter" };
const create = (fields: Record<string, string | number | boolean | undefined> = {}) => actions.createTireSet({}, form({ ...base, vehicleId: carId, ...fields }));
const update = (fields: Record<string, string | number | boolean | undefined>) => actions.updateTireSet({}, form({ ...base, vehicleId: carId, ...fields }));

beforeEach(async () => {
  await env.db.tireSet.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
});

describe("Reifensatz: Speichern", () => {
  it("Anlegen braucht tires.create, Ändern tires.edit", async () => {
    await login(["tires.view", "tires.create"]);
    assert.match((await redirectOf(() => create())) ?? "", /^\/tires\/.+/);
    const set = await env.db.tireSet.findFirstOrThrow();
    assert.equal(await redirectOf(() => update({ id: set.id, version: versionOf(set) })), "/forbidden");
    await login(["tires.view", "tires.edit"]);
    assert.equal(await redirectOf(() => create()), "/forbidden");
    assert.equal(await env.db.tireSet.count(), 1);
  });

  it("legt Satz und vier Reifen an (mit Ersatzrad fünf), liest DOT und Profil, protokolliert mit Kennzeichen", async () => {
    await login(["tires.create"]);
    const target = await redirectOf(() => create({ "tire.FL.dot": "2321", "tire.FL.tread": "6,5", "tire.FR.condition": "worn", brand: "Contipremium", width: 205, aspect: 55, rim: 16 }));
    const set = await env.db.tireSet.findFirstOrThrow({ include: { tires: { orderBy: { position: "asc" } } } });
    assert.equal(target, `/tires/${set.id}`);
    assert.equal(set.tires.length, 4);
    const fl = set.tires.find((t) => t.position === "FL")!;
    assert.deepEqual([fl.dot, fl.producedWeek, fl.producedYear, fl.treadDepthMm], ["2321", 23, 2021, 6.5]);
    assert.equal(set.tires.find((t) => t.position === "FR")!.condition, "worn");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "tires.create" } });
    assert.deepEqual([entry.target, entry.entityId], ["B AB 1", set.id]);

    await env.db.tireSet.deleteMany();
    await redirectOf(() => create({ spare: true }));
    assert.equal(await env.db.tire.count(), 5);
  });

  it("meldet DOT- und Profilfehler je Reifenfeld und speichert nichts", async () => {
    await login(["tires.create"]);
    const state = await create({ "tire.FL.dot": "99", "tire.RR.tread": "40" });
    assert.ok(state.fieldErrors?.["tire.FL.dot"]);
    assert.ok(state.fieldErrors?.["tire.RR.tread"]);
    assert.equal(await env.db.tireSet.count(), 0);
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("unbekanntes Fahrzeug und ungültige Saison werden abgelehnt", async () => {
    await login(["tires.create"]);
    assert.ok((await create({ vehicleId: "gibt-es-nicht" })).fieldErrors?.vehicleId);
    assert.ok((await create({ season: "monsun" })).fieldErrors?.season);
    assert.equal(await env.db.tireSet.count(), 0);
  });

  it("Ändern ersetzt die Reifenzeilen, prüft die Version und protokolliert", async () => {
    await login(["tires.create", "tires.edit"]);
    await redirectOf(() => create({ "tire.FL.tread": "7" }));
    const set = await env.db.tireSet.findFirstOrThrow();
    const stale = versionOf(set);
    assert.ok(await redirectOf(() => update({ id: set.id, version: stale, "tire.FL.tread": "5", brand: "Neu" })));
    const changed = await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id }, include: { tires: true } });
    assert.equal(changed.brand, "Neu");
    assert.equal(changed.tires.length, 4, "keine doppelten Reifenzeilen");
    assert.equal(changed.tires.find((t) => t.position === "FL")!.treadDepthMm, 5);

    const conflict = await update({ id: set.id, version: stale, brand: "Veraltet" });
    assert.ok(conflict.error);
    assert.equal((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).brand, "Neu");
    assert.equal(await env.db.auditLog.count({ where: { action: "tires.update" } }), 1);
  });
});

describe("Reifensatz: Status, Löschen, Einstellungen", () => {
  const makeSet = () => env.db.tireSet.create({ data: { vehicleId: carId, season: "summer", status: "stored", storedAt: new Date("2020-01-01") } });

  it("Statuswechsel braucht tires.edit, setzt beim Einlagern die Lagerzeit neu und wird protokolliert", async () => {
    const set = await makeSet();
    await login(["tires.view"]);
    assert.equal(await redirectOf(() => actions.setTireSetStatus(form({ id: set.id, status: "mounted" }))), "/forbidden");
    await login(["tires.edit"]);
    await actions.setTireSetStatus(form({ id: set.id, status: "mounted" }));
    assert.equal((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).status, "mounted");
    await actions.setTireSetStatus(form({ id: set.id, status: "stored" }));
    assert.ok((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).storedAt!.getFullYear() >= 2026, "Lagerzeit beginnt neu");
    await actions.setTireSetStatus(form({ id: set.id, status: "kaputt" }));
    assert.equal((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).status, "stored", "ungültiger Status wird ignoriert");
    assert.equal(await env.db.auditLog.count({ where: { action: "tires.update" } }), 2);
  });

  it("Löschen braucht tires.delete, entfernt Reifen mit, protokolliert das Kennzeichen und geht zur Liste", async () => {
    const set = await makeSet();
    await env.db.tire.create({ data: { tireSetId: set.id, position: "FL" } });
    await login(["tires.edit"]);
    assert.equal(await redirectOf(() => actions.deleteTireSet(form({ id: set.id }))), "/forbidden");
    await login(["tires.delete"]);
    assert.equal(await redirectOf(() => actions.deleteTireSet(form({ id: set.id }))), "/tires");
    assert.equal(await env.db.tireSet.count(), 0);
    assert.equal(await env.db.tire.count(), 0);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "tires.delete" } });
    assert.deepEqual([entry.target, entry.entityId], ["B AB 1", set.id]);
  });

  it("Ampel-Einstellungen: Reihenfolge der Grenzwerte wird geprüft, Speichern wird protokolliert", async () => {
    await login(["settings.manage"]);
    assert.ok((await actions.saveTireSettings({}, form({ treadWarnMm: 3, treadReplaceMm: 4, tireAgeWarnYears: 6, tireAgeReplaceYears: 10 }))).fieldErrors?.treadReplaceMm);
    assert.ok((await actions.saveTireSettings({}, form({ treadWarnMm: 4, treadReplaceMm: 3, tireAgeWarnYears: 11, tireAgeReplaceYears: 10 }))).fieldErrors?.tireAgeWarnYears);
    assert.equal((await actions.saveTireSettings({}, form({ treadWarnMm: 4, treadReplaceMm: 3, tireAgeWarnYears: 6, tireAgeReplaceYears: 10 }))).ok, true);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.tires" } }), 1);
    await login(["tires.edit"]);
    assert.equal(await redirectOf(() => actions.saveTireSettings({}, form({ treadWarnMm: 4, treadReplaceMm: 3, tireAgeWarnYears: 6, tireAgeReplaceYears: 10 }))), "/forbidden");
  });
});
