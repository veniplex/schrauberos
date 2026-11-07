import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { ALL_PERMISSIONS, FEATURES, fullFeatureId } from "./catalog";
import { DEFAULT_ROLES } from "./default-roles";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";

/** Einrichtungs-Checkliste und Schnellaktionen der Übersicht (P2b-4): Punkte kommen von den aktiven Funktionen und rechnen sich aus dem Datenstand. */
let env: TestEnv;
let registry: typeof import("./registry");
before(async () => {
  env = await createTestEnv();
  registry = await import("./registry");
});
after(() => env.cleanup());

const ALL_FEATURES = new Set(FEATURES.map(fullFeatureId));
const lookup = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

function sessionOf(options: { id?: string; isAdmin?: boolean; twoFactor?: boolean; permissions?: Iterable<string>; features?: Set<string> } = {}) {
  const permissions = new Set<string>(options.permissions ?? ALL_PERMISSIONS);
  return {
    user: { id: options.id ?? "u-none", isAdmin: options.isAdmin ?? true, twoFactor: options.twoFactor ?? false },
    features: options.features ?? ALL_FEATURES,
    permissions,
    can: (p: string) => permissions.has(p),
  } as never;
}
const stateOf = async (session: never, secure = false) => Object.fromEntries((await registry.setupChecksFor(session, secure)).map((r) => [r.id, r.done]));

beforeEach(async () => {
  await env.db.employee.deleteMany();
  await env.db.recoveryCode.deleteMany();
  await env.db.appSetting.deleteMany();
  await env.db.workshop.deleteMany();
  await env.db.holidaySettings.deleteMany();
});

describe("Einrichtungs-Checkliste", () => {
  it("jeder Punkt hat Beschriftung und Hinweis in beiden Sprachen; nur für Administratoren", async () => {
    const results = await registry.setupChecksFor(sessionOf(), false);
    assert.ok(results.length >= 9, `nur ${results.length} Punkte`);
    assert.equal(new Set(results.map((r) => r.id)).size, results.length);
    for (const r of results) for (const tree of [de, en]) for (const key of [r.labelKey, r.hintKey]) assert.equal(typeof lookup(tree, key), "string", key);
    assert.deepEqual(await registry.setupChecksFor(sessionOf({ isAdmin: false }), false), []);
  });

  it("fragt nur aktive Funktionen ab und nur, was die Person erledigen darf", async () => {
    const withoutEmployees = new Set(ALL_FEATURES);
    withoutEmployees.delete("office.employees");
    withoutEmployees.delete("workshop.appointments");
    const ids = Object.keys(await stateOf(sessionOf({ features: withoutEmployees })));
    assert.equal(ids.includes("firstEmployee"), false);
    assert.equal(ids.includes("baysTypes"), false);
    assert.ok(ids.includes("profile") && ids.includes("autoBackup"), "Verwaltung ist immer da");
    const noBackupKeys = Object.keys(await stateOf(sessionOf({ permissions: ALL_PERMISSIONS.filter((p) => p !== "backup.keys") })));
    assert.equal(noBackupKeys.includes("recoveryKey"), false, "ohne backup.keys kein Punkt „Schlüssel sichern“");
  });

  it("Zustand aus dem Datenstand: Profil, Öffnungszeiten, Mitarbeiter, Benutzer, Wiederherstellungs-Code, HTTPS, Zwei-Faktor", async () => {
    const user = await env.user({ username: "chef" });
    let state = await stateOf(sessionOf({ id: user.id }));
    assert.equal(state.profile, false);
    assert.equal(state.holidays, false, "keine Region gewählt");
    assert.equal(state.hours, false, "nie konfiguriert (leeres Objekt)");
    assert.equal(state.firstEmployee, false);
    assert.equal(state.recoveryCode, false);
    assert.equal(state.https, false);
    assert.equal(state.twoFactor, false);
    assert.equal(state.moreUsers, false, "nur ein Konto");

    await env.db.workshop.upsert({ where: { id: "default" }, update: { street: "Hauptstr. 1", zip: "10115", city: "Berlin", phone: "030 1", taxNumber: "21/815/08150", iban: "DE89370400440532013000", openingHours: JSON.stringify({ mon: ["08:00", "17:00"] }) }, create: { id: "default", street: "Hauptstr. 1", zip: "10115", city: "Berlin", phone: "030 1", taxNumber: "21/815/08150", iban: "DE89370400440532013000", openingHours: JSON.stringify({ mon: ["08:00", "17:00"] }) } });
    await env.db.employee.create({ data: { firstName: "Erika", lastName: "Muster" } });
    await env.db.recoveryCode.create({ data: { userId: user.id, codeHash: "h-1", confirmedAt: new Date() } });
    await env.user({ username: "zweiter" });
    await env.db.holidaySettings.upsert({ where: { id: "default" }, update: { region: "DE-NW" }, create: { id: "default", region: "DE-NW" } });
    state = await stateOf(sessionOf({ id: user.id, twoFactor: true }), true);
    assert.deepEqual([state.profile, state.holidays, state.hours, state.firstEmployee, state.recoveryCode, state.https, state.twoFactor, state.moreUsers], [true, true, true, true, true, true, true, true]);
  });

  it("Wiederherstellungs-Code: erzeugt, aber nicht bestätigt zählt nicht", async () => {
    const user = await env.user({ username: "chef2" });
    await env.db.recoveryCode.create({ data: { userId: user.id, codeHash: "h-2", confirmedAt: null } });
    assert.equal((await stateOf(sessionOf({ id: user.id }))).recoveryCode, false);
  });

  it("Backup-Plan ist standardmäßig an; Off-Site und Schlüssel sind es nicht", async () => {
    const state = await stateOf(sessionOf());
    assert.equal(state.autoBackup, true);
    assert.equal(state.offsite, false);
    assert.equal(state.recoveryKey, false);
    await env.db.appSetting.create({ data: { key: "offsite.enabled", value: "true" } });
    assert.equal((await stateOf(sessionOf())).offsite, true);
  });

  it("Öffnungszeiten: nur Ruhetage zählen nicht als festgelegt", async () => {
    const { hoursConfigured } = await import("./admin/settings/setup-checks");
    assert.equal(hoursConfigured("{}"), false);
    assert.equal(hoursConfigured("kaputt"), false);
    assert.equal(hoursConfigured(JSON.stringify({ mon: null, tue: null })), false);
    assert.equal(hoursConfigured(JSON.stringify({ mon: ["08:00", "12:00"] })), true);
    const { profileComplete } = await import("./admin/settings/setup-checks");
    const base = { street: "x", zip: "1", city: "y", phone: null, email: "a@b.de", taxNumber: "21/815/08150", vatId: null, iban: "DE89370400440532013000" };
    assert.equal(profileComplete(base), true);
    assert.equal(profileComplete({ ...base, phone: null, email: null }), false, "ohne Kontaktweg");
    assert.equal(profileComplete({ ...base, street: " ", phone: "1", email: null }), false);
    assert.equal(profileComplete({ ...base, taxNumber: null, vatId: "DE123456789" }), true, "USt-IdNr. genügt statt Steuernummer");
    assert.equal(profileComplete({ ...base, taxNumber: null }), false, "ohne Steuernummer oder USt-IdNr.");
    assert.equal(profileComplete({ ...base, iban: null }), false, "ohne IBAN");
  });
});

describe("Schnellaktionen der Übersicht", () => {
  const roleSession = (key: string) => sessionOf({ isAdmin: key === "admin", permissions: key === "admin" ? ALL_PERMISSIONS : DEFAULT_ROLES.find((r) => r.key === key)!.permissions });
  const ids = (key: string) => registry.shortcutsFor(roleSession(key)).map((a) => a.id);

  it("zwei bis drei je Rolle: erst Anlegen, dann Ansichten als Auffüllung", () => {
    assert.deepEqual(ids("admin"), ["appointments.new", "tires.new", "customers.new"]);
    assert.deepEqual(ids("advisor"), ["appointments.new", "tires.new", "customers.new"]);
    assert.deepEqual(ids("mechanic"), ["appointments.today", "tires.stock", "vehicles.list"], "ohne Anlegen-Rechte: Kalender, Ein-/Ausbuchen, Fahrzeuge");
    assert.deepEqual(ids("office"), ["invoices.new", "fleet.new", "handbook.new"]);
    assert.deepEqual(ids("it_admin"), ["network.newDevice", "docsIt.new"]);
    for (const role of DEFAULT_ROLES) assert.ok(ids(role.key).length >= 2 && ids(role.key).length <= 3, role.key);
  });

  it("das „Neu“-Menü kennt die Ansichten nicht, ausgeschaltete Funktionen liefern nichts", () => {
    assert.equal(registry.quickActionsFor(roleSession("mechanic")).length, 0);
    assert.ok(registry.quickActionsFor(roleSession("admin")).every((a) => !["appointments.today", "tires.stock", "vehicles.list"].includes(a.id)));
    assert.deepEqual(registry.shortcutsFor(sessionOf({ features: new Set(["admin.users"]), permissions: ALL_PERMISSIONS })), []);
  });
});
