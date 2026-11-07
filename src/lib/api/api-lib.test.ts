import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_PERMISSIONS, FEATURES } from "@/modules/catalog";
import { WindowLimiter } from "./limit";
import { PROBLEMS, problemOf } from "./problem";
import { DEFAULT_LIMIT, etagOf, ifNoneMatchHit, isParamError, MAX_LIMIT, parseIfMatch, parsePaging, parseSort } from "./query";
import { API_NEVER, checkTokenScope, effectivePermissions, grantablePermissions, isApiForbidden, isPlatformFeature } from "./scope";
import { bearerToken, generateApiToken, hashApiToken, TOKEN_SHAPE, tokenHint } from "./token";

describe("Token", () => {
  it("hat Präfix, feste Länge, ist zufällig und lässt sich nur über den Hash wiederfinden", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    assert.match(a, TOKEN_SHAPE);
    assert.notEqual(a, b);
    assert.match(hashApiToken(a), /^[0-9a-f]{64}$/);
    assert.notEqual(hashApiToken(a), hashApiToken(b));
    assert.ok(!hashApiToken(a).includes(a.slice(4)));
    assert.equal(tokenHint(a), `${a.slice(0, 8)}…`);
  });

  it("bearerToken nimmt nur „Bearer <token>“ in der erwarteten Form", () => {
    const t = generateApiToken();
    assert.equal(bearerToken(`Bearer ${t}`), t);
    assert.equal(bearerToken(`bearer ${t}`), t);
    for (const bad of [null, undefined, "", t, `Basic ${t}`, `Bearer ${t} extra`, `Bearer  ${t}`, `Bearer ${t}x`, `Bearer ${t.slice(0, -1)}`, `Bearer sos_${"ä".repeat(43)}`, "Bearer " + "a".repeat(500)]) {
      assert.equal(bearerToken(bad as string | null), null, String(bad));
    }
  });
});

describe("Scope und wirksame Rechte", () => {
  it("gesperrt sind adminOnly-Rechte, alle Rechte der Verwaltung und sensible Mitarbeiterdaten", () => {
    for (const p of ["settings.manage", "users.manage", "roles.manage", "backup.manage", "updates.manage", "modules.manage", "audit.view", "employees.sensitive"]) assert.ok(isApiForbidden(p), p);
    for (const p of ["customers.view", "customers.delete", "invoices.edit", "network.edit", "appointments.configure"]) assert.ok(!isApiForbidden(p), p);
    assert.ok(API_NEVER.has("employees.sensitive"));
    for (const p of ["time.viewAll", "time.correctAll"]) assert.ok(isApiForbidden(p) && API_NEVER.has(p) && !grantablePermissions().includes(p), p);
    assert.ok(!isApiForbidden("time.view") && !isApiForbidden("time.correct"));
    assert.ok(isPlatformFeature("admin.users") && !isPlatformFeature("workshop.customers"));
  });

  it("grantablePermissions: jedes Recht des Katalogs, das nicht gesperrt ist – und keine Verwaltungsfunktion", () => {
    const grantable = new Set(grantablePermissions());
    for (const f of FEATURES) {
      for (const p of f.permissions.keys) assert.equal(grantable.has(p), !isApiForbidden(p), p);
      if (f.module === "admin") for (const p of f.permissions.keys) assert.ok(!grantable.has(p), `${p} (Verwaltung)`);
    }
    assert.ok(grantable.size > 15 && grantable.size < ALL_PERMISSIONS.length);
  });

  it("checkTokenScope: leer, unbekannt, gesperrt und nicht Teilmenge werden abgelehnt (Rechte-Hierarchie)", () => {
    const actor = { rights: new Set(["customers.view", "customers.edit", "settings.manage"]) };
    assert.equal(checkTokenScope(actor, ["customers.view"]), null);
    assert.equal(checkTokenScope(actor, ["customers.view", "customers.edit"]), null);
    assert.equal(checkTokenScope(actor, []), "empty");
    assert.equal(checkTokenScope(actor, ["gibt.es.nicht"]), "unknown");
    assert.equal(checkTokenScope(actor, ["settings.manage"]), "forbidden");
    assert.equal(checkTokenScope(actor, ["customers.view", "customers.delete"]), "notSubset");
    // ein Administrator (alle Rohrechte) vergibt trotzdem nie Gesperrtes
    const admin = { rights: new Set(ALL_PERMISSIONS as string[]) };
    assert.equal(checkTokenScope(admin, ["employees.sensitive"]), "forbidden");
    assert.equal(checkTokenScope(admin, ["users.manage"]), "forbidden");
    assert.equal(checkTokenScope(admin, ["invoices.delete"]), null);
  });

  it("effectivePermissions: Scope ∩ Rechte des Besitzers, ohne Gesperrtes und Unbekanntes", () => {
    const owner = new Set(["customers.view", "customers.edit", "settings.manage", "invoices.view"]);
    assert.deepEqual([...effectivePermissions(["customers.view", "customers.delete", "settings.manage", "nonsense"], owner)], ["customers.view"]);
    assert.deepEqual([...effectivePermissions([], owner)], []);
    assert.deepEqual([...effectivePermissions(["customers.view"], new Set())], []);
  });
});

describe("Fenster-Zähler", () => {
  it("lässt `limit` Treffer je Fenster zu, meldet Rest und Wartezeit, beginnt danach neu", () => {
    let now = 1_000_000;
    const limiter = new WindowLimiter({ windowMs: 60_000, maxKeys: 10, now: () => now });
    const results = Array.from({ length: 4 }, () => limiter.hit("a", 3));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
    assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0]);
    assert.equal(results[3].resetSeconds, 60);
    now += 30_000;
    assert.equal(limiter.hit("a", 3).resetSeconds, 30);
    assert.equal(limiter.hit("b", 3).allowed, true);
    now += 31_000;
    assert.equal(limiter.hit("a", 3).allowed, true);
    assert.equal(limiter.exceeded("a", 1).allowed, false);
  });

  it("der Speicher ist begrenzt: abgelaufene Fenster fallen zuerst, dann die ältesten", () => {
    let now = 0;
    const limiter = new WindowLimiter({ windowMs: 1000, maxKeys: 5, now: () => now });
    for (let i = 0; i < 20; i++) {
      limiter.hit(`k${i}`, 1);
      now += 1;
    }
    assert.ok(limiter.size <= 5);
    now += 5000;
    limiter.hit("neu", 1);
    assert.equal(limiter.size, 1);
  });
});

describe("Abfrageparameter", () => {
  const params = (q: string) => new URLSearchParams(q);

  it("Seiten: Standard, Obergrenze, nur ganze positive Zahlen", () => {
    assert.deepEqual(parsePaging(params("")), { page: 1, limit: DEFAULT_LIMIT });
    assert.deepEqual(parsePaging(params("page=3&limit=200")), { page: 3, limit: MAX_LIMIT });
    for (const bad of ["limit=201", "limit=0", "page=0", "page=-1", "page=1.5", "limit=abc", "limit=", "page=99999999999"]) assert.ok(isParamError(parsePaging(params(bad))), bad);
  });

  it("Sortierung: nur Whitelist, Richtung mit „-“, höchstens drei, keine Doppelten", () => {
    const fallback = [{ key: "name", dir: "asc" as const }];
    assert.deepEqual(parseSort(null, ["name", "city"], fallback), fallback);
    assert.deepEqual(parseSort("-city,name", ["name", "city"], fallback), [{ key: "city", dir: "desc" }, { key: "name", dir: "asc" }]);
    for (const bad of ["passwordHash", "name,name", "name,city,name,city", "-", "name;drop"]) assert.ok(isParamError(parseSort(bad, ["name", "city"], fallback)), bad);
  });

  it("ETag und If-Match", () => {
    assert.equal(etagOf("123"), '"123"');
    assert.deepEqual(parseIfMatch('"123"'), { kind: "version", version: "123" });
    assert.deepEqual(parseIfMatch('W/"123"'), { kind: "version", version: "123" });
    assert.deepEqual(parseIfMatch(null), { kind: "none" });
    for (const bad of ["*", "123", '"abc"', '"1", "2"', '""']) assert.deepEqual(parseIfMatch(bad), { kind: "invalid" }, bad);
    // If-None-Match (Lesen): exakt, schwach, Liste, Stern – und alles andere ist kein Treffer
    assert.equal(ifNoneMatchHit('"123"', '"123"'), true);
    assert.equal(ifNoneMatchHit('W/"123"', '"123"'), true);
    assert.equal(ifNoneMatchHit('"1", "123", "9"', '"123"'), true);
    assert.equal(ifNoneMatchHit('"1",W/"123"', '"123"'), true);
    assert.equal(ifNoneMatchHit("*", '"123"'), true);
    for (const miss of [null, "", '"124"', '"1", "2"', "123", "W/", "x"]) assert.equal(ifNoneMatchHit(miss, '"123"'), false, String(miss));
  });
});

describe("Fehlerformat", () => {
  it("jedes Problem hat Typ, Titel, Status, Code und Detail – und nie Interna", () => {
    for (const code of Object.keys(PROBLEMS) as Array<keyof typeof PROBLEMS>) {
      const p = problemOf(code);
      assert.equal(p.type, `urn:schrauberos:problem:${code}`);
      assert.equal(p.status, PROBLEMS[code].status);
      assert.ok(p.title && p.detail);
      assert.deepEqual(Object.keys(p).sort(), ["code", "detail", "status", "title", "type"]);
    }
    assert.deepEqual(Object.keys(problemOf("validation_failed", { fields: { a: { code: "validation.required" } } })).sort(), ["code", "detail", "fields", "status", "title", "type"]);
  });
});
