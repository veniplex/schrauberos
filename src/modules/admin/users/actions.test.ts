import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Role, User } from "@/generated/prisma/client";
import { de } from "@/i18n/messages/de";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Rechte-Hierarchie bei Benutzern (SEC-01/SEC-02): Ein Nicht-Admin darf nur Konten ändern, deren Rohrechte eine Teilmenge der
 * eigenen sind, und nur Rollen vergeben, die er selbst vollständig besitzt und die keine adminOnly-Rechte enthalten.
 * Die Tests schicken die Formulardaten manipuliert, wie es ein Angreifer ohne die Oberfläche täte.
 */
/** Der Fehler muss eine Ablehnung der Rechte-Hierarchie sein – nicht irgendein anderer Fehler. */
const assertDenied = (state: { error?: string }) => assert.ok(Object.values(de.rbac.denied).includes(state.error ?? ""), `Ablehnung der Rechte-Hierarchie erwartet, war: ${state.error}`);

let env: TestEnv;
let actions: typeof import("./actions");
let decodeFlash: typeof import("@/server/operations/flash").decodeFlash;

let adminRole: Role;
let managerRole: Role; // darf Benutzer verwalten (Admin hat es bewusst vergeben) + Termine bearbeiten
let powerRole: Role; // mehr Rechte als der Verwalter
let lowRole: Role; // Teilmenge der Verwalter-Rechte
let usersAdminRole: Role; // enthält ein adminOnly-Recht, das auch der Verwalter besitzt
let manager: User;
let victim: User; // Konto mit mächtiger Rolle
let basic: User; // Konto mit kleiner Rolle
let admin2: User;

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  ({ decodeFlash } = await import("@/server/operations/flash"));
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  await env.db.featureSetting.deleteMany();
  adminRole = await env.role({ key: "admin", isAdmin: true, isSystem: true });
  managerRole = await env.role({ key: "manager", permissions: ["users.view", "users.manage", "appointments.view", "appointments.edit"] });
  powerRole = await env.role({ key: "power", permissions: ["appointments.view", "appointments.edit", "appointments.delete", "invoices.view"] });
  lowRole = await env.role({ key: "low", permissions: ["appointments.view"] });
  usersAdminRole = await env.role({ key: "usersadmin", permissions: ["users.manage"] });
  manager = await env.user({ username: "manager", password: "manager-pass-1", roles: [managerRole] });
  victim = await env.user({ username: "victim", password: "victim-pass-1", roles: [powerRole] });
  basic = await env.user({ username: "basic", password: "basic-pass-1", roles: [lowRole] });
  admin2 = await env.user({ username: "admin2", password: "admin2-pass-1", roles: [adminRole] });
  await env.signIn(manager);
});

/** Die zuletzt gesetzte Flash-Meldung (Rückmeldung der Aktionen ohne Formularzustand). */
const lastFlash = () => {
  const write = env.browser.writes.filter((w) => w.name === "so_flash").at(-1);
  return write ? decodeFlash(write.value) : null;
};

const edit = async (target: User, extra: Record<string, string | boolean | string[] | undefined>) => {
  const fresh = await env.db.user.findUniqueOrThrow({ where: { id: target.id }, include: { roles: true } });
  const { versionOf } = await import("@/lib/concurrency");
  return actions.saveUser(
    {},
    form({
      id: fresh.id,
      version: versionOf(fresh),
      username: fresh.username,
      name: fresh.name,
      active: fresh.active,
      roleId: fresh.roles.map((r) => r.roleId),
      ...extra,
    }),
  );
};
const hashOf = async (u: User) => (await env.db.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash;
const rolesOf = async (u: User) => (await env.db.userRole.findMany({ where: { userId: u.id } })).map((r) => r.roleId).sort();

describe("saveUser – Rechte-Hierarchie", () => {
  it("setzt das Passwort eines Kontos mit mächtigerer Rolle NICHT", async () => {
    const before = await hashOf(victim);
    const state = await edit(victim, { password: "ubernommen-123" });
    assertDenied(state);
    assert.equal(await hashOf(victim), before);
  });

  it("deaktiviert oder ändert die E-Mail eines mächtigeren Kontos nicht", async () => {
    assertDenied((await edit(victim, { active: false })));
    assertDenied((await edit(victim, { email: "x@example.org" })));
    const row = await env.db.user.findUniqueOrThrow({ where: { id: victim.id } });
    assert.equal(row.active, true);
    assert.equal(row.email, null);
  });

  it("ändert ein Administrator-Konto nicht (auch nicht mit allen Rechten des Aufrufers)", async () => {
    const before = await hashOf(admin2);
    assertDenied((await edit(admin2, { password: "ubernommen-123" })));
    assert.equal(await hashOf(admin2), before);
  });

  it("vergibt die Administrator-Rolle nicht – weder beim Anlegen noch beim Ändern (manipuliertes FormData)", async () => {
    const created = await actions.saveUser({}, form({ username: "neu", name: "Neu", password: "neues-pass-123", roleId: [adminRole.id] }));
    assertDenied(created);
    assert.equal(await env.db.user.count({ where: { username: "neu" } }), 0);
    assertDenied((await edit(basic, { roleId: [lowRole.id, adminRole.id] })));
    assert.deepEqual(await rolesOf(basic), [lowRole.id]);
  });

  it("vergibt keine Rolle mit Rechten, die der Aufrufer nicht hat", async () => {
    assertDenied((await edit(basic, { roleId: [powerRole.id] })));
    assert.deepEqual(await rolesOf(basic), [lowRole.id]);
  });

  it("vergibt keine Rolle mit adminOnly-Rechten – auch nicht, wenn der Aufrufer sie selbst besitzt", async () => {
    assertDenied((await edit(basic, { roleId: [lowRole.id, usersAdminRole.id] })));
    assertDenied((await edit(basic, { roleId: [managerRole.id] })));
    assert.deepEqual(await rolesOf(basic), [lowRole.id]);
  });

  it("entzieht keine Rolle, die der Aufrufer nicht vergeben dürfte", async () => {
    const both = await env.user({ username: "both", roles: [lowRole, usersAdminRole] });
    // „both“ hat usersAdminRole (users.manage) – eine Teilmenge der Verwalter-Rechte, aber adminOnly: nur Admins dürfen sie entziehen
    assertDenied((await edit(both, { roleId: [lowRole.id] })));
    assert.deepEqual(await rolesOf(both), [lowRole.id, usersAdminRole.id].sort());
  });

  it("ändert ein Konto, dessen Rechte eine Teilmenge der eigenen sind (Passwort, Rollen)", async () => {
    const before = await hashOf(basic);
    const target = await redirectOf(() => edit(basic, { password: "neues-pass-456", roleId: [lowRole.id] }));
    assert.match(target ?? "", /^\/admin\/users\?saved=/);
    assert.notEqual(await hashOf(basic), before);
  });

  it("legt ein Konto mit zulässiger Rolle an", async () => {
    const target = await redirectOf(() => actions.saveUser({}, form({ username: "neu", name: "Neu", password: "neues-pass-123", roleId: [lowRole.id] })));
    assert.match(target ?? "", /^\/admin\/users\?saved=/);
  });

  it("berücksichtigt Rohrechte ausgeschalteter Funktionen: auch dann kein Zugriff auf ein Konto mit deren Rechten", async () => {
    const invoicesOnly = await env.role({ key: "inv", permissions: ["invoices.view"] });
    const hidden = await env.user({ username: "hidden", password: "hidden-pass-1", roles: [invoicesOnly] });
    await env.db.featureSetting.create({ data: { key: "office.invoices", enabled: false, updatedByName: "test" } });
    const before = await hashOf(hidden);
    assertDenied((await edit(hidden, { password: "ubernommen-123" })));
    assert.equal(await hashOf(hidden), before);
  });

  it("ein Administrator darf weiterhin alles", async () => {
    await env.signIn(admin2);
    const target = await redirectOf(() => edit(victim, { password: "vom-admin-123", roleId: [powerRole.id, adminRole.id] }));
    assert.match(target ?? "", /^\/admin\/users\?saved=/);
    assert.deepEqual(await rolesOf(victim), [powerRole.id, adminRole.id].sort());
  });

  it("eigene Rechte erweitert man sich nicht: Verwalter vergibt sich keine zusätzliche Rolle", async () => {
    assertDenied((await edit(manager, { roleId: [managerRole.id, powerRole.id] })));
    assert.deepEqual(await rolesOf(manager), [managerRole.id]);
  });
});

describe("deleteUser – Rechte-Hierarchie", () => {
  it("löscht kein Konto mit mächtigerer Rolle und kein Administrator-Konto", async () => {
    await redirectOf(() => actions.deleteUser(form({ id: victim.id })));
    await redirectOf(() => actions.deleteUser(form({ id: admin2.id })));
    assert.equal(await env.db.user.count({ where: { id: { in: [victim.id, admin2.id] } } }), 2);
  });

  it("löscht ein Konto, dessen Rechte eine Teilmenge der eigenen sind", async () => {
    await redirectOf(() => actions.deleteUser(form({ id: basic.id })));
    assert.equal(await env.db.user.count({ where: { id: basic.id } }), 0);
  });
});

describe("unlockUser – Rechte-Hierarchie", () => {
  const lock = (u: User) => env.db.user.update({ where: { id: u.id }, data: { failedLogins: 6, lockedUntil: new Date(Date.now() + 60_000) } });
  const state = async (u: User) => {
    const row = await env.db.user.findUniqueOrThrow({ where: { id: u.id } });
    return { failed: row.failedLogins, locked: row.lockedUntil !== null };
  };

  it("hebt die Wartezeit eines Kontos auf, dessen Rechte eine Teilmenge der eigenen sind, und protokolliert das Konto im Audit", async () => {
    await lock(basic);
    const target = await redirectOf(() => actions.unlockUser(form({ id: basic.id })));
    assert.equal(target, `/admin/users/${basic.id}?unlocked=1`);
    assert.deepEqual(await state(basic), { failed: 0, locked: false });
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "user.unlock" } });
    assert.equal(entry.target, "basic");
    assert.equal(entry.entityId, basic.id);
  });

  it("ändert die Version (updatedAt) des Kontos nicht: ein geöffnetes Benutzerformular meldet danach keinen Konflikt", async () => {
    await lock(basic);
    const before = (await env.db.user.findUniqueOrThrow({ where: { id: basic.id } })).updatedAt.getTime();
    await redirectOf(() => actions.unlockUser(form({ id: basic.id })));
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: basic.id } })).updatedAt.getTime(), before);
  });

  it("lässt die Wartezeit eines mächtigeren Kontos und eines Administrator-Kontos stehen", async () => {
    await lock(victim);
    await lock(admin2);
    for (const u of [victim, admin2]) {
      // ohne Formularzustand: keine Weiterleitung, die Ablehnung kommt als Flash-Meldung (Schlüssel der Rechte-Hierarchie)
      assert.equal(await redirectOf(() => actions.unlockUser(form({ id: u.id }))), null);
      assert.match(lastFlash()?.key ?? "", /^rbac\.denied\./);
      assert.equal(lastFlash()?.tone, "error");
      assert.deepEqual(await state(u), { failed: 6, locked: true });
    }
  });

  it("ohne Recht users.manage geht es nach /forbidden; ein unbekanntes Konto wird gemeldet", async () => {
    await lock(basic);
    await env.signIn(basic);
    assert.equal(await redirectOf(() => actions.unlockUser(form({ id: basic.id }))), "/forbidden");
    assert.deepEqual(await state(basic), { failed: 6, locked: true });
    await env.signIn(manager);
    assert.equal(await redirectOf(() => actions.unlockUser(form({ id: "gibt-es-nicht" }))), null);
    assert.equal(lastFlash()?.key, "common.errors.notFound");
  });
});

describe("deleteUser und saveUser – Schutz der eigenen Person und des letzten Administrators", () => {
  it("löscht das eigene Konto nicht", async () => {
    assert.equal(await redirectOf(() => actions.deleteUser(form({ id: manager.id }))), "/admin/users");
    assert.equal(await env.db.user.count({ where: { id: manager.id } }), 1);
    await env.signIn(admin2);
    await redirectOf(() => actions.deleteUser(form({ id: admin2.id })));
    assert.equal(await env.db.user.count({ where: { id: admin2.id } }), 1);
  });

  it("ein Administrator löscht einen zweiten Administrator nur, solange er selbst als aktiver Administrator übrig bleibt", async () => {
    const admin3 = await env.user({ username: "admin3", roles: [adminRole] });
    await env.signIn(admin2);
    assert.equal(await redirectOf(() => actions.deleteUser(form({ id: admin3.id }))), "/admin/users");
    assert.equal(await env.db.user.count({ where: { id: admin3.id } }), 0);
    assert.equal(await env.db.user.count({ where: { id: admin2.id } }), 1, "der letzte Administrator bleibt");
  });

  it("der einzige aktive Administrator kann sich weder die Rolle nehmen noch sich deaktivieren (saveUser)", async () => {
    await env.signIn(admin2);
    const noRole = await edit(admin2, { roleId: [] });
    assert.equal(noRole.error, de.users.errors.lastAdmin);
    const inactive = await edit(admin2, { active: false });
    assert.equal(inactive.error, de.users.errors.lastAdmin);
    assert.deepEqual(await rolesOf(admin2), [adminRole.id]);
    // mit einem zweiten aktiven Administrator geht die Rollenänderung
    await env.user({ username: "admin3", roles: [adminRole] });
    const target = await redirectOf(() => edit(admin2, { roleId: [lowRole.id] }));
    assert.match(target ?? "", /^\/admin\/users\?saved=/);
  });
});

describe("saveUser – gleichzeitiges Bearbeiten", () => {
  it("zwei gleichzeitige Speicherungen derselben Version: genau eine gewinnt, die andere meldet den Konflikt (nichts geht still verloren)", async () => {
    const fresh = await env.db.user.findUniqueOrThrow({ where: { id: basic.id }, include: { roles: true } });
    const { versionOf } = await import("@/lib/concurrency");
    const submit = (name: string) =>
      actions.saveUser({}, form({ id: basic.id, version: versionOf(fresh), username: basic.username, name, active: true, roleId: fresh.roles.map((r) => r.roleId) }));
    const results = await Promise.allSettled([submit("Name A"), submit("Name B"), submit("Name C")]);
    const redirected = results.filter((r) => r.status === "rejected" && /NEXT_REDIRECT/.test(String(r.reason)));
    const conflicts = results.filter((r) => r.status === "fulfilled" && r.value.error === de.common.conflict);
    assert.equal(redirected.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(conflicts.length, 2);
    assert.match((await env.db.user.findUniqueOrThrow({ where: { id: basic.id } })).name, /^Name [ABC]$/);
  });

  it("eine Anmeldung zwischen Öffnen und Speichern erzeugt keinen Schein-Konflikt (Anmeldezähler ändern die Version nicht)", async () => {
    const fresh = await env.db.user.findUniqueOrThrow({ where: { id: basic.id }, include: { roles: true } });
    const { versionOf } = await import("@/lib/concurrency");
    const { login } = await import("@/server/auth/session");
    await login("basic", "falsches-passwort-1"); // Fehlversuch
    await login("basic", "basic-pass-1"); // Anmeldung
    await env.signIn(manager); // die Anmeldung hat den Fake-Browser auf „basic“ gestellt
    const target = await redirectOf(() =>
      actions.saveUser({}, form({ id: basic.id, version: versionOf(fresh), username: basic.username, name: "Neuer Name", active: true, roleId: fresh.roles.map((r) => r.roleId) })),
    );
    assert.match(target ?? "", /^\/admin\/users\?saved=/);
  });
});
