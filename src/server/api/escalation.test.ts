import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { grantablePermissions, isApiForbidden } from "@/lib/api/scope";
import { ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, MARKED_PERMISSIONS } from "@/modules/catalog";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Eskalationsversuche gegen die Programmierschnittstelle: Ein Token erreicht nie Verwaltung (Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit, Tokens, Webhooks), trägt nie ein gesperrtes Recht –
 * auch nicht, wenn ein Administrator Besitzer ist oder die Zeile in der Datenbank steht –, wirksam ist nur der Schnitt aus Scope und aktuellen Rechten des Besitzers (Verlust wirkt sofort), und ein
 * deaktivierter, gelöschter oder zum Passwortwechsel gezwungener Besitzer macht das Token ungültig.
 */
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
});
after(() => env.cleanup());
beforeEach(() => state.resetApiLimiters());

const call = (token: string, method: string, path: string, body?: unknown) => router.handleApiRequest(apiRequest(method, path, { token, body }));

describe("Verwaltung ist über ein Token nicht erreichbar", () => {
  it("Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit, Tokens und Webhooks gibt es in der Schnittstelle nicht (404 mit gültigem Token, nie 2xx) – auch nicht für einen Administrator als Besitzer", async () => {
    const { token } = await makeToken(env, { admin: true, scope: ["customers.view", "customers.edit"] });
    const before = await env.db.apiToken.count();
    for (const path of ["/users", "/users/x", "/roles", "/settings", "/modules", "/backups", "/updates", "/audit", "/audit-log", "/api-tokens", "/api-tokens/x", "/tokens", "/webhooks", "/webhooks/x", "/webhook-deliveries", "/system", "/mail"]) {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        const response = await call(token, method, path, method === "POST" || method === "PATCH" ? { name: "x", scope: ["customers.view"] } : undefined);
        assert.equal(response.status, 404, `${method} ${path}`);
      }
    }
    assert.equal(await env.db.apiToken.count(), before, "kein Token ist entstanden");
    assert.equal(await env.db.webhook.count(), 0);
    assert.equal(await env.db.user.count({ where: { username: "x" } }), 0);
  });

  it("die Beschreibung der Schnittstelle nennt keine Verwaltungspfade", async () => {
    const { token } = await makeToken(env, { admin: true, scope: ["customers.view"] });
    const doc = (await (await call(token, "GET", "/openapi.json")).json()) as { paths: Record<string, unknown> };
    for (const path of Object.keys(doc.paths)) assert.ok(!/^\/(users|roles|settings|modules|backups|updates|audit|api-tokens|tokens|webhooks|system|mail)\b/.test(path), path);
  });
});

describe("Gesperrte Rechte trägt kein Token", () => {
  it("jedes gesperrte Recht fällt weg – auch wenn es im Scope eines Tokens eines Administrators steht (Zeile direkt in der Datenbank)", async () => {
    const forbidden = ALL_PERMISSIONS.filter((p) => isApiForbidden(p));
    assert.ok(forbidden.length > 15);
    const { token } = await makeToken(env, { admin: true, scope: [...ALL_PERMISSIONS] });
    const auth = await (await import("@/server/operations")).getApiAuthenticator()(apiRequest("GET", "/customers", { token }));
    assert.ok(auth.ok);
    if (!auth.ok) return;
    const stuck = ALL_PERMISSIONS.filter((p) => isApiForbidden(p) && auth.principal.can(p));
    assert.deepEqual(stuck, [], "gesperrte Rechte im wirksamen Satz");
    assert.equal(auth.principal.user.isAdmin, false);
    assert.deepEqual(auth.principal.user.roleIds, []);
    // und konkret die, auf die es ankommt
    for (const p of ["settings.manage", "users.manage", "roles.manage", "backup.manage", "backup.keys", "updates.manage", "audit.view", "modules.manage", "api.manage", "mail.manage", "mail.send", "employees.sensitive", "time.viewAll", "time.correctAll", "customers.export", "customers.import"]) {
      assert.ok(!auth.principal.can(p as never), p);
    }
    // ein gewöhnliches Recht des Scopes bleibt
    assert.ok(auth.principal.can("customers.view"));
  });

  it("Invarianten: jedes adminOnly-Recht, jedes Recht der Verwaltung und der gesperrten Liste ist gesperrt; die vergebbaren sind genau der Rest – die gekennzeichneten darunter sind bekannt (Änderung fällt im Review auf)", () => {
    for (const p of ADMIN_ONLY_PERMISSIONS) assert.ok(isApiForbidden(p), p);
    const grantable = new Set(grantablePermissions());
    for (const p of ALL_PERMISSIONS) assert.equal(grantable.has(p), !isApiForbidden(p), p);
    for (const p of grantable) assert.ok(!MARKED_PERMISSIONS.has(p) || ["sensitive", "send", "reveal", "api"].includes(MARKED_PERMISSIONS.get(p)!), `${p}: Export/Import nie`);
    const markedGrantable = [...grantable].filter((p) => MARKED_PERMISSIONS.has(p)).sort();
    assert.deepEqual(markedGrantable, ["billing.send", "invoices.finalize"], "gekennzeichnete, vergebbare Rechte (nur mit ausdrücklicher Bestätigung); Wiederöffnen und Datenschutzvorgänge trägt nie ein Token");
  });
});

describe("Wirksame Rechte: Schnitt aus Scope und aktuellen Rechten des Besitzers", () => {
  it("ein größerer Scope als die Rechte des Besitzers gilt nur im Schnitt; verliert der Besitzer ein Recht, wirkt das bei der nächsten Anfrage", async () => {
    const role = await env.role({ permissions: ["customers.view", "customers.edit"] });
    const owner = await env.user({ username: `owner-${Math.random()}`, roles: [role] });
    const { token } = await makeToken(env, { ownerId: owner.id, scope: ["customers.view", "customers.delete", "vehicles.view", "customers.edit"] });
    assert.equal((await call(token, "GET", "/customers")).status, 200);
    assert.equal((await call(token, "GET", "/vehicles")).status, 403, "im Scope, aber nicht beim Besitzer");
    const created = await call(token, "POST", "/customers", { name: "Eskalation GmbH", type: "company" });
    assert.ok([201, 422].includes(created.status), `Anlegen (Recht customers.edit): ${created.status}`);
    assert.equal((await call(token, "DELETE", "/customers/gibtsnicht")).status, 403, "customers.delete hat der Besitzer nicht");

    await env.db.rolePermission.deleteMany({ where: { roleId: role.id, permission: "customers.view" } });
    assert.equal((await call(token, "GET", "/customers")).status, 403, "Rechteverlust wirkt sofort");
    await env.db.rolePermission.create({ data: { roleId: role.id, permission: "customers.view" } });
    assert.equal((await call(token, "GET", "/customers")).status, 200);
  });

  it("deaktivierter Besitzer, Passwortwechsel-Pflicht und gelöschtes Konto: das Token ist sofort ungültig (401, nie 403)", async () => {
    const role = await env.role({ permissions: ["customers.view"] });
    const owner = await env.user({ username: `owner-${Math.random()}`, roles: [role] });
    const { token } = await makeToken(env, { ownerId: owner.id, scope: ["customers.view"] });
    assert.equal((await call(token, "GET", "/customers")).status, 200);
    await env.db.user.update({ where: { id: owner.id }, data: { active: false } });
    assert.equal((await call(token, "GET", "/customers")).status, 401);
    await env.db.user.update({ where: { id: owner.id }, data: { active: true, mustChangePassword: true } });
    assert.equal((await call(token, "GET", "/customers")).status, 401);
    await env.db.user.update({ where: { id: owner.id }, data: { mustChangePassword: false } });
    assert.equal((await call(token, "GET", "/customers")).status, 200);
    await env.db.user.delete({ where: { id: owner.id } });
    assert.equal((await call(token, "GET", "/customers")).status, 401);
  });
});

describe("Cookie und Token bleiben getrennt", () => {
  it("ein Sitzungs-Cookie allein öffnet die Schnittstelle nie (401), auch nicht für einen Administrator", async () => {
    const role = await env.role({ isAdmin: true });
    const admin = await env.user({ username: `cookie-${Math.random()}`, roles: [role] });
    env.browser.reset();
    await env.signIn(admin);
    const cookie = [...env.browser.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await router.handleApiRequest(new Request("http://localhost/api/v1/customers", { headers: { cookie } }));
    assert.equal(response.status, 401);
    const doc = await router.handleApiRequest(new Request("http://localhost/api/v1/openapi.json", { headers: { cookie } }));
    assert.equal(doc.status, 401);
  });
});
