import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";
import { customerSearchKeys } from "@/modules/workshop/customers/domain";

/**
 * API-Kern: Authentifizierung (Bearer, nie Cookie), Drosselung nur im Fehlerpfad, Rate-Limit je Token, Idempotenz, Fehlerformat, Seiten, ETag.
 * Die Ressource „Kunden“ dient als Beispiel; die Matrix über alle Endpunkte steht in `matrix.test.ts`.
 */
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
let idem: typeof import("./idempotency");

const CUSTOMER_SCOPE = ["customers.view", "customers.edit", "customers.delete"];

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
  idem = await import("./idempotency");
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  state.apiRuntime.now = () => Date.now();
  await env.db.apiIdempotencyKey.deleteMany();
  await env.db.apiToken.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.featureSetting.deleteMany();
  await env.db.appSetting.deleteMany();
  env.browser.reset();
});

const call = (request: Request) => router.handleApiRequest(request);
const json = async (response: Response) => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = (extra: Record<string, unknown> = {}) => ({ ownerPermissions: CUSTOMER_SCOPE, scope: CUSTOMER_SCOPE, ...extra });

describe("Authentifizierung", () => {
  it("ohne Token, mit Fremdem oder Falschgeformtem: 401 im Problem-Format – auch auf unbekannten Pfaden", async () => {
    for (const init of [{}, { token: "sos_" + "x".repeat(43) }, { headers: { authorization: "Basic abc" } }, { headers: { authorization: "Bearer kurz" } }]) {
      for (const path of ["/customers", "/gibt-es-nicht", "/openapi.json"]) {
        const response = await call(apiRequest("GET", path, init));
        assert.equal(response.status, 401, path);
        assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
        assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="schrauberos"');
        const body = await json(response);
        assert.equal(body.code, "unauthenticated");
        assert.deepEqual(Object.keys(body).sort(), ["code", "detail", "status", "title", "type"]);
      }
    }
  });

  it("ein gültiges Token genügt – das Sitzungs-Cookie wird nie gelesen", async () => {
    const { token } = await makeToken(env, owner());
    assert.equal((await call(apiRequest("GET", "/customers", { token }))).status, 200);

    // Cookie-Sitzung mit allen Rechten, aber ohne Token: 401
    const admin = await env.user({ username: "chef", roles: [await env.role({ key: "adm", isAdmin: true })] });
    await env.signIn(admin);
    assert.ok(env.browser.cookies.size > 0);
    assert.equal((await call(apiRequest("GET", "/customers"))).status, 401);
    assert.equal((await call(apiRequest("GET", "/customers", { headers: { cookie: [...env.browser.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } }))).status, 401);
  });

  it("abgelaufen, widerrufen, Besitzer gesperrt oder mit ausstehendem Passwortwechsel: 401, von außen nicht unterscheidbar", async () => {
    const bodies: string[] = [];
    for (const extra of [{ expiresAt: new Date(Date.now() - 1000) }, { revokedAt: new Date() }, { ownerActive: false }, { ownerMustChangePassword: true }]) {
      const { token } = await makeToken(env, owner(extra));
      const response = await call(apiRequest("GET", "/customers", { token }));
      assert.equal(response.status, 401, JSON.stringify(extra));
      bodies.push(JSON.stringify(await response.json()));
    }
    assert.equal(new Set(bodies).size, 1);
  });

  it("Pflicht-2FA für Administratoren (ZP5-5): das Token eines Administrators ohne zweiten Faktor wird abgelehnt, mit zweitem Faktor und für andere Konten gilt es", async () => {
    const admin = await makeToken(env, owner({ admin: true }));
    const plain = await makeToken(env, owner());
    assert.equal((await call(apiRequest("GET", "/customers", { token: admin.token }))).status, 200, "Pflicht aus: gilt");
    await env.db.appSetting.create({ data: { key: "auth.require2faAdmins", value: "true" } });
    try {
      assert.equal((await call(apiRequest("GET", "/customers", { token: admin.token }))).status, 401, "Pflicht an, kein zweiter Faktor: abgelehnt");
      assert.equal((await call(apiRequest("GET", "/customers", { token: plain.token }))).status, 200, "Nicht-Administratoren sind nicht betroffen");
      assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id: admin.id } })).revokedAt, null, "das Token wird nicht widerrufen");
      await env.db.twoFactor.create({ data: { userId: admin.userId, secret: "v1:x:y:z", enabledAt: new Date() } });
      assert.equal((await call(apiRequest("GET", "/customers", { token: admin.token }))).status, 200, "zweiter Faktor eingerichtet: gilt wieder");
    } finally {
      await env.db.appSetting.deleteMany({ where: { key: "auth.require2faAdmins" } });
      await env.db.twoFactor.deleteMany({ where: { userId: admin.userId } });
    }
  });

  it("Besitzer gelöscht: das Token ist weg", async () => {
    const { token, userId } = await makeToken(env, owner());
    assert.equal((await call(apiRequest("GET", "/customers", { token }))).status, 200);
    await env.db.user.delete({ where: { id: userId } });
    assert.equal(await env.db.apiToken.count(), 0);
    assert.equal((await call(apiRequest("GET", "/customers", { token }))).status, 401);
  });

  it("Bearer-Tokens gelten für Server Actions nicht: ohne Cookie bleibt es bei /login", async () => {
    const { token } = await makeToken(env, { admin: true, scope: CUSTOMER_SCOPE });
    env.browser.setHeaders({ authorization: `Bearer ${token}` });
    const actions = await import("@/modules/workshop/customers/actions");
    assert.equal(await redirectOf(() => actions.saveCustomer({}, form({ lastName: "Eingeschmuggelt" }))), "/login");
    assert.equal(await env.db.customer.count(), 0);
    // auch die Sitzung selbst (Seiten, requirePermission) kennt das Token nicht
    const { getSession } = await import("@/server/auth/session");
    assert.equal(await getSession(), null);
    env.browser.setHeaders({});
  });

  it("zuletzt benutzt wird gedrosselt geschrieben und ändert nichts sonst", async () => {
    const { token, id } = await makeToken(env, owner());
    await call(apiRequest("GET", "/customers", { token }));
    const first = (await env.db.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt;
    assert.ok(first);
    await call(apiRequest("GET", "/customers", { token }));
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt?.getTime(), first.getTime());
    // nach über 10 Minuten wird neu geschrieben
    state.apiRuntime.now = () => Date.now() + 11 * 60_000;
    await call(apiRequest("GET", "/customers", { token }));
    assert.ok((await env.db.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt!.getTime() > first.getTime());
  });
});

describe("Wirksame Rechte = Scope ∩ Rechte des Besitzers", () => {
  it("Scope fehlt: 403; Besitzer verliert das Recht: 403; nie adminOnly", async () => {
    const readOnly = await makeToken(env, { ownerPermissions: CUSTOMER_SCOPE, scope: ["customers.view"] });
    assert.equal((await call(apiRequest("GET", "/customers", { token: readOnly.token }))).status, 200);
    assert.equal((await call(apiRequest("POST", "/customers", { token: readOnly.token, body: { lastName: "X" } }))).status, 403);
    assert.equal((await call(apiRequest("DELETE", "/customers/abc", { token: readOnly.token }))).status, 403);

    const shrinking = await makeToken(env, owner());
    assert.equal((await call(apiRequest("POST", "/customers", { token: shrinking.token, body: { lastName: "Vorher" } }))).status, 201);
    const role = await env.db.userRole.findFirstOrThrow({ where: { userId: shrinking.userId } });
    await env.db.rolePermission.deleteMany({ where: { roleId: role.roleId, permission: "customers.edit" } });
    assert.equal((await call(apiRequest("POST", "/customers", { token: shrinking.token, body: { lastName: "Nachher" } }))).status, 403);
    assert.equal(await env.db.customer.count(), 1);

    // adminOnly-Rechte im Scope bleiben unwirksam, auch beim Administrator
    const admin = await makeToken(env, { admin: true, scope: ["settings.manage", "users.manage", "customers.view"] });
    assert.equal((await call(apiRequest("GET", "/customers", { token: admin.token }))).status, 200);
  });

  it("ausgeschaltete Funktion: 404, auch mit allen Rechten", async () => {
    const { token } = await makeToken(env, owner());
    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    for (const [method, path] of [["GET", "/customers"], ["POST", "/customers"], ["GET", "/customers/abc"]] as const) {
      assert.equal((await call(apiRequest(method, path, { token, body: method === "POST" ? { lastName: "X" } : undefined }))).status, 404, `${method} ${path}`);
    }
  });
});

describe("Drosselung", () => {
  it("nur der Fehlerpfad ungültiger Tokens wird gedrosselt – gültige Tokens nie", async () => {
    state.apiLimits.failuresGlobal = 5;
    const { token } = await makeToken(env, owner());
    const bad = "sos_" + "y".repeat(43);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await call(apiRequest("GET", "/customers", { token: bad }))).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429]);
    const limited = await call(apiRequest("GET", "/customers", { token: bad }));
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    // mitten in der Flut: das gültige Token wird bedient
    for (let i = 0; i < 5; i++) assert.equal((await call(apiRequest("GET", "/customers", { token }))).status, 200);
  });

  it("je Adresse nur mit der Proxy-Einstellung", async () => {
    state.apiLimits.failuresPerIp = 2;
    const request = (ip: string) => call(apiRequest("GET", "/customers", { token: "sos_" + "z".repeat(43), headers: { "x-forwarded-for": ip } }));
    // ohne Einstellung wird der Header ignoriert (fälschbar): kein Adress-Limit
    for (let i = 0; i < 4; i++) assert.equal((await request("10.0.0.1")).status, 401);
    state.resetApiLimiters();
    state.apiLimits.failuresPerIp = 2;
    await env.db.appSetting.create({ data: { key: "auth.behindProxy", value: "true" } });
    assert.deepEqual([(await request("10.0.0.1")).status, (await request("10.0.0.1")).status, (await request("10.0.0.1")).status], [401, 401, 429]);
    assert.equal((await request("10.0.0.2")).status, 401);
  });

  it("Rate-Limit je Token: 429 mit Retry-After und RateLimit-Headern, andere Tokens unberührt", async () => {
    const a = await makeToken(env, owner({ rateLimitPerMinute: 3 }));
    const b = await makeToken(env, owner());
    const responses = [];
    for (let i = 0; i < 4; i++) responses.push(await call(apiRequest("GET", "/customers", { token: a.token })));
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 429]);
    assert.equal(responses[0].headers.get("ratelimit-limit"), "3");
    assert.equal(responses[0].headers.get("ratelimit-remaining"), "2");
    assert.equal(responses[2].headers.get("ratelimit-remaining"), "0");
    assert.ok(Number(responses[3].headers.get("retry-after")) >= 1);
    assert.equal((await json(responses[3])).code, "rate_limited");
    assert.equal((await call(apiRequest("GET", "/customers", { token: b.token }))).status, 200);
    // nach dem Fenster geht es weiter
    state.apiRuntime.now = () => Date.now() + 61_000;
    assert.equal((await call(apiRequest("GET", "/customers", { token: a.token }))).status, 200);
  });
});

describe("Lesen: Seiten, Sortierung, Filter, ETag", () => {
  it("Seiten mit Obergrenze, Sortierung nur über die Whitelist, Filter strikt", async () => {
    const { token } = await makeToken(env, owner());
    for (const [i, name] of ["Berg", "Adler", "Cäsar", "Dorn", "Eich"].entries()) await env.db.customer.create({ data: { lastName: name, city: i % 2 ? "Köln" : "Bonn", ...customerSearchKeys({ lastName: name, city: i % 2 ? "Köln" : "Bonn" }) } });
    const names = async (query: string) => ((await json(await call(apiRequest("GET", `/customers${query}`, { token })))).data as Array<{ lastName: string }>).map((c) => c.lastName);

    assert.deepEqual(await names(""), ["Adler", "Berg", "Cäsar", "Dorn", "Eich"]);
    assert.deepEqual(await names("?sort=-lastName&limit=2"), ["Eich", "Dorn"]);
    const page2 = await json(await call(apiRequest("GET", "/customers?limit=2&page=2", { token })));
    assert.deepEqual(page2.data.map((c: { lastName: string }) => c.lastName), ["Cäsar", "Dorn"]);
    assert.deepEqual(page2.page, { number: 2, limit: 2, total: 5, pages: 3 });
    assert.deepEqual(await names("?city=Köln&sort=lastName"), ["Adler", "Dorn"]);
    assert.deepEqual(await names("?q=ei"), ["Eich"]);

    for (const bad of ["?limit=201", "?limit=0", "?page=0", "?page=abc", "?sort=passwordHash", "?sort=lastName,lastName", "?unknown=1", "?sort=a,b,c,d"]) {
      const response = await call(apiRequest("GET", `/customers${bad}`, { token }));
      assert.equal(response.status, 422, bad);
      assert.equal((await json(response)).code, "validation_failed");
    }
  });

  it("ETag und If-None-Match; das Element trägt seine Version", async () => {
    const { token } = await makeToken(env, owner());
    const c = await env.db.customer.create({ data: { lastName: "Etag" } });
    const response = await call(apiRequest("GET", `/customers/${c.id}`, { token }));
    const etag = response.headers.get("etag");
    assert.equal(etag, `"${c.updatedAt.getTime()}"`);
    assert.equal((await json(response)).data.version, String(c.updatedAt.getTime()));
    assert.equal((await call(apiRequest("GET", `/customers/${c.id}`, { token, headers: { "if-none-match": etag! } }))).status, 304);
    assert.equal((await call(apiRequest("GET", "/customers/gibtsnicht", { token }))).status, 404);
    assert.equal((await call(apiRequest("GET", "/customers/..%2F..%2Fx", { token }))).status, 404);
  });
});

describe("Schreiben über dieselben Operationen wie die Oberfläche", () => {
  it("anlegen: 201, Location, ETag, Audit mit Token-Kennung (nie das Token)", async () => {
    const { token, userId } = await makeToken(env, owner({ name: "Importer" }));
    const response = await call(apiRequest("POST", "/customers", { token, body: { firstName: "Anna", lastName: "Müller", email: "anna@example.org" } }));
    assert.equal(response.status, 201);
    const body = await json(response);
    assert.equal(response.headers.get("location"), `/api/v1/customers/${body.data.id}`);
    assert.ok(response.headers.get("etag"));
    assert.equal(body.data.lastName, "Müller");

    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "customer.create" } });
    assert.equal(entry.actorId, userId);
    assert.match(entry.actorName, /\[API: Importer · sos_\S{4}…\]$/);
    assert.equal(entry.target, "Anna Müller");
    assert.ok(!JSON.stringify(entry).includes(token));
  });

  it("ändern verlangt If-Match; falsche Version: 412 und nichts geht verloren; PATCH ändert nur die genannten Felder", async () => {
    const { token } = await makeToken(env, owner());
    const created = await json(await call(apiRequest("POST", "/customers", { token, body: { company: "Auto GmbH", city: "Bonn", phone: "123" } })));
    const id = created.data.id as string;
    const version = created.data.version as string;

    assert.equal((await call(apiRequest("PATCH", `/customers/${id}`, { token, body: { city: "Köln" } }))).status, 428);
    assert.equal((await call(apiRequest("PATCH", `/customers/${id}`, { token, body: { city: "Köln" }, headers: { "if-match": "kaputt" } }))).status, 400);
    assert.equal((await call(apiRequest("PATCH", `/customers/${id}`, { token, body: {}, headers: { "if-match": `"${version}"` } }))).status, 422);
    const stale = await call(apiRequest("PATCH", `/customers/${id}`, { token, body: { city: "Köln" }, headers: { "if-match": '"1"' } }));
    assert.equal(stale.status, 412);
    assert.equal((await json(stale)).code, "precondition_failed");
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id } })).city, "Bonn");

    const ok = await call(apiRequest("PATCH", `/customers/${id}`, { token, body: { city: "Köln", phone: null }, headers: { "if-match": `"${version}"` } }));
    assert.equal(ok.status, 200);
    const row = await env.db.customer.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.city, row.phone, row.company, row.lastName], ["Köln", null, "Auto GmbH", "Auto GmbH"]);
    // ein zweites Mal mit der alten Version scheitert
    assert.equal((await call(apiRequest("PATCH", `/customers/${id}`, { token, body: { city: "Aachen" }, headers: { "if-match": `"${version}"` } }))).status, 412);
    // Firmenname ändern zieht den Nachnamen mit (nicht alten Firmennamen behalten)
    const renamed = await json(await call(apiRequest("PATCH", `/customers/${id}`, { token, body: { company: "Neu GmbH" }, headers: { "if-match": ok.headers.get("etag")! } })));
    assert.equal(renamed.data.lastName, "Neu GmbH");
  });

  it("Eingabefehler: 422 mit Feldern, unbekannte Felder, falscher Typ, kaputtes JSON, falscher Content-Type, zu großer Körper", async () => {
    const { token } = await makeToken(env, owner());
    const post = (init: Parameters<typeof apiRequest>[2]) => call(apiRequest("POST", "/customers", { token, ...init }));

    const invalid = await post({ body: { phone: "1", email: "kaputt", extra: 1 } });
    assert.equal(invalid.status, 422);
    const fields = (await json(invalid)).fields as Record<string, { code: string }>;
    assert.deepEqual(Object.keys(fields).sort(), ["email", "extra"]);

    const nameRequired = await json(await post({ body: { phone: "1" } }));
    assert.equal(nameRequired.fields.lastName.code, "customers.errors.nameRequired");
    assert.equal((await post({ body: { lastName: 5 } })).status, 422);
    assert.equal((await post({ raw: "{kaputt" })).status, 400);
    assert.equal((await post({ body: { lastName: "X" }, contentType: "text/plain" })).status, 415);
    assert.equal((await post({ raw: JSON.stringify({ lastName: "x".repeat(2_000_000) }) })).status, 413);
    assert.equal((await post({ raw: "[]" })).status, 422);
    assert.equal(await env.db.customer.count(), 0);
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("löschen: 204; Kunden mit Fahrzeug bleiben (409 in_use), wie in der Oberfläche", async () => {
    const { token } = await makeToken(env, owner());
    const free = await env.db.customer.create({ data: { lastName: "Weg" } });
    assert.equal((await call(apiRequest("DELETE", `/customers/${free.id}`, { token }))).status, 204);
    assert.equal(await env.db.customer.count(), 0);
    assert.equal((await call(apiRequest("DELETE", `/customers/${free.id}`, { token }))).status, 404);

    const held = await env.db.customer.create({ data: { lastName: "Halter" } });
    await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", customerId: held.id } });
    const blocked = await call(apiRequest("DELETE", `/customers/${held.id}`, { token }));
    assert.equal(blocked.status, 409);
    const problem = await json(blocked);
    assert.equal(problem.code, "in_use");
    assert.equal(problem.reason, "customers.errors.inUse");
    assert.equal(await env.db.customer.count(), 1);
  });

  it("HEAD und OPTIONS: ohne Token 401, mit Token 405 – es gibt kein CORS", async () => {
    const { token } = await makeToken(env, owner());
    for (const method of ["HEAD", "OPTIONS"]) {
      assert.equal((await call(apiRequest(method, "/customers"))).status, 401, method);
      const response = await call(apiRequest(method, "/customers", { token }));
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
  });

  it("Methode nicht erlaubt: 405 mit Allow", async () => {
    const { token } = await makeToken(env, owner());
    const response = await call(apiRequest("PUT", "/customers", { token, body: {} }));
    assert.equal(response.status, 405);
    assert.match(response.headers.get("allow") ?? "", /GET/);
  });
});

describe("Idempotenz", () => {
  const key = "11111111-2222-3333-4444-555555555555";
  const create = (token: string, body: unknown, k = key) => call(apiRequest("POST", "/customers", { token, body, headers: { "idempotency-key": k } }));

  it("Wiederholung liefert die gespeicherte Antwort, nichts wird doppelt angelegt", async () => {
    const { token } = await makeToken(env, owner());
    const first = await create(token, { lastName: "Einmalig" });
    assert.equal(first.status, 201);
    const second = await create(token, { lastName: "Einmalig" });
    assert.equal(second.status, 201);
    assert.equal(second.headers.get("idempotent-replayed"), "true");
    assert.equal(second.headers.get("location"), first.headers.get("location"));
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(await env.db.customer.count(), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.create" } }), 1);
  });

  it("gleicher Schlüssel, anderer Körper: 422; anderer Schlüssel, anderer Token, anderer Pfad: eigenständig", async () => {
    const a = await makeToken(env, owner());
    const b = await makeToken(env, owner());
    assert.equal((await create(a.token, { lastName: "Eins" })).status, 201);
    const mismatch = await create(a.token, { lastName: "Zwei" });
    assert.equal(mismatch.status, 422);
    assert.equal((await json(mismatch)).code, "idempotency_key_reuse");
    assert.equal((await create(a.token, { lastName: "Zwei" }, "anderer-schluessel")).status, 201);
    assert.equal((await create(b.token, { lastName: "Zwei" })).status, 201);
    assert.equal(await env.db.customer.count(), 3);
    // derselbe Schlüssel auf einem anderen Pfad ist ein anderer Vorgang
    const id = (await env.db.customer.findFirstOrThrow({ where: { lastName: "Eins" } })).id;
    assert.equal((await call(apiRequest("DELETE", `/customers/${id}`, { token: a.token, headers: { "idempotency-key": key } }))).status, 204);
  });

  it("Fehlerantworten (422 …) werden nicht festgehalten: der Schlüssel ist frei, die Wiederholung entscheidet neu; der Schlüssel auf GET wird ignoriert", async () => {
    const { token } = await makeToken(env, { ownerPermissions: ["vehicles.view", "vehicles.edit"], scope: ["vehicles.view", "vehicles.edit"] });
    const existing = await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1" } });
    const send = (k: string) => call(apiRequest("POST", "/vehicles", { token, body: { plate: "B-AB 1" }, headers: { "idempotency-key": k } }));
    const first = await send("fehler-1");
    assert.equal(first.status, 422);
    assert.match(first.headers.get("content-type") ?? "", /application\/problem\+json/);
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { key: "fehler-1" } }), 0, "nichts festgehalten");
    // das Kennzeichen wird frei -> dieselbe Anfrage mit demselben Schlüssel gelingt jetzt (sie bekäme sonst bis zum Ablauf den alten Fehler)
    await env.db.vehicle.delete({ where: { id: existing.id } });
    const retry = await send("fehler-1");
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get("idempotent-replayed"), null);
    assert.equal((await send("fehler-1")).headers.get("idempotent-replayed"), "true", "der Erfolg wird festgehalten");
    const get = await call(apiRequest("GET", "/vehicles", { token, headers: { "idempotency-key": "nur-fuer-get" } }));
    assert.equal(get.status, 200);
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { key: "nur-fuer-get" } }), 0);
  });

  it("Schlüsselform ist begrenzt; abgelaufene Schlüssel werden ignoriert und aufgeräumt", async () => {
    const { token } = await makeToken(env, owner());
    for (const bad of ["", "mit leerzeichen", "ä", "x".repeat(129)]) {
      const response = await create(token, { lastName: "X" }, bad);
      assert.equal(response.status, 422, JSON.stringify(bad));
    }
    assert.equal((await create(token, { lastName: "Alt" })).status, 201);
    await env.db.apiIdempotencyKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await create(token, { lastName: "Neu" })).status, 201);
    assert.equal(await env.db.customer.count(), 2);
    await env.db.apiIdempotencyKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await idem.pruneIdempotency(), 1);
  });

  it("parallele Doppelanfragen: genau eine läuft, die andere bekommt 409 oder die gespeicherte Antwort", async () => {
    const { token } = await makeToken(env, owner());
    const results = await Promise.all(Array.from({ length: 6 }, () => create(token, { lastName: "Parallel" })));
    const statuses = results.map((r) => r.status);
    assert.ok(statuses.includes(201));
    assert.ok(statuses.every((s) => s === 201 || s === 409), statuses.join(","));
    assert.equal(await env.db.customer.count(), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.create" } }), 1);
    // danach liefert die Wiederholung die Antwort
    assert.equal((await create(token, { lastName: "Parallel" })).headers.get("idempotent-replayed"), "true");
  });

  it("404, 409, 412 und 428 geben den Schlüssel frei; eine Wiederholung mit aktueller Version gelingt", async () => {
    const { token } = await makeToken(env, owner());
    const created = await call(apiRequest("POST", "/customers", { token, body: { lastName: "Version" } }));
    const item = (await json(created)).data as Record<string, string>;
    const patch = (headers: Record<string, string>, k = "patch-1") => call(apiRequest("PATCH", `/customers/${item.id}`, { token, body: { city: "Köln" }, headers: { "idempotency-key": k, ...headers } }));
    // jemand anderes ändert zwischendurch (ohne Schlüssel): die Version `item.version` ist veraltet
    const bump = await call(apiRequest("PATCH", `/customers/${item.id}`, { token, body: { phone: "1" }, headers: { "if-match": `"${item.version}"` } }));
    assert.equal(bump.status, 200);
    const current = bump.headers.get("etag")!;
    assert.equal((await patch({})).status, 428);
    assert.equal((await patch({ "if-match": `"${item.version}"` })).status, 412);
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { key: "patch-1" } }), 0, "weder 428 noch 412 festgehalten");
    // dieselbe Anfrage mit der aktuellen Version gelingt unter demselben Schlüssel
    const ok = await patch({ "if-match": current });
    assert.equal(ok.status, 200);
    // gleiche Anfrage (Körper und If-Match) = Wiederholung -> gespeicherte Antwort statt 412 wegen inzwischen neuer Version
    const replay = await patch({ "if-match": current });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotent-replayed"), "true");
    // gleicher Schlüssel, aber anderes If-Match = andere Anfrage
    const other = await patch({ "if-match": `"${item.version}"` });
    assert.equal(other.status, 422);
    assert.equal((await json(other)).code, "idempotency_key_reuse");
    // 404 und 409 (Löschstopp) ebenfalls frei
    assert.equal((await call(apiRequest("DELETE", "/customers/gibtsnicht", { token, headers: { "idempotency-key": "del-1" } }))).status, 404);
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { key: "del-1" } }), 0);
    await env.db.vehicle.create({ data: { plate: "B-CU 1", plateNorm: "BCU1", customerId: item.id } });
    assert.equal((await call(apiRequest("DELETE", `/customers/${item.id}`, { token, headers: { "idempotency-key": "del-2" } }))).status, 409);
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { key: "del-2" } }), 0);
  });

  it("scheitert das Nachlesen nach dem Commit, antwortet die Pipeline mit der Mindestantwort (id + Location) und hält sie fest: die Wiederholung legt nichts doppelt an", async () => {
    const { token } = await makeToken(env, owner());
    const model = env.db.customer as unknown as { findUnique: (...args: unknown[]) => unknown };
    const original = model.findUnique.bind(model);
    let failures = 1;
    model.findUnique = (...args: unknown[]) => {
      if (failures-- > 0) throw new Error("Nachlesen kaputt");
      return original(...args);
    };
    try {
      const first = await create(token, { lastName: "Nachgelesen" }, "nachlesen-1");
      assert.equal(first.status, 201, "nicht 500: die Wirkung ist festgeschrieben");
      const id = (await json(first)).data.id as string;
      assert.equal(first.headers.get("location"), `/api/v1/customers/${id}`);
      assert.equal(await env.db.customer.count(), 1);
      const replay = await create(token, { lastName: "Nachgelesen" }, "nachlesen-1");
      assert.equal(replay.status, 201);
      assert.equal(replay.headers.get("idempotent-replayed"), "true");
      assert.equal((await json(replay)).data.id, id);
      assert.equal(await env.db.customer.count(), 1, "nichts doppelt angelegt");
    } finally {
      model.findUnique = original;
    }
  });

  it("je Token höchstens IDEMPOTENCY_MAX_PER_TOKEN Schlüssel: darüber 429 mit Retry-After, abgelaufene zählen nicht, andere Tokens sind frei", async () => {
    const a = await makeToken(env, owner());
    const b = await makeToken(env, owner());
    const expiresAt = new Date(Date.now() + 3_600_000);
    await env.db.apiIdempotencyKey.createMany({ data: Array.from({ length: idem.IDEMPOTENCY_MAX_PER_TOKEN }, (_, i) => ({ tokenId: a.id, scope: "POST /customers", key: `k-${i}`, bodyHash: "x", status: 201, response: "{}", expiresAt })) });
    const full = await create(a.token, { lastName: "Zuviel" }, "neu-1");
    assert.equal(full.status, 429);
    assert.ok(full.headers.get("retry-after"));
    assert.equal(await env.db.customer.count(), 0);
    assert.equal((await create(b.token, { lastName: "Anderes Token" }, "neu-1")).status, 201);
    // abgelaufene Zeilen werden vorher entfernt
    await env.db.apiIdempotencyKey.updateMany({ where: { tokenId: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await create(a.token, { lastName: "Wieder frei" }, "neu-2")).status, 201);
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { tokenId: a.id } }), 1);
  });

  it("Serverfehler werden nicht festgehalten; verwaiste Zeilen werden nach einer Minute übernommen", async () => {
    const { token, id } = await makeToken(env, owner());
    // eine „laufende“ Anfrage blockiert mit 409 …
    await env.db.apiIdempotencyKey.create({ data: { tokenId: id, scope: "POST /customers", key, bodyHash: idem.hashBody(JSON.stringify({ lastName: "Hängt" })), expiresAt: new Date(Date.now() + 3_600_000) } });
    const busy = await create(token, { lastName: "Hängt" });
    assert.equal(busy.status, 409);
    assert.equal((await json(busy)).code, "idempotency_in_progress");
    // … bis sie als verwaist gilt
    await env.db.apiIdempotencyKey.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    assert.equal((await create(token, { lastName: "Hängt" })).status, 201);
  });
});

describe("Datenbank überlastet (P2028)", () => {
  it("antwortet 503 mit Retry-After statt 500, und der Idempotenz-Schlüssel bleibt frei", async () => {
    const { token } = await makeToken(env, owner());
    const client = env.db as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const original = client.$transaction.bind(client);
    client.$transaction = async () => {
      throw Object.assign(new Error("Transaction API error"), { code: "P2028" });
    };
    try {
      const response = await call(apiRequest("POST", "/customers", { token, body: { lastName: "Busy" }, headers: { "idempotency-key": "busy-1" } }));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "2");
      assert.equal((await json(response)).code, "service_unavailable");
    } finally {
      client.$transaction = original;
    }
    assert.equal(await env.db.apiIdempotencyKey.count({ where: { key: "busy-1" } }), 0);
    assert.equal((await call(apiRequest("POST", "/customers", { token, body: { lastName: "Busy" }, headers: { "idempotency-key": "busy-1" } }))).status, 201);
  });
});

describe("OpenAPI", () => {
  it("verlangt ein gültiges Token, ist deterministisch und nennt nur aktive Funktionen", async () => {
    assert.equal((await call(apiRequest("GET", "/openapi.json"))).status, 401);
    const { token } = await makeToken(env, owner());
    const first = await call(apiRequest("GET", "/openapi.json", { token }));
    assert.equal(first.status, 200);
    const text = await first.text();
    assert.equal(text, await (await call(apiRequest("GET", "/openapi.json", { token }))).text());
    const doc = JSON.parse(text) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    assert.equal(doc.openapi, "3.1.0");
    assert.ok(doc.paths["/customers"].get && doc.paths["/customers"].post);
    assert.ok(doc.paths["/customers/{id}"].patch && doc.paths["/customers/{id}"].delete);

    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    const off = JSON.parse(await (await call(apiRequest("GET", "/openapi.json", { token }))).text()) as { paths: Record<string, unknown> };
    assert.ok(!("/customers" in off.paths));
  });
});
