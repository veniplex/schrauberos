import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { TOKEN_SHAPE } from "@/lib/api/token";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import type { AppSession } from "@/server/auth/session";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * API-Tokens: Erzeugen und Widerrufen als Operationen (Recht `api.manage`, erneute Passwortabfrage, Rechte-Hierarchie, Kennzeichnung gefährlicher Rechte, Adressbereiche, Audit ohne Klartext, Hash statt Token, Ablauf),
 * Aufräumen und die Regel, dass ein Token nie Tokens verwaltet.
 */
const PASSWORD = "Passwort-Test-1234";
let env: TestEnv;
let tokens: typeof import("./tokens");
let router: typeof import("./router");
let state: typeof import("./state");
let sessionOf: (userId: string) => Promise<AppSession>;

before(async () => {
  env = await createTestEnv();
  tokens = await import("./tokens");
  router = await import("./router");
  state = await import("./state");
  const { getSession } = await import("@/server/auth/session");
  sessionOf = async (userId) => {
    env.browser.reset();
    await env.signIn({ id: userId });
    return (await getSession())!;
  };
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  await env.db.apiToken.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.appSetting.deleteMany({ where: { key: "auth.behindProxy" } });
});

const adminSession = async () => sessionOf((await env.user({ username: `adm-${Math.random()}`, password: PASSWORD, roles: [await env.role({ isAdmin: true })] })).id);
/** Delegiertes Verwaltungsrecht (in der Praxis nur Administratoren, hier direkt in der Rolle): darf Tokens verwalten, aber nur eigene Rechte vergeben (kein Administrator). */
const delegateSession = async (permissions: string[]) => sessionOf((await env.user({ username: `del-${Math.random()}`, password: PASSWORD, roles: [await env.role({ permissions: ["api.manage", ...permissions] })] })).id);
const create = (session: AppSession, input: Record<string, unknown>) => tokens.createApiTokenOperation.execute(session, { name: "t", scope: ["customers.view"], password: PASSWORD, ...input });
const behindProxy = (on: boolean) => env.db.appSetting.upsert({ where: { key: "auth.behindProxy" }, update: { value: String(on) }, create: { key: "auth.behindProxy", value: String(on) } });

describe("Token erzeugen", () => {
  it("liefert das Klartext-Token genau einmal; gespeichert wird nur der Hash; das Audit-Log nennt nie das Token", async () => {
    const admin = await adminSession();
    const outcome = await create(admin, { name: "Importer", description: "Nachtlauf", scope: ["customers.view", "customers.edit"] });
    assert.ok(outcome.ok);
    const { token, id, hint, expiresAt } = outcome.data;
    assert.match(token, TOKEN_SHAPE);
    assert.equal(hint, `${token.slice(0, 8)}…`);

    const row = await env.db.apiToken.findUniqueOrThrow({ where: { id }, include: { scope: true } });
    assert.equal(row.userId, admin.user.id);
    assert.equal(row.name, "Importer");
    assert.equal(row.description, "Nachtlauf");
    assert.equal(row.allowedNets, null);
    assert.deepEqual(row.scope.map((s) => s.permission).sort(), ["customers.edit", "customers.view"]);
    assert.notEqual(row.tokenHash, token);
    assert.equal(row.rateLimitPerMinute, 120);
    // Standard-Ablauf: 90 Tage
    assert.ok(Math.abs(expiresAt!.getTime() - (Date.now() + 90 * 86_400_000)) < 60_000);

    const dump = JSON.stringify([await env.db.apiToken.findMany(), await env.db.auditLog.findMany(), await env.db.apiTokenScope.findMany(), await env.db.outboxEvent.findMany(), await env.db.appSetting.findMany()]);
    assert.ok(!dump.includes(token), "das Klartext-Token darf nirgends gespeichert sein");
    assert.ok(!dump.includes(token.slice(4)));
    assert.ok(!dump.includes(PASSWORD), "das Passwort darf nirgends stehen");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "apiToken.create" } });
    assert.equal(entry.target, `Importer (${hint})`);
    assert.equal(entry.entityId, id);

    // und es funktioniert gegen die API
    const response = await router.handleApiRequest(apiRequest("GET", "/customers", { token }));
    assert.equal(response.status, 200);
  });

  it("verlangt die erneute Passwortabfrage: ohne oder mit falschem Passwort entsteht nichts", async () => {
    const admin = await adminSession();
    const wrong = await create(admin, { password: "falsch" });
    assert.ok(!wrong.ok);
    assert.ok(!wrong.ok && wrong.failure.fields?.password);
    const missing = await tokens.createApiTokenOperation.execute(admin, { name: "t", scope: ["customers.view"] });
    assert.ok(!missing.ok);
    assert.equal(await env.db.apiToken.count(), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: "apiToken.create" } }), 0);
    assert.ok((await create(admin, {})).ok);
  });

  it("Rechte-Hierarchie: nur Rechte, die der Erzeuger selbst hat; nie Gesperrtes, Unbekanntes oder ein leerer Scope", async () => {
    const delegate = await delegateSession(["customers.view", "customers.edit"]);
    const make = (scope: string[]) => create(delegate, { scope });
    assert.ok((await make(["customers.view"])).ok);

    const tooMuch = await make(["customers.view", "customers.delete"]);
    assert.ok(!tooMuch.ok);
    assert.equal(!tooMuch.ok && tooMuch.failure.fields?.scope.key, "api.errors.scopeNotSubset");
    for (const scope of [["settings.manage"], ["employees.sensitive"], ["users.manage"], ["api.manage"], ["customers.view", "audit.view"], ["time.viewAll"]]) {
      const denied = await make(scope);
      assert.ok(!denied.ok, scope.join());
      assert.equal(!denied.ok && denied.failure.code, "invalid");
    }
    for (const scope of [[], ["gibt.es.nicht"]]) assert.ok(!(await make(scope)).ok, JSON.stringify(scope));

    // auch ein Administrator vergibt nie Gesperrtes (kein adminOnly-Recht, auch nicht api.manage selbst)
    const admin = await adminSession();
    for (const forbiddenScope of [["settings.manage"], ["api.manage"], ["backup.manage"], ["customers.export"]]) {
      const forbidden = await create(admin, { scope: forbiddenScope });
      assert.ok(!forbidden.ok, forbiddenScope.join());
      assert.equal(!forbidden.ok && forbidden.failure.fields?.scope.key, "api.errors.scopeForbidden");
    }
    assert.equal(await env.db.apiToken.count(), 1);
  });

  it("braucht api.manage; Ablauf ist Pflicht und höchstens 365 Tage; Name und Limit sind begrenzt", async () => {
    const plain = await sessionOf((await env.user({ username: `u-${Math.random()}`, password: PASSWORD, roles: [await env.role({ permissions: ["customers.view"] })] })).id);
    const denied = await create(plain, {});
    assert.ok(!denied.ok && denied.failure.code === "forbidden");
    // das alte Verwaltungsrecht der Einstellungen genügt nicht
    const settings = await sessionOf((await env.user({ username: `s-${Math.random()}`, password: PASSWORD, roles: [await env.role({ permissions: ["settings.manage", "customers.view"] })] })).id);
    const stillDenied = await create(settings, {});
    assert.ok(!stillDenied.ok && stillDenied.failure.code === "forbidden");

    const admin = await adminSession();
    const ok = await create(admin, { expiresInDays: 365, rateLimitPerMinute: 10 });
    assert.ok(ok.ok);
    for (const bad of [{ expiresInDays: 366 }, { expiresInDays: 0 }, { rateLimitPerMinute: 0 }, { rateLimitPerMinute: 100_000 }, { name: "" }, { name: "x".repeat(51) }, { description: "x".repeat(201) }]) {
      const outcome = await create(admin, bad);
      assert.ok(!outcome.ok, JSON.stringify(bad));
    }
  });

  it("gekennzeichnete Rechte (Versand, Festschreiben …) gehen nur mit ausdrücklicher Bestätigung in einen Scope", async () => {
    const admin = await adminSession();
    for (const permission of ["invoices.finalize", "billing.send"]) {
      const without = await create(admin, { scope: ["customers.view", permission] });
      assert.ok(!without.ok, permission);
      assert.equal(!without.ok && without.failure.fields?.acknowledgeMarked.key, "api.errors.markedNeedsAck");
      const wrongFlag = await create(admin, { scope: [permission], acknowledgeMarked: false });
      assert.ok(!wrongFlag.ok);
      const confirmed = await create(admin, { scope: [permission], acknowledgeMarked: true });
      assert.ok(confirmed.ok, permission);
    }
    // ohne gekennzeichnetes Recht ist keine Bestätigung nötig
    assert.ok((await create(admin, { scope: ["customers.view"] })).ok);
  });

  it("Adressbereiche: nur mit der Proxy-Einstellung, gültige Einträge, höchstens 20; sie werden normalisiert gespeichert", async () => {
    const admin = await adminSession();
    const noProxy = await create(admin, { allowedNets: "203.0.113.0/24" });
    assert.ok(!noProxy.ok);
    assert.equal(!noProxy.ok && noProxy.failure.fields?.allowedNets.key, "api.errors.netNeedsProxy");

    await behindProxy(true);
    const bad = await create(admin, { allowedNets: "203.0.113.0/24\nkeine-adresse" });
    assert.ok(!bad.ok);
    assert.equal(!bad.ok && bad.failure.fields?.allowedNets.key, "api.errors.netInvalid");
    for (const entry of ["10.0.0.0/0", "10.0.0.0/33", "::/129", "1.2.3", "1.2.3.4/x"]) assert.ok(!(await create(admin, { allowedNets: entry })).ok, entry);
    const tooMany = await create(admin, { allowedNets: Array.from({ length: 21 }, (_, i) => `10.0.${i}.0/24`).join("\n") });
    assert.ok(!tooMany.ok);
    assert.equal(!tooMany.ok && tooMany.failure.fields?.allowedNets.key, "api.errors.netTooMany");

    const ok = await create(admin, { allowedNets: "203.0.113.0/24, 2001:db8::/32  203.0.113.0/24" });
    assert.ok(ok.ok);
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id: ok.ok ? ok.data.id : "" } })).allowedNets, "203.0.113.0/24\n2001:db8::/32");
  });

  it("ein Token erzeugt und widerruft keine Tokens (Eskalationsversuch)", async () => {
    const admin = await adminSession();
    const outcome = await create(admin, { name: "Boot" });
    assert.ok(outcome.ok);
    // der Principal der API-Anfrage: aus dem Authentifizierer, ohne Verwaltungsrecht und ohne Administrator-Flag
    const auth = await (await import("@/server/operations")).getApiAuthenticator()(apiRequest("GET", "/customers", { token: outcome.data.token }));
    assert.ok(auth.ok);
    const principal = auth.ok ? auth.principal : admin;
    assert.equal(principal.user.isAdmin, false);
    assert.ok(!principal.can("api.manage"));
    const forged = await create(principal, { name: "Ableger" });
    assert.ok(!forged.ok && forged.failure.code === "forbidden");
    const revoke = await tokens.revokeApiTokenOperation.execute(principal, { id: outcome.data.id });
    assert.ok(!revoke.ok && revoke.failure.code === "forbidden");
    assert.equal(await env.db.apiToken.count(), 1);

    // selbst mit hineingeschmuggeltem Verwaltungsrecht im Principal bleibt die Sperre der Operation (kein Token verwaltet Tokens) – und es wird dabei kein Passwort gerechnet
    const smuggled: AppSession = { ...principal, can: () => true, permissions: new Set(ALL_PERMISSIONS) };
    const again = await create(smuggled, { name: "Ableger" });
    assert.ok(!again.ok && again.failure.code === "forbidden");
    const revokeAgain = await tokens.revokeApiTokenOperation.execute(smuggled, { id: outcome.data.id });
    assert.ok(!revokeAgain.ok && revokeAgain.failure.code === "forbidden");
    assert.equal(await env.db.apiToken.count(), 1);
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id: outcome.data.id } })).revokedAt, null);
  });
});

describe("Adressbereiche beim Abruf", () => {
  const call = (token: string, forwardedFor?: string) => router.handleApiRequest(apiRequest("GET", "/customers", { token, headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : undefined }));

  it("das Token gilt nur aus den Bereichen; der Rest sieht ein ganz normales 401", async () => {
    const admin = await adminSession();
    await behindProxy(true);
    const created = await create(admin, { allowedNets: "203.0.113.0/24\n2001:db8::/32" });
    assert.ok(created.ok);
    const { token } = created.data;
    assert.equal((await call(token, "203.0.113.77")).status, 200);
    assert.equal((await call(token, "2001:db8:1::5")).status, 200);
    // IPv4-gemappt gilt wie die IPv4-Adresse
    assert.equal((await call(token, "::ffff:203.0.113.9")).status, 200);
    // der Proxy hängt die Adresse des Clients zuletzt an: davor Gefälschtes zählt nicht
    assert.equal((await call(token, "198.51.100.1, 203.0.113.50")).status, 200);
    assert.equal((await call(token, "203.0.113.50, 198.51.100.1")).status, 401);
    const outside = await call(token, "198.51.100.7");
    assert.equal(outside.status, 401);
    assert.equal(outside.headers.get("www-authenticate"), 'Bearer realm="schrauberos"');
    // ohne Adresse und ohne Kopf: zu (fail-closed)
    assert.equal((await call(token)).status, 401);
    assert.equal((await call(token, "kein-ip")).status, 401);
  });

  it("ohne Proxy-Einstellung ist ein beschränktes Token zu – auch mit passendem (frei erfundenem) Kopf", async () => {
    const admin = await adminSession();
    await behindProxy(true);
    const created = await create(admin, { allowedNets: "203.0.113.0/24" });
    assert.ok(created.ok);
    await behindProxy(false);
    assert.equal((await call(created.data.token, "203.0.113.5")).status, 401);
    await behindProxy(true);
    assert.equal((await call(created.data.token, "203.0.113.5")).status, 200);
  });

  it("kaputter Eintrag in der Datenbank erweitert nie: das Token bleibt zu", async () => {
    const admin = await adminSession();
    const { token, id } = await makeToken(env, { ownerId: admin.user.id, scope: ["customers.view"] });
    await behindProxy(true);
    await env.db.apiToken.update({ where: { id }, data: { allowedNets: "unsinn" } });
    assert.equal((await call(token, "203.0.113.5")).status, 401);
    await env.db.apiToken.update({ where: { id }, data: { allowedNets: null } });
    assert.equal((await call(token, "203.0.113.5")).status, 200);
  });

  it("Aufrufe von außerhalb zählen im Fehlerpfad, gültige Aufrufe nie", async () => {
    const admin = await adminSession();
    await behindProxy(true);
    const created = await create(admin, { allowedNets: "203.0.113.0/24" });
    assert.ok(created.ok);
    state.apiLimits.failuresPerIp = 3;
    for (let i = 0; i < 3; i++) assert.equal((await call(created.data.token, "198.51.100.9")).status, 401);
    assert.equal((await call(created.data.token, "198.51.100.9")).status, 429);
    // ein anderer, berechtigter Aufrufer ist davon nicht betroffen
    assert.equal((await call(created.data.token, "203.0.113.20")).status, 200);
  });
});

describe("Token widerrufen und verwalten", () => {
  it("widerrufen: das Token ist sofort tot, Audit mit Kennung; doppeltes Widerrufen ist harmlos; braucht api.manage", async () => {
    const admin = await adminSession();
    const created = await create(admin, { name: "Weg" });
    assert.ok(created.ok);
    const { token, id } = created.data;
    assert.equal((await router.handleApiRequest(apiRequest("GET", "/customers", { token }))).status, 200);

    const plain = await sessionOf((await env.user({ username: `v-${Math.random()}`, password: PASSWORD, roles: [await env.role({ permissions: ["customers.view"] })] })).id);
    const denied = await tokens.revokeApiTokenOperation.execute(plain, { id });
    assert.ok(!denied.ok && denied.failure.code === "forbidden");
    assert.equal((await router.handleApiRequest(apiRequest("GET", "/customers", { token }))).status, 200);

    assert.ok((await tokens.revokeApiTokenOperation.execute(admin, { id })).ok);
    const first = (await env.db.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt;
    assert.ok(first);
    assert.equal((await router.handleApiRequest(apiRequest("GET", "/customers", { token }))).status, 401);
    assert.ok((await tokens.revokeApiTokenOperation.execute(admin, { id })).ok);
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt?.getTime(), first.getTime());
    assert.equal(await env.db.auditLog.count({ where: { action: "apiToken.revoke" } }), 2);
    const missing = await tokens.revokeApiTokenOperation.execute(admin, { id: "gibtsnicht" });
    assert.ok(!missing.ok && missing.failure.code === "notFound");
  });

  it("listApiTokens zeigt nie Hash oder Klartext, aber Besitzer, Beschreibung und Adressen; aufräumen entfernt lange Abgelaufene", async () => {
    const admin = await adminSession();
    await behindProxy(true);
    const created = await create(admin, { name: "Liste", description: "für die Buchhaltung", scope: ["customers.view", "invoices.view"], allowedNets: "10.0.0.0/8" });
    assert.ok(created.ok);
    const list = await tokens.listApiTokens();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].scope, ["customers.view", "invoices.view"]);
    assert.equal(list[0].description, "für die Buchhaltung");
    assert.equal(list[0].allowedNets, "10.0.0.0/8");
    assert.equal(list[0].ownerName, admin.user.name);
    assert.ok(!JSON.stringify(list).includes(created.data.token));
    assert.ok(!("tokenHash" in list[0]));

    await env.db.apiToken.create({ data: { name: "alt", tokenHash: "x".repeat(64), hint: "sos_…", userId: admin.user.id, expiresAt: new Date(Date.now() - 100 * 86_400_000) } });
    await env.db.apiToken.create({ data: { name: "gestern", tokenHash: "y".repeat(64), hint: "sos_…", userId: admin.user.id, expiresAt: new Date(Date.now() - 86_400_000) } });
    assert.equal(await tokens.pruneApiTokens(), 1);
    assert.equal(await env.db.apiToken.count(), 2);
  });

  it("der Scheduler räumt abgelaufene Idempotenz-Schlüssel jedes Mal und alte Tokens einmal am Tag auf", async () => {
    const { runApiCleanup } = await import("./cleanup");
    const admin = await adminSession();
    const old = await env.db.apiToken.create({ data: { name: "uralt", tokenHash: "z".repeat(64), hint: "sos_…", userId: admin.user.id, expiresAt: new Date(Date.now() - 200 * 86_400_000) } });
    await env.db.apiIdempotencyKey.createMany({
      data: [
        { tokenId: old.id, scope: "POST /customers", key: "alt", bodyHash: "h", expiresAt: new Date(Date.now() - 1000) },
        { tokenId: old.id, scope: "POST /customers", key: "frisch", bodyHash: "h", expiresAt: new Date(Date.now() + 30 * 86_400_000) },
      ],
    });
    const base = Date.now() + 10 * 86_400_000; // eigener Tag, damit der Tageswächter nicht von einem früheren Lauf blockiert
    assert.equal(await runApiCleanup(base), 1 + 1);
    assert.equal(await env.db.apiToken.count({ where: { id: old.id } }), 0);
    assert.equal(await env.db.apiIdempotencyKey.count(), 1);
    // gleicher Tag: nur die Schlüssel
    await env.db.apiToken.create({ data: { name: "uralt2", tokenHash: "y".repeat(64), hint: "sos_…", userId: admin.user.id, expiresAt: new Date(Date.now() - 200 * 86_400_000) } });
    assert.equal(await runApiCleanup(base + 1000), 0);
    assert.equal(await env.db.apiToken.count(), 1);
  });
});
