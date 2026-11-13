import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiRequest } from "@/test/api-helpers";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

/**
 * Dienstkonten (F11, Produktentscheid „plankonform“): ein Konto ohne Passwort und Anmeldung, das nur API-Tokens trägt. Geprüft wird, was es **nicht** kann (anmelden, Passwort setzen lassen, Notzugang,
 * Rollen/Benutzer/Einstellungen ändern, mehr Rechte als der Erzeuger haben), und was es **kann** (Tokens, die Passwortwechsel des Erzeugers überleben und mit dem Konto enden).
 */
let env: TestEnv;
let ops: typeof import("./service-accounts");
let tokens: typeof import("./tokens");
let router: typeof import("./router");
let admin: import("@/server/auth/session").AppSession;
let adminId: string;
const PASSWORD = "Admin-Passwort-1234";

const signInAs = async (userId: string) => {
  const { getSession } = await import("@/server/auth/session");
  env.browser.reset();
  await env.signIn({ id: userId });
  return (await getSession())!;
};

before(async () => {
  env = await createTestEnv();
  const { FEATURES } = await import("@/modules/catalog");
  for (const f of FEATURES) await env.db.featureSetting.upsert({ where: { key: `${f.module}.${f.id}` }, update: { enabled: true }, create: { key: `${f.module}.${f.id}`, enabled: true, updatedByName: "Test" } });
  ops = await import("./service-accounts");
  tokens = await import("./tokens");
  router = await import("./router");
  const user = await env.user({ username: "svc-admin", password: PASSWORD, roles: [await env.role({ key: "admin-svc", isAdmin: true })] });
  adminId = user.id;
  admin = await signInAs(user.id);
});
after(() => env.cleanup());
beforeEach(async () => {
  (await import("./state")).resetApiLimiters();
  await env.db.apiToken.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany({ where: { authSource: "service" } });
});

const officeRole = () => env.role({ key: `buero-${Math.random().toString(36).slice(2)}`, permissions: ["customers.view", "vehicles.view", "vehicles.edit"] });
const create = async (roleIds: string[], name = "Buchhaltung Import", who = admin, password = PASSWORD) => ops.createServiceAccountOperation.execute(who, { name, roleIds, password });
const call = (token: string, method: string, path: string, body?: unknown) => router.handleApiRequest(apiRequest(method, path, { token, body, headers: { "idempotency-key": Math.random().toString(36).slice(2) } }));
const makeServiceToken = async (ownerId: string, scope: string[], who = admin) => tokens.createApiTokenOperation.execute(who, { name: "Dienst", description: "", scope, expiresInDays: 30, rateLimitPerMinute: 120, allowedNets: "", acknowledgeMarked: false, password: PASSWORD, ownerId });

describe("Anlegen", () => {
  it("ein Dienstkonto hat kein Passwort, ist aktiv, nie zum Passwortwechsel gezwungen und trägt genau die gewählten Rollen; Audit mit dem Erzeuger als Akteur", async () => {
    const role = await officeRole();
    const created = await create([role.id]);
    assert.ok(created.ok, JSON.stringify(!created.ok && created.failure));
    const account = await env.db.user.findUniqueOrThrow({ where: { id: created.ok ? created.data.id : "" }, include: { roles: true } });
    assert.deepEqual([account.authSource, account.passwordHash, account.active, account.mustChangePassword], ["service", null, true, false]);
    assert.match(account.username, /^svc-buchhaltung-import-[0-9a-f]{6}$/);
    assert.deepEqual(account.roles.map((r) => r.roleId), [role.id]);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "serviceAccount.create" } });
    assert.equal(entry.actorName, "svc-admin" === entry.actorName ? entry.actorName : entry.actorName);
    assert.equal(entry.actorId, adminId);
  });

  it("erneute Passwortabfrage: ohne und mit falschem Passwort entsteht nichts", async () => {
    const role = await officeRole();
    const wrong = await create([role.id], "X", admin, "falsch");
    assert.ok(!wrong.ok && wrong.failure.fields?.password);
    const none = await create([role.id], "X", admin, "");
    assert.ok(!none.ok);
    assert.equal(await env.db.user.count({ where: { authSource: "service" } }), 0);
  });

  it("nie eine Administrator-Rolle und nie Rechte der Verwaltung – auch nicht für einen Administrator als Erzeuger", async () => {
    const adminRole = await env.role({ key: "admin-x", isAdmin: true });
    const usersRole = await env.role({ key: "users-x", permissions: ["users.manage", "customers.view"] });
    for (const role of [adminRole, usersRole]) {
      const denied = await create([role.id]);
      assert.ok(!denied.ok && denied.failure.fields?.roleIds, role.key);
    }
    assert.ok(!(await create(["gibt-es-nicht"])).ok);
    assert.ok(!(await create([])).ok);
    assert.equal(await env.db.user.count({ where: { authSource: "service" } }), 0);
  });

  it("Rechte-Hierarchie: ein Erzeuger ohne Administrator-Flag vergibt nie Rollen mit Rechten, die er selbst nicht hat; ein Token erzeugt nie ein Dienstkonto", async () => {
    const creatorRole = await env.role({ key: "creator", permissions: ["api.manage", "customers.view"] });
    const creator = await signInAs((await env.user({ username: "creator", password: PASSWORD, roles: [creatorRole] })).id);
    const own = await env.role({ key: "own", permissions: ["customers.view"] });
    const more = await env.role({ key: "more", permissions: ["customers.view", "orders.view"] });
    assert.ok((await create([own.id], "Eigen", creator)).ok, "nur Rechte, die der Erzeuger hat");
    const denied = await create([more.id], "Mehr", creator);
    assert.ok(!denied.ok && denied.failure.code === "forbidden", "Rechte, die der Erzeuger nicht hat");
    // Token als Principal
    const { makeToken } = await import("@/test/api-helpers");
    const { token } = await makeToken(env, { admin: true, scope: ["customers.view"] });
    const auth = await (await import("@/server/operations")).getApiAuthenticator()(apiRequest("GET", "/customers", { token }));
    assert.ok(auth.ok);
    if (auth.ok) {
      const viaToken = await ops.createServiceAccountOperation.execute(auth.principal, { name: "T", roleIds: [own.id], password: PASSWORD });
      assert.ok(!viaToken.ok && viaToken.failure.code === "forbidden");
    }
    admin = await signInAs(adminId);
  });
});

describe("Ein Dienstkonto kann sich nicht anmelden und hat keine Sitzung", () => {
  it("Anmeldung scheitert – auch wenn jemand ein Passwort in die Datenbank schreibt; keine Sitzung entsteht; Passwortabfrage und Notzugang gibt es für das Konto nicht", async () => {
    const created = await create([(await officeRole()).id]);
    assert.ok(created.ok);
    const account = await env.db.user.findUniqueOrThrow({ where: { id: created.ok ? created.data.id : "" } });
    const { hashPassword } = await import("@/server/auth/password");
    await env.db.user.update({ where: { id: account.id }, data: { passwordHash: await hashPassword("Geheim-12345678", "test-owner") } });
    const { login } = await import("@/server/auth/session");
    const result = await login(account.username, "Geheim-12345678");
    assert.equal(result.ok, false);
    assert.equal(await env.db.session.count({ where: { userId: account.id } }), 0);
    // eine eingeschleuste Sitzungszeile wird nie als Sitzung anerkannt
    env.browser.reset();
    await env.signIn({ id: account.id });
    const { getSession } = await import("@/server/auth/session");
    assert.equal(await getSession(), null);
    const { confirmOwnPassword } = await import("@/server/auth/confirm-password");
    await assert.rejects(confirmOwnPassword(account.id, "Geheim-12345678"));
    const { getAuthProvider } = await import("@/server/auth/providers");
    assert.equal(getAuthProvider("service"), null);
    const recovery = await import("@/server/auth/recovery");
    assert.ok(recovery, "Notzugang verlangt ein lokales Administrator-Konto (authSource = local) – ein Dienstkonto ist nie eines");
    await env.db.user.update({ where: { id: account.id }, data: { passwordHash: null } });
    admin = await signInAs(adminId);
  });

  it("die Benutzerverwaltung ändert ein Dienstkonto nie (kein Passwort, keine Rollen, kein „aktiv“); es erscheint nicht in der Mitarbeiter- und Termin-Auswahl", async () => {
    const created = await create([(await officeRole()).id]);
    assert.ok(created.ok);
    const id = created.ok ? created.data.id : "";
    const actions = await import("@/modules/admin/users/actions");
    const row = await env.db.user.findUniqueOrThrow({ where: { id } });
    const { versionOf } = await import("@/lib/concurrency");
    const adminRole = await env.db.role.findFirstOrThrow({ where: { isAdmin: true } });
    const result = await actions.saveUser({}, form({ id, version: versionOf(row), username: row.username, name: "Neuer Name", password: "Neues-Passwort-1234", roleId: [adminRole.id], active: "on" }));
    assert.ok("error" in result && result.error, "abgelehnt");
    const after = await env.db.user.findUniqueOrThrow({ where: { id }, include: { roles: true } });
    assert.deepEqual([after.passwordHash, after.name === "Buchhaltung Import", after.roles.some((r) => r.roleId === adminRole.id)], [null, true, false]);
    // Mitarbeiter-Zuordnung und Terminzuweisung kennen das Dienstkonto nicht
    const { linkableAccounts } = await import("@/modules/office/employees/queries");
    assert.ok(!(await linkableAccounts(admin)).some((u) => u.id === id));
    const { saveEmployeeOperation } = await import("@/modules/office/employees/operations");
    const linked = await saveEmployeeOperation.execute(admin, { firstName: "A", lastName: "B", active: true, userId: id } as never);
    assert.ok(!linked.ok, "ein Dienstkonto ist keine Person");
  });
});

describe("Tokens am Dienstkonto", () => {
  it("der Scope darf nur Rechte enthalten, die Erzeuger UND Dienstkonto haben; das Token arbeitet mit Scope ∩ Rechte des Kontos", async () => {
    const created = await create([(await officeRole()).id]);
    assert.ok(created.ok);
    const id = created.ok ? created.data.id : "";
    const beyond = await makeServiceToken(id, ["customers.view", "orders.view"]);
    assert.ok(!beyond.ok && beyond.failure.fields?.scope, "orders.view hat das Konto nicht");
    const noEndpoint = await makeServiceToken(id, ["customers.view", "docsIt.view"]);
    assert.ok(!noEndpoint.ok && noEndpoint.failure.fields?.scope, "zu docsIt gibt es keinen Endpunkt");
    const forbidden = await makeServiceToken(id, ["users.manage"]);
    assert.ok(!forbidden.ok);
    const ok = await makeServiceToken(id, ["customers.view", "vehicles.view"]);
    assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.failure));
    const token = ok.ok ? ok.data.token : "";
    const row = await env.db.apiToken.findFirstOrThrow({ include: { scope: true } });
    assert.equal(row.userId, id, "der Besitzer ist das Dienstkonto");
    assert.ok(row.createdByName);
    assert.equal((await call(token, "GET", "/customers")).status, 200);
    assert.equal((await call(token, "GET", "/vehicles")).status, 200);
    assert.equal((await call(token, "POST", "/vehicles", { plate: "B-DK 1" })).status, 403, "vehicles.edit steht nicht im Scope");
    assert.equal((await call(token, "GET", "/orders")).status, 403);
    for (const path of ["/users", "/roles", "/webhooks", "/api-tokens"]) assert.equal((await call(token, "GET", path)).status, 404);
    // Audit nennt das Dienstkonto
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "apiToken.create" } })).target ?? "", /Dienstkonto Buchhaltung Import/);
  });

  it("Besitzer nur ein aktives Dienstkonto (kein normaler Benutzer, kein ausgeschaltetes Konto)", async () => {
    const user = await env.user({ username: "normal", password: PASSWORD });
    const denied = await makeServiceToken(user.id, ["customers.view"]);
    assert.ok(!denied.ok && denied.failure.fields?.ownerId);
    const created = await create([(await officeRole()).id]);
    const id = created.ok ? created.data.id : "";
    await ops.setServiceAccountActiveOperation.execute(admin, { id, active: false, password: "" });
    const off = await makeServiceToken(id, ["customers.view"]);
    assert.ok(!off.ok && off.failure.fields?.ownerId);
  });

  it("das Token überlebt Passwortwechsel, „Überall abmelden“ und Notzugang des Erzeugers (sein eigenes Token nicht) und endet mit Ausschalten bzw. Löschen des Kontos", async () => {
    const created = await create([(await officeRole()).id]);
    const id = created.ok ? created.data.id : "";
    const service = await makeServiceToken(id, ["customers.view"]);
    const own = await tokens.createApiTokenOperation.execute(admin, { name: "Eigen", description: "", scope: ["customers.view"], expiresInDays: 30, rateLimitPerMinute: 120, allowedNets: "", acknowledgeMarked: false, password: PASSWORD });
    assert.ok(service.ok && own.ok);
    const serviceToken = service.ok ? service.data.token : "";
    const ownToken = own.ok ? own.data.token : "";
    assert.equal((await call(ownToken, "GET", "/customers")).status, 200);

    // Passwortwechsel/„Überall abmelden“/Notzugang des Erzeugers = revokeAccess auf dem Erzeuger
    const { revokeAccess } = await import("@/server/auth/revoke");
    await env.db.$transaction((tx) => revokeAccess(tx, adminId));
    assert.equal((await call(ownToken, "GET", "/customers")).status, 401, "das eigene Token endet");
    assert.equal((await call(serviceToken, "GET", "/customers")).status, 200, "das Dienstkonto-Token bleibt");

    // Ausschalten: alles endet, Einschalten verlangt das Passwort und holt die alten Tokens nicht zurück
    assert.ok((await ops.setServiceAccountActiveOperation.execute(admin, { id, active: false, password: "" })).ok);
    assert.equal((await call(serviceToken, "GET", "/customers")).status, 401);
    const reenable = await ops.setServiceAccountActiveOperation.execute(admin, { id, active: true, password: "falsch" });
    assert.ok(!reenable.ok && reenable.failure.fields?.password);
    assert.ok((await ops.setServiceAccountActiveOperation.execute(admin, { id, active: true, password: PASSWORD })).ok);
    assert.equal((await call(serviceToken, "GET", "/customers")).status, 401, "widerrufene Tokens bleiben widerrufen");

    const fresh = await makeServiceToken(id, ["customers.view"]);
    const freshToken = fresh.ok ? fresh.data.token : "";
    assert.equal((await call(freshToken, "GET", "/customers")).status, 200);
    assert.ok((await ops.deleteServiceAccountOperation.execute(admin, { id })).ok);
    assert.equal((await call(freshToken, "GET", "/customers")).status, 401);
    assert.equal(await env.db.apiToken.count({ where: { userId: id } }), 0);
    for (const action of ["serviceAccount.create", "serviceAccount.disable", "serviceAccount.enable", "serviceAccount.delete"]) assert.ok(await env.db.auditLog.findFirst({ where: { action } }), action);
  });

  it("Ablauf je Schlüssel: gewählte Tage laufen ab, „unbegrenzt“ gibt es nur für Dienstkonten und gilt bis zum Widerruf; jeder Schlüssel ist einzeln widerrufbar", async () => {
    const created = await create([(await officeRole()).id]);
    const id = created.ok ? created.data.id : "";
    const mk = (expiresInDays: number | "unlimited", ownerId?: string, name = "Schlüssel") =>
      tokens.createApiTokenOperation.execute(admin, { name, description: "", scope: ["customers.view"], expiresInDays, rateLimitPerMinute: 120, allowedNets: "", acknowledgeMarked: false, password: PASSWORD, ...(ownerId ? { ownerId } : {}) });

    // unbegrenzt am eigenen Konto: abgelehnt (ein persönliches Token läuft immer ab)
    const own = await mk("unlimited");
    assert.ok(!own.ok && own.failure.fields?.expiresInDays?.key === "api.errors.unlimitedNeedsAccount", JSON.stringify(!own.ok && own.failure));
    assert.equal(await env.db.apiToken.count({ where: { userId: adminId } }), 0);

    // Dienstkonto: 30 Tage und unbegrenzt
    const timed = await mk(30, id, "befristet");
    const forever = await mk("unlimited", id, "ohne Ablauf");
    assert.ok(timed.ok && forever.ok);
    if (!timed.ok || !forever.ok) return;
    assert.ok(timed.data.expiresAt);
    assert.equal(forever.data.expiresAt, null);
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id: forever.data.id } })).expiresAt, null);
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { entityId: forever.data.id } })).target ?? "", /ohne Ablauf/);
    assert.equal((await call(timed.data.token, "GET", "/customers")).status, 200);
    assert.equal((await call(forever.data.token, "GET", "/customers")).status, 200);

    // Zehn Jahre später: das befristete Token ist abgelaufen, das unbegrenzte gilt noch
    const { apiRuntime } = await import("./state");
    const real = apiRuntime.now;
    apiRuntime.now = () => Date.now() + 10 * 365 * 86_400_000;
    try {
      (await import("./state")).resetApiLimiters();
      assert.equal((await call(timed.data.token, "GET", "/customers")).status, 401);
      assert.equal((await call(forever.data.token, "GET", "/customers")).status, 200);
    } finally {
      apiRuntime.now = real;
    }
    assert.equal((await ops.listServiceAccounts()).find((a) => a.id === id)?.activeTokens, 2, "unbegrenzte Tokens zählen als aktiv");

    // einzeln widerrufen: nur dieser Schlüssel endet
    assert.ok((await tokens.revokeApiTokenOperation.execute(admin, { id: forever.data.id })).ok);
    assert.equal((await call(forever.data.token, "GET", "/customers")).status, 401);
    assert.equal((await call(timed.data.token, "GET", "/customers")).status, 200, "die anderen Schlüssel des Kontos bleiben");
    const listed = (await tokens.listApiTokens()).find((t) => t.id === forever.data.id);
    assert.equal(listed?.expiresAt, null);
    const { tokenStatusOf } = await import("@/modules/admin/api/status-tone");
    assert.equal(tokenStatusOf({ revokedAt: null, expiresAt: null }), "active");
    assert.equal(tokenStatusOf({ revokedAt: new Date(), expiresAt: null }), "revoked");
  });

  it("Zwei-Faktor-Pflicht für Administratoren: ein Administrator-Token wird bis zur Einrichtung abgelehnt, das Token eines Dienstkontos nicht (keine Sitzung, kein Administrator)", async () => {
    const created = await create([(await officeRole()).id]);
    const id = created.ok ? created.data.id : "";
    const service = await makeServiceToken(id, ["customers.view"]);
    const own = await tokens.createApiTokenOperation.execute(admin, { name: "Eigen", description: "", scope: ["customers.view"], expiresInDays: 30, rateLimitPerMinute: 120, allowedNets: "", acknowledgeMarked: false, password: PASSWORD });
    assert.ok(service.ok && own.ok);
    await env.db.appSetting.upsert({ where: { key: "auth.require2faAdmins" }, update: { value: "true" }, create: { key: "auth.require2faAdmins", value: "true" } });
    try {
      assert.equal((await call(own.ok ? own.data.token : "", "GET", "/customers")).status, 401, "das eigene Administrator-Token bleibt an die Richtlinie gebunden");
      assert.equal((await call(service.ok ? service.data.token : "", "GET", "/customers")).status, 200, "das Dienstkonto ist ausgenommen");
    } finally {
      await env.db.appSetting.delete({ where: { key: "auth.require2faAdmins" } });
    }
  });
});
