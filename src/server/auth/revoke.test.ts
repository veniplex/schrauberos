import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

/**
 * Zugang widerrufen (ZP2-S-F01, S-F09/Q-3): Wer das Passwort ändert – selbst, durch die Administration oder per Notzugang –, beendet Sitzungen, bekannte Geräte
 * **und API-Tokens** des Kontos, und zwar in derselben Transaktion wie die Passwortänderung (kein Zustand dazwischen).
 */
let env: TestEnv;
let userActions: typeof import("@/modules/admin/users/actions");
let accountActions: typeof import("@/platform/account/actions");
let recovery: typeof import("./recovery");
let router: typeof import("@/server/api/router");
let state: typeof import("@/server/api/state");
let throttle: typeof import("./throttle");
let passwordMod: typeof import("./password");

const OLD = "altes-passwort-123";
const NEW = "neues-passwort-456";

before(async () => {
  env = await createTestEnv();
  userActions = await import("@/modules/admin/users/actions");
  accountActions = await import("@/platform/account/actions");
  recovery = await import("./recovery");
  router = await import("@/server/api/router");
  state = await import("@/server/api/state");
  throttle = await import("./throttle");
  passwordMod = await import("./password");
  const runtime = await import("./runtime");
  runtime.authRuntime.sleep = async () => undefined;
});
after(() => env.cleanup());

let admin: Awaited<ReturnType<TestEnv["user"]>>;
let target: Awaited<ReturnType<TestEnv["user"]>>;
let bystander: Awaited<ReturnType<TestEnv["user"]>>;

beforeEach(async () => {
  await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_session_delete"');
  await env.db.apiToken.deleteMany();
  await env.db.knownDevice.deleteMany();
  await env.db.session.deleteMany();
  await env.db.recoveryCode.deleteMany();
  await env.db.recoveryNotice.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  env.browser.reset();
  throttle.resetLoginThrottle();
  state.resetApiLimiters();
  const adminRole = await env.role({ key: "admin", isAdmin: true, isSystem: true });
  const lowRole = await env.role({ key: "low", permissions: ["customers.view"] });
  admin = await env.user({ username: "chef", name: "Chef", password: OLD, roles: [adminRole] });
  target = await env.user({ username: "anna", name: "Anna", password: OLD, roles: [lowRole] });
  bystander = await env.user({ username: "bernd", name: "Bernd", password: OLD, roles: [lowRole] });
});

/** Ein Konto mit Sitzung, bekanntem Gerät und zwei Tokens (eines davon wird gleich abgefragt). */
async function accessOf(user: typeof target) {
  await env.db.session.create({ data: { tokenHash: `fremd-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  await env.db.knownDevice.create({ data: { userId: user.id, tokenHash: `geraet-${user.id}` } });
  const a = await makeToken(env, { scope: ["customers.view"], ownerId: user.id });
  const b = await makeToken(env, { scope: ["customers.view"], ownerId: user.id });
  return { a, b };
}
const counts = async (user: typeof target) => ({
  sessions: await env.db.session.count({ where: { userId: user.id } }),
  devices: await env.db.knownDevice.count({ where: { userId: user.id } }),
  liveTokens: await env.db.apiToken.count({ where: { userId: user.id, revokedAt: null } }),
});
const callApi = async (token: string) => (await router.handleApiRequest(apiRequest("GET", "/customers", { token }))).status;

const adminSetsPassword = async (user: typeof target, extra: Record<string, string | boolean> = {}) => {
  const fresh = await env.db.user.findUniqueOrThrow({ where: { id: user.id }, include: { roles: true } });
  try {
    return await userActions.saveUser({}, form({ id: fresh.id, version: versionOf(fresh), username: fresh.username, name: fresh.name, active: fresh.active, roleId: fresh.roles.map((r) => r.roleId), ...extra }));
  } catch (error) {
    // Redirect-Signal der Aktion bei Erfolg: kein Fehler
    if (error instanceof Error && /redirect|NEXT_REDIRECT/i.test(`${error.name} ${error.message}`)) return {};
    throw error;
  }
};
const hashOf = async (user: typeof target) => (await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;

describe("Administration setzt ein Passwort oder deaktiviert das Konto", () => {
  it("beendet Sitzungen, bekannte Geräte und API-Tokens des Kontos – nicht die anderer Konten; das Token wirkt danach nicht mehr", async () => {
    const { a, b } = await accessOf(target);
    await accessOf(bystander);
    await env.signIn(admin);
    assert.equal(await callApi(a.token), 200, "vorher gilt das Token");

    await adminSetsPassword(target, { password: NEW });

    assert.deepEqual(await counts(target), { sessions: 0, devices: 0, liveTokens: 0 });
    assert.deepEqual(await counts(bystander), { sessions: 1, devices: 1, liveTokens: 2 });
    assert.equal(await callApi(a.token), 401);
    assert.equal(await callApi(b.token), 401);
    assert.equal(await passwordMod.verifyPassword(NEW, await hashOf(target)), true);
  });

  it("Deaktivieren beendet ebenfalls alles; ein erneutes Aktivieren belebt keine Tokens wieder", async () => {
    const { a } = await accessOf(target);
    await env.signIn(admin);
    await adminSetsPassword(target, { active: false });
    assert.deepEqual(await counts(target), { sessions: 0, devices: 0, liveTokens: 0 });
    await adminSetsPassword(target, { active: true });
    assert.equal(await callApi(a.token), 401, "das Token bleibt widerrufen");
  });

  it("eine Änderung ohne Passwort und ohne Deaktivierung lässt alles stehen", async () => {
    await accessOf(target);
    await env.signIn(admin);
    await adminSetsPassword(target, { name: "Anna Neu" });
    assert.deepEqual(await counts(target), { sessions: 1, devices: 1, liveTokens: 2 });
  });

  it("atomar: scheitert das Beenden der Sitzungen, bleibt das alte Passwort und alles andere unverändert (nichts dazwischen)", async () => {
    await accessOf(target);
    await env.signIn(admin);
    const before = await hashOf(target);
    await env.db.$executeRawUnsafe(`CREATE TRIGGER "test_block_session_delete" BEFORE DELETE ON "Session" BEGIN SELECT RAISE(ABORT, 'blockiert'); END`);
    try {
      const result = await adminSetsPassword(target, { password: NEW }).catch(() => ({ error: "thrown" }));
      assert.ok((result as { error?: string }).error, "die Aktion meldet den Fehler (und ändert nichts)");
    } finally {
      await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_session_delete"');
    }
    assert.equal(await hashOf(target), before, "das Passwort wurde nicht geändert");
    assert.deepEqual(await counts(target), { sessions: 1, devices: 1, liveTokens: 2 });
    assert.equal(await env.db.auditLog.count({ where: { action: "user.update" } }), 0, "kein Audit-Eintrag ohne Änderung");
  });
});

describe("Passwortwechsel im Konto", () => {
  it("beendet andere Sitzungen und Geräte, behält die eigene, widerruft die API-Tokens des Kontos", async () => {
    const { a } = await accessOf(target);
    await accessOf(bystander);
    await env.signIn(target); // eigene Sitzung (und eigenes Geräte-Cookie wird nicht gesetzt: nur Sitzung)
    const own = await env.db.session.count({ where: { userId: target.id } });
    assert.equal(own, 2);

    const result = await accountActions.changePassword({}, form({ current: OLD, next: NEW, confirm: NEW }));
    assert.equal(result.ok, true);

    assert.equal((await counts(target)).sessions, 1, "nur die eigene Sitzung bleibt");
    assert.equal((await counts(target)).liveTokens, 0);
    assert.equal(await callApi(a.token), 401);
    assert.deepEqual(await counts(bystander), { sessions: 1, devices: 1, liveTokens: 2 });
  });

  it("atomar: scheitert das Beenden der Sitzungen, gilt das alte Passwort weiter", async () => {
    await accessOf(target);
    await env.signIn(target);
    const before = await hashOf(target);
    await env.db.$executeRawUnsafe(`CREATE TRIGGER "test_block_session_delete" BEFORE DELETE ON "Session" BEGIN SELECT RAISE(ABORT, 'blockiert'); END`);
    try {
      const result = await accountActions.changePassword({}, form({ current: OLD, next: NEW, confirm: NEW })).catch(() => ({ error: "thrown" }));
      assert.ok((result as { error?: string }).error, "die Aktion meldet den Fehler (und ändert nichts)");
    } finally {
      await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_session_delete"');
    }
    assert.equal(await hashOf(target), before);
    assert.equal((await counts(target)).liveTokens, 2);
  });
});

describe("Notzugang einlösen", () => {
  it("widerruft die API-Tokens des Administrator-Kontos (neben Sitzungen und Geräten)", async () => {
    const { a } = await accessOf(admin);
    const code = await env.db.$transaction((tx) => recovery.replaceRecoveryCode(tx, admin.id));
    const result = await recovery.redeemRecoveryCode({ code, password: NEW, ip: null });
    assert.equal(result.ok, true);
    assert.deepEqual(await counts(admin), { sessions: 0, devices: 0, liveTokens: 0 });
    assert.equal(await callApi(a.token), 401);
  });
});
