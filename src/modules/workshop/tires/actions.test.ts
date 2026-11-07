import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { DEFAULT_ROLES } from "@/modules/default-roles";
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

  const fresh = async (id: string) => env.db.tireSet.findUniqueOrThrow({ where: { id } });
  const book = async (id: string, status: string, version?: string) => actions.setTireSetStatus({}, form({ id, status, version: version ?? versionOf(await fresh(id)) }));

  it("Ein-/Ausbuchen braucht tires.stock (tires.edit allein genügt nicht), setzt beim Einlagern die Lagerzeit neu und wird als tires.stock protokolliert", async () => {
    const set = await makeSet();
    await login(["tires.view", "tires.edit"]);
    assert.equal(await redirectOf(() => actions.setTireSetStatus(form({ id: set.id, status: "mounted", version: versionOf(set) }))), "/forbidden");
    assert.equal((await fresh(set.id)).status, "stored");
    await login(["tires.stock"]);
    assert.equal((await book(set.id, "mounted")).ok, true);
    assert.equal((await fresh(set.id)).status, "mounted");
    assert.equal((await book(set.id, "stored")).ok, true);
    assert.ok((await fresh(set.id)).storedAt.getFullYear() >= 2026, "Lagerzeit beginnt neu");
    assert.ok((await book(set.id, "kaputt")).fieldErrors?.status, "ungültiger Status wird abgelehnt");
    assert.ok((await book(set.id, "disposed")).fieldErrors?.status, "Entsorgen ist kein Buchen");
    assert.equal((await fresh(set.id)).status, "stored");
    const entries = await env.db.auditLog.findMany({ where: { action: "tires.stock" }, orderBy: { createdAt: "asc" } });
    assert.equal(entries.length, 2);
    assert.deepEqual([entries[0].target, entries[0].entityId], ["B AB 1: mounted", set.id]);
  });

  it("Ein-/Ausbuchen prüft die Version: veralteter Stand und doppelte Buchung melden den Konflikt, nichts wird überschrieben", async () => {
    const set = await makeSet();
    await login(["tires.stock"]);
    const stale = versionOf(await fresh(set.id));
    assert.equal((await book(set.id, "mounted", stale)).ok, true);
    // dieselbe Bestätigung nochmals (zweiter Tab, zweite Person): Konflikt statt stiller Doppelbuchung
    const again = await book(set.id, "mounted", stale);
    assert.ok(again.error && !again.ok);
    // veraltete Version bei einer anderen Buchung
    const conflict = await book(set.id, "stored", stale);
    assert.ok(conflict.error);
    assert.equal((await fresh(set.id)).status, "mounted");
    // ohne Version wird nicht gebucht (Pflichtfeld)
    assert.ok((await actions.setTireSetStatus({}, form({ id: set.id, status: "stored" }))).fieldErrors?.version);
    assert.equal(await env.db.auditLog.count({ where: { action: "tires.stock" } }), 1);
  });

  it("ein entsorgter Satz lässt sich nicht buchen; Entsorgen braucht tires.edit mit Version und wird als tires.dispose protokolliert", async () => {
    const set = await makeSet();
    await login(["tires.stock"]);
    assert.equal(await redirectOf(() => actions.disposeTireSet(form({ id: set.id, version: versionOf(set) }))), "/forbidden");
    await login(["tires.edit", "tires.stock"]);
    await actions.disposeTireSet(form({ id: set.id, version: "1" }));
    assert.equal((await fresh(set.id)).status, "stored", "veraltete Version: nichts passiert");
    await actions.disposeTireSet(form({ id: set.id, version: versionOf(await fresh(set.id)) }));
    assert.equal((await fresh(set.id)).status, "disposed");
    assert.equal(await env.db.auditLog.count({ where: { action: "tires.dispose" } }), 1);
    const state = await book(set.id, "mounted");
    assert.ok(state.error && !state.ok);
    assert.equal((await fresh(set.id)).status, "disposed");
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

  const settings = { treadWarnMm: 4, treadReplaceMm: 3, tireAgeWarnYears: 6, tireAgeReplaceYears: 10, winterStartMonth: 10, winterEndMonth: 3 };

  it("Ampel-Einstellungen: Reihenfolge der Grenzwerte wird geprüft, Speichern wird protokolliert", async () => {
    await login(["settings.manage"]);
    assert.ok((await actions.saveTireSettings({}, form({ ...settings, treadWarnMm: 3, treadReplaceMm: 4 }))).fieldErrors?.treadReplaceMm);
    assert.ok((await actions.saveTireSettings({}, form({ ...settings, tireAgeWarnYears: 11 }))).fieldErrors?.tireAgeWarnYears);
    assert.equal((await actions.saveTireSettings({}, form(settings))).ok, true);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.tires" } }), 1);
    await login(["tires.edit"]);
    assert.equal(await redirectOf(() => actions.saveTireSettings({}, form(settings))), "/forbidden");
  });

  it("Winterfenster: Monate 1–12, nicht das ganze Jahr; gespeichert und lesbar", async () => {
    await login(["settings.manage"]);
    assert.ok((await actions.saveTireSettings({}, form({ ...settings, winterStartMonth: 13 }))).fieldErrors?.winterStartMonth);
    assert.ok((await actions.saveTireSettings({}, form({ ...settings, winterStartMonth: 0 }))).fieldErrors?.winterStartMonth);
    // 4 bis 3 wäre das ganze Jahr (Winter ohne Sommer)
    assert.ok((await actions.saveTireSettings({}, form({ ...settings, winterStartMonth: 4, winterEndMonth: 3 }))).fieldErrors?.winterEndMonth);
    assert.equal((await actions.saveTireSettings({}, form({ ...settings, winterStartMonth: 11, winterEndMonth: 2 }))).ok, true);
    const { getTireRules } = await import("./settings");
    const rules = await getTireRules();
    assert.deepEqual([rules.winterStartMonth, rules.winterEndMonth], [11, 2]);
  });
});

/** Standardrollen (Regel 9: kein automatisches sensibles Recht – „Ein-/Ausbuchen“ ist ausdrücklich für die Werkstatt vorgesehen). */
describe("Standardrollen und Ein-/Ausbuchen", () => {
  const roleCan = async (key: string) => {
    const role = DEFAULT_ROLES.find((r) => r.key === key)!;
    const user = await env.user({ username: `role-${key}-${Math.random()}`, roles: [await env.role({ permissions: role.permissions })] });
    await env.signIn(user);
    const set = await env.db.tireSet.create({ data: { vehicleId: carId, season: "winter", status: "stored" } });
    const redirected = await redirectOf(() => actions.setTireSetStatus(form({ id: set.id, status: "mounted", version: versionOf(set) })));
    return redirected === null && (await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).status === "mounted";
  };

  it("Mechaniker, Serviceberater und Lager dürfen ein-/ausbuchen", async () => {
    for (const key of ["mechanic", "advisor", "warehouse"]) assert.equal(await roleCan(key), true, key);
  });

  it("Büro/Verwaltung und Geschäftsführung (nur lesend) dürfen es nicht", async () => {
    for (const key of ["office", "management"]) assert.equal(await roleCan(key), false, key);
  });

  it("der Mechaniker darf Sätze aber weder bearbeiten, entsorgen noch löschen", async () => {
    const mechanic = DEFAULT_ROLES.find((r) => r.key === "mechanic")!;
    await env.signIn(await env.user({ username: `mech-${Math.random()}`, roles: [await env.role({ permissions: mechanic.permissions })] }));
    const set = await env.db.tireSet.create({ data: { vehicleId: carId, season: "winter" } });
    assert.equal(await redirectOf(() => actions.disposeTireSet(form({ id: set.id, version: versionOf(set) }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.deleteTireSet(form({ id: set.id }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.updateTireSet({}, form({ id: set.id, version: versionOf(set), vehicleId: carId, season: "winter" }))), "/forbidden");
    assert.equal((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).status, "stored");
  });
});
