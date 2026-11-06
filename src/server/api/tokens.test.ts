import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { TOKEN_SHAPE } from "@/lib/api/token";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import type { AppSession } from "@/server/auth/session";
import { apiRequest } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * API-Tokens: Erzeugen und Widerrufen als Operationen (Rechte-Hierarchie, Audit ohne Klartext, Hash statt Token, Ablauf), Aufräumen und die Regel, dass
 * ein Token nie Tokens verwaltet. Die Oberfläche folgt mit F11.
 */
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
});

const adminSession = async () => sessionOf((await env.user({ username: `adm-${Math.random()}`, roles: [await env.role({ isAdmin: true })] })).id);
/** Delegiertes Verwaltungsrecht: darf Tokens verwalten, aber nur eigene Rechte vergeben (kein Administrator). */
const delegateSession = async (permissions: string[]) => sessionOf((await env.user({ username: `del-${Math.random()}`, roles: [await env.role({ permissions: ["settings.manage", ...permissions] })] })).id);

describe("Token erzeugen", () => {
  it("liefert das Klartext-Token genau einmal; gespeichert wird nur der Hash; das Audit-Log nennt nie das Token", async () => {
    const admin = await adminSession();
    const outcome = await tokens.createApiTokenOperation.execute(admin, { name: "Importer", scope: ["customers.view", "customers.edit"] });
    assert.ok(outcome.ok);
    const { token, id, hint, expiresAt } = outcome.data;
    assert.match(token, TOKEN_SHAPE);
    assert.equal(hint, `${token.slice(0, 8)}…`);

    const row = await env.db.apiToken.findUniqueOrThrow({ where: { id }, include: { scope: true } });
    assert.equal(row.userId, admin.user.id);
    assert.equal(row.name, "Importer");
    assert.deepEqual(row.scope.map((s) => s.permission).sort(), ["customers.edit", "customers.view"]);
    assert.notEqual(row.tokenHash, token);
    assert.equal(row.rateLimitPerMinute, 120);
    // Standard-Ablauf: 90 Tage
    assert.ok(Math.abs(expiresAt.getTime() - (Date.now() + 90 * 86_400_000)) < 60_000);

    const dump = JSON.stringify([await env.db.apiToken.findMany(), await env.db.auditLog.findMany(), await env.db.apiTokenScope.findMany(), await env.db.outboxEvent.findMany()]);
    assert.ok(!dump.includes(token), "das Klartext-Token darf nirgends gespeichert sein");
    assert.ok(!dump.includes(token.slice(4)));
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "apiToken.create" } });
    assert.equal(entry.target, `Importer (${hint})`);
    assert.equal(entry.entityId, id);

    // und es funktioniert gegen die API
    const response = await router.handleApiRequest(apiRequest("GET", "/customers", { token }));
    assert.equal(response.status, 200);
  });

  it("Rechte-Hierarchie: nur Rechte, die der Erzeuger selbst hat; nie Gesperrtes, Unbekanntes oder ein leerer Scope", async () => {
    const delegate = await delegateSession(["customers.view", "customers.edit"]);
    const make = (scope: string[]) => tokens.createApiTokenOperation.execute(delegate, { name: "t", scope });
    assert.ok((await make(["customers.view"])).ok);

    const tooMuch = await make(["customers.view", "customers.delete"]);
    assert.ok(!tooMuch.ok);
    assert.equal(!tooMuch.ok && tooMuch.failure.fields?.scope.key, "api.errors.scopeNotSubset");
    for (const scope of [["settings.manage"], ["employees.sensitive"], ["users.manage"], ["customers.view", "audit.view"]]) {
      const denied = await make(scope);
      assert.ok(!denied.ok, scope.join());
      assert.equal(!denied.ok && denied.failure.code, "invalid");
    }
    for (const scope of [[], ["gibt.es.nicht"]]) assert.ok(!(await make(scope)).ok, JSON.stringify(scope));

    // auch ein Administrator vergibt nie Gesperrtes
    const admin = await adminSession();
    const forbidden = await tokens.createApiTokenOperation.execute(admin, { name: "t", scope: ["settings.manage"] });
    assert.ok(!forbidden.ok);
    assert.equal(!forbidden.ok && forbidden.failure.fields?.scope.key, "api.errors.scopeForbidden");
    assert.equal(await env.db.apiToken.count(), 1);
  });

  it("braucht das Verwaltungsrecht; Ablauf ist Pflicht und höchstens 365 Tage; Name und Limit sind begrenzt", async () => {
    const plain = await sessionOf((await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions: ["customers.view"] })] })).id);
    const denied = await tokens.createApiTokenOperation.execute(plain, { name: "t", scope: ["customers.view"] });
    assert.ok(!denied.ok && denied.failure.code === "forbidden");

    const admin = await adminSession();
    const ok = await tokens.createApiTokenOperation.execute(admin, { name: "t", scope: ["customers.view"], expiresInDays: 365, rateLimitPerMinute: 10 });
    assert.ok(ok.ok);
    for (const bad of [{ expiresInDays: 366 }, { expiresInDays: 0 }, { rateLimitPerMinute: 0 }, { rateLimitPerMinute: 100_000 }, { name: "" }, { name: "x".repeat(51) }]) {
      const outcome = await tokens.createApiTokenOperation.execute(admin, { name: "t", scope: ["customers.view"], ...bad });
      assert.ok(!outcome.ok, JSON.stringify(bad));
    }
  });

  it("ein Token erzeugt und widerruft keine Tokens (Eskalationsversuch)", async () => {
    const admin = await adminSession();
    const outcome = await tokens.createApiTokenOperation.execute(admin, { name: "Boot", scope: ["customers.view"] });
    assert.ok(outcome.ok);
    // der Principal der API-Anfrage: aus dem Authentifizierer, ohne Verwaltungsrecht und ohne Administrator-Flag
    const auth = await (await import("@/server/operations")).getApiAuthenticator()(apiRequest("GET", "/customers", { token: outcome.data.token }));
    assert.ok(auth.ok);
    const principal = auth.ok ? auth.principal : admin;
    assert.equal(principal.user.isAdmin, false);
    assert.ok(!principal.can("settings.manage"));
    const create = await tokens.createApiTokenOperation.execute(principal, { name: "Ableger", scope: ["customers.view"] });
    assert.ok(!create.ok && create.failure.code === "forbidden");
    const revoke = await tokens.revokeApiTokenOperation.execute(principal, { id: outcome.data.id });
    assert.ok(!revoke.ok && revoke.failure.code === "forbidden");
    assert.equal(await env.db.apiToken.count(), 1);

    // selbst mit hineingeschmuggeltem Verwaltungsrecht im Principal bleibt die Sperre der Operation (kein Token verwaltet Tokens)
    const smuggled: AppSession = { ...principal, can: () => true, permissions: new Set(ALL_PERMISSIONS) };
    const again = await tokens.createApiTokenOperation.execute(smuggled, { name: "Ableger", scope: ["customers.view"] });
    assert.ok(!again.ok && again.failure.code === "forbidden");
  });
});

describe("Token widerrufen und verwalten", () => {
  it("widerrufen: das Token ist sofort tot, Audit mit Kennung; doppeltes Widerrufen ist harmlos", async () => {
    const admin = await adminSession();
    const created = await tokens.createApiTokenOperation.execute(admin, { name: "Weg", scope: ["customers.view"] });
    assert.ok(created.ok);
    const { token, id } = created.data;
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

  it("listApiTokens zeigt nie Hash oder Klartext; aufräumen entfernt lange Abgelaufene", async () => {
    const admin = await adminSession();
    const created = await tokens.createApiTokenOperation.execute(admin, { name: "Liste", scope: ["customers.view", "invoices.view"] });
    assert.ok(created.ok);
    const list = await tokens.listApiTokens();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].scope, ["customers.view", "invoices.view"]);
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
