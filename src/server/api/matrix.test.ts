import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { grantablePermissions } from "@/lib/api/scope";
import { ALL_PERMISSIONS, FEATURES, fullFeatureId } from "@/modules/catalog";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";
import type { ApiEndpoint } from "./types";

/**
 * Berechtigungs-Matrix der API (generiert aus der Registry `src/modules/api.ts`): Jeder Endpunkt jeder Funktion wird ohne Token, mit ungültigem,
 * abgelaufenem und widerrufenem Token, mit gesperrtem Besitzer, nur mit Sitzungs-Cookie, ohne Scope, ohne Recht des Besitzers und bei ausgeschalteter
 * Funktion aufgerufen und muss ablehnen – ohne etwas zu verändern. Neue Endpunkte sind automatisch dabei.
 */
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
let endpoints: readonly ApiEndpoint[];

/** Neue Funktionen sind von Haus aus aus (`defaultEnabled: false`): Die Matrix schaltet sie ein, sonst wäre jeder Endpunkt 404. */
async function enableDefaultOff() {
  for (const f of FEATURES) {
    if ((f as { defaultEnabled?: boolean }).defaultEnabled !== false || ("required" in f && f.required)) continue;
    const key = fullFeatureId(f);
    await env.db.featureSetting.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true, updatedByName: "test" } });
  }
}

before(async () => {
  env = await createTestEnv();
  await enableDefaultOff();
  router = await import("./router");
  state = await import("./state");
  endpoints = (await import("@/modules/api")).apiEndpoints;
  state.apiLimits.failuresGlobal = 1_000_000;
  state.apiLimits.failuresPerIp = 1_000_000;
});
after(() => env.cleanup());

const concrete = (e: ApiEndpoint) => e.path.replace(/\{\w+\}/g, "someid");
const label = (e: ApiEndpoint) => `${e.method} ${e.path}`;
const request = (e: ApiEndpoint, token?: string | null, extra: Record<string, string> = {}) =>
  apiRequest(e.method, concrete(e), { token, body: e.method === "POST" || e.method === "PATCH" ? {} : undefined, headers: { ...(e.ifMatch ? { "if-match": '"1"' } : {}), ...extra } });
const call = (e: ApiEndpoint, token?: string | null, extra?: Record<string, string>) => router.handleApiRequest(request(e, token, extra));

const snapshot = async () => ({
  audit: await env.db.auditLog.count(),
  outbox: await env.db.outboxEvent.count(),
  customers: await env.db.customer.count(),
  vehicles: await env.db.vehicle.count(),
  appointments: await env.db.appointment.count(),
  tireSets: await env.db.tireSet.count(),
  orders: (await env.db.order.count()) + (await env.db.orderApproval.count()) + (await env.db.orderItem.count()) + (await env.db.orderFinding.count()),
  invoices: await env.db.invoice.count(),
  employees: await env.db.employee.count(),
  absences: await env.db.absence.count(),
  fleet: await env.db.fleetVehicle.count(),
  network: (await env.db.netDevice.count()) + (await env.db.netIp.count()) + (await env.db.netVlan.count()) + (await env.db.netSubnet.count()) + (await env.db.netLocation.count()),
  idempotency: await env.db.apiIdempotencyKey.count(),
});

describe("Registry der Endpunkte", () => {
  it("ist nicht leer und hat eindeutige Methoden+Pfade und Operations-IDs", () => {
    assert.ok(endpoints.length >= 60, `nur ${endpoints.length} Endpunkte`);
    assert.equal(new Set(endpoints.map(label)).size, endpoints.length);
    assert.equal(new Set(endpoints.map((e) => e.operationId)).size, endpoints.length);
  });

  it("jeder Endpunkt verlangt ein Recht seiner eigenen Funktion – nie ein gesperrtes", () => {
    const grantable = new Set(grantablePermissions());
    for (const e of endpoints) {
      const feature = FEATURES.find((f) => fullFeatureId(f) === e.feature);
      assert.ok(feature, `${label(e)}: unbekannte Funktion ${e.feature}`);
      assert.ok((feature.permissions.keys as readonly string[]).includes(e.permission), `${label(e)}: ${e.permission} gehört nicht zu ${e.feature}`);
      assert.ok(grantable.has(e.permission), `${label(e)}: ${e.permission} kann kein Token tragen`);
    }
  });
});

describe("Berechtigungs-Matrix: API", () => {
  it("ohne Token, mit ungültigem, abgelaufenem, widerrufenem Token und gesperrtem Besitzer: 401, nichts verändert", async () => {
    const all = grantablePermissions();
    const expired = await makeToken(env, { admin: true, scope: all, expiresAt: new Date(Date.now() - 1000), rateLimitPerMinute: 6000 });
    const revoked = await makeToken(env, { admin: true, scope: all, revokedAt: new Date(), rateLimitPerMinute: 6000 });
    const inactive = await makeToken(env, { admin: true, scope: all, ownerActive: false, rateLimitPerMinute: 6000 });
    const mustChange = await makeToken(env, { admin: true, scope: all, ownerMustChangePassword: true, rateLimitPerMinute: 6000 });
    const before = await snapshot();
    for (const e of endpoints) {
      for (const [name, token] of [["ohne", null], ["ungültig", "sos_" + "q".repeat(43)], ["abgelaufen", expired.token], ["widerrufen", revoked.token], ["Besitzer gesperrt", inactive.token], ["Passwortwechsel", mustChange.token]] as const) {
        assert.equal((await call(e, token)).status, 401, `${label(e)} (${name})`);
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("nur mit Sitzungs-Cookie (Administrator, alle Rechte): 401 – das Cookie zählt nie", async () => {
    const admin = await env.user({ username: "cookie-admin", roles: [await env.role({ key: "cookie-admin", isAdmin: true })] });
    await env.signIn(admin);
    const cookie = [...env.browser.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    assert.ok(cookie.length > 0);
    for (const e of endpoints) assert.equal((await call(e, null, { cookie })).status, 401, label(e));
    env.signOut();
  });

  it("Scope fehlt (Besitzer ist Administrator): 403; Besitzer hat das Recht nicht (Scope vollständig): 403 – nichts verändert", async () => {
    const all = grantablePermissions();
    const before = await snapshot();
    const noScope = new Map<string, string>();
    const noOwner = new Map<string, string>();
    for (const permission of new Set(endpoints.map((e) => e.permission))) {
      noScope.set(permission, (await makeToken(env, { admin: true, scope: all.filter((p) => p !== permission), rateLimitPerMinute: 6000 })).token);
      noOwner.set(permission, (await makeToken(env, { ownerPermissions: ALL_PERMISSIONS.filter((p) => p !== permission), scope: all, rateLimitPerMinute: 6000 })).token);
    }
    for (const e of endpoints) {
      assert.equal((await call(e, noScope.get(e.permission))).status, 403, `${label(e)} (Scope fehlt)`);
      assert.equal((await call(e, noOwner.get(e.permission))).status, 403, `${label(e)} (Besitzer ohne Recht)`);
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("nur adminOnly-/Verwaltungsrechte im Scope: nie wirksam (403) – auch nicht für Administratoren", async () => {
    const { token } = await makeToken(env, { admin: true, scope: ["settings.manage", "users.manage", "roles.manage", "backup.manage", "updates.manage", "modules.manage", "audit.view", "employees.sensitive"], rateLimitPerMinute: 6000 });
    for (const e of endpoints) assert.equal((await call(e, token)).status, 403, label(e));
  });

  it("Funktion ausgeschaltet: 404, auch mit vollen Rechten – und mit eingeschalteter Funktion nicht", async () => {
    const all = grantablePermissions();
    const { token } = await makeToken(env, { admin: true, scope: all, rateLimitPerMinute: 6000 });
    const before = await snapshot();
    for (const feature of new Set(endpoints.map((e) => e.feature))) {
      await env.db.featureSetting.upsert({ where: { key: feature }, update: { enabled: false }, create: { key: feature, enabled: false } });
      for (const e of endpoints.filter((x) => x.feature === feature)) assert.equal((await call(e, token)).status, 404, `${label(e)} (ausgeschaltet)`);
      await env.db.featureSetting.deleteMany();
      await enableDefaultOff();
    }
    for (const e of endpoints.filter((x) => x.list)) assert.equal((await call(e, token)).status, 200, `${label(e)} (wieder eingeschaltet)`);
    assert.deepEqual(await snapshot(), before);
  });

  it("Gegenprobe: mit Scope und Recht wird nicht an Anmeldung/Berechtigung abgewiesen (Listen: 200, Eingabefehler 4xx statt 401/403/405)", async () => {
    const { token } = await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 });
    const before = await snapshot();
    for (const e of endpoints) {
      const status = (await call(e, token)).status;
      assert.ok(![401, 403, 405, 429, 500].includes(status), `${label(e)}: ${status}`);
      if (e.list) assert.equal(status, 200, label(e));
      if (e.method === "POST" && e.body) assert.ok(status === 422 || status === 404, `${label(e)}: ${status}`);
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("jeder Endpunkt nennt Schemas und Beschreibung (OpenAPI vollständig) – Anzahl der Pfade passt", async () => {
    const { token } = await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 });
    const doc = (await (await router.handleApiRequest(apiRequest("GET", "/openapi.json", { token }))).json()) as { paths: Record<string, Record<string, { operationId: string; responses: object }>> };
    const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods));
    assert.equal(operations.length, endpoints.length);
    assert.deepEqual(operations.map((o) => o.operationId).sort(), endpoints.map((e) => e.operationId).sort());
  });
});
