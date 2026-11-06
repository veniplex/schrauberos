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
