import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import { grantablePermissions } from "@/lib/api/scope";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Vertragstest (ZP2-Q-5): Das ausgelieferte OpenAPI-Dokument (`/api/v1/openapi.json`) wird gegen **echte Antworten** geprüft – nicht nur gegen sich selbst.
 *  - Jede Liste, jedes Element (Demo-Daten aller Funktionen) und jede Antwort auf Anlegen/Ändern entspricht dem Schema der Beschreibung (aus dem Dokument neu aufgebaut,
 *    streng: unbekannte Felder sind ein Fehler),
 *  - jeder beobachtete Statuscode steht in der Beschreibung der Operation, und die dort genannten Header (ETag, Location, RateLimit-*, Retry-After, Allow) sind da.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
let token: string;
let doc: Json;

const observed: Array<{ method: string; template: string; status: number; headers: Headers }> = [];

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
  state.apiLimits.failuresGlobal = 1_000_000;
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  await (await import("@/server/seed/demo")).seedAllDemo(env.db);
  token = (await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 })).token;
  state.resetApiLimiters();
  doc = (await raw("GET", "/openapi.json")).json;
});
after(() => env.cleanup());

/** Pfadvorlage der Beschreibung zu einem konkreten Pfad (`/customers/abc` → `/customers/{id}`). */
function templateOf(method: string, path: string): string | null {
  const only = path.split("?")[0];
  for (const template of Object.keys(doc?.paths ?? {})) {
    const pattern = new RegExp(`^${template.replace(/\{\w+\}/g, "[^/]+")}$`);
    if (pattern.test(only) && doc.paths[template][method.toLowerCase()]) return template;
  }
  return null;
}

async function raw(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; token?: string | null; rawBody?: string; contentType?: string | null } = {}) {
  const response = await router.handleApiRequest(
    apiRequest(method, path, { token: init.token === undefined ? token : init.token, body: init.body, raw: init.rawBody, headers: init.headers, contentType: init.contentType }),
  );
  const text = await response.text();
  const template = doc ? templateOf(method, path) : null;
  if (template) observed.push({ method: method.toLowerCase(), template, status: response.status, headers: response.headers });
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json, text };
}

/** `$ref` aus `#/components/...` ersetzen (die Beschreibung hat keine Rekursion). */
function deref(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deref);
  if (node && typeof node === "object") {
    const object = node as Json;
    if (typeof object.$ref === "string") return deref(object.$ref.replace(/^#\//, "").split("/").reduce<unknown>((n, part) => (n as Json)[part], doc));
    return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, deref(v)]));
  }
  return node;
}

/** Schema der Antwort aus dem Dokument als Zod-Schema (streng, wie ausgeliefert). */
function responseSchema(template: string, method: string, status: number): z.ZodType {
  const schema = doc.paths[template][method].responses[String(status)]?.content?.["application/json"]?.schema;
  assert.ok(schema, `${method.toUpperCase()} ${template}: kein JSON-Schema für ${status} in der Beschreibung`);
  return z.fromJSONSchema(deref(schema) as never);
}

const problemSchema = () => z.fromJSONSchema(deref(doc.components.schemas.Problem) as never);

describe("Der Test selbst", () => {
  it("das aus der Beschreibung gebaute Schema ist streng: unbekannte Felder und falsche Typen fallen auf", async () => {
    const list = await raw("GET", "/customers?limit=1");
    const schema = responseSchema("/customers", "get", 200);
    schema.parse(list.json);
    const extra = structuredClone(list.json);
    extra.data[0].geheim = "x";
    assert.throws(() => schema.parse(extra));
    const wrongType = structuredClone(list.json);
    wrongType.data[0].version = 5;
    assert.throws(() => schema.parse(wrongType));
    const missing = structuredClone(list.json);
    delete missing.page;
    assert.throws(() => schema.parse(missing));
  });
});

describe("Beschreibung gegen echte Antworten: Lesen", () => {
  const listPaths = () => Object.entries(doc.paths as Record<string, Json>).filter(([p, m]) => !p.includes("{") && m.get);

  it("alle Listen (Demo-Daten): Elemente und Seitenangaben entsprechen dem Schema, die Header sind da", async () => {
    let withData = 0;
    for (const [path] of listPaths()) {
      const res = await raw("GET", `${path}?limit=5`);
      assert.equal(res.status, 200, `${path}: ${res.text.slice(0, 200)}`);
      responseSchema(path, "get", 200).parse(res.json);
      for (const header of ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"]) assert.ok(res.headers.get(header), `${path}: ${header}`);
      if (res.json.data.length > 0) withData++;
    }
    assert.ok(withData >= 10, `nur ${withData} Listen mit Demo-Daten – der Test prüft zu wenig`);
  });

  it("jedes Element: Schema, ETag (wo dokumentiert), und If-None-Match → 304 in allen gültigen Schreibweisen", async () => {
    let checked = 0;
    for (const [path] of listPaths()) {
      const list = await raw("GET", `${path}?limit=1`);
      const first = list.json.data[0] as Json | undefined;
      if (!first) continue;
      const item = await raw("GET", `${path}/${first.id}`);
      assert.equal(item.status, 200, `${path}/${first.id}`);
      responseSchema(`${path}/{id}`, "get", 200).parse(item.json);
      const documentsEtag = !!doc.paths[`${path}/{id}`].get.responses["200"].headers.ETag;
      const etag = item.headers.get("etag");
      assert.equal(!!etag, documentsEtag, `${path}/{id}: ETag dokumentiert=${documentsEtag}, geliefert=${etag}`);
      if (etag) {
        for (const header of [etag, `W/${etag}`, `"x", ${etag}`, "*"]) {
          const hit = await raw("GET", `${path}/${first.id}`, { headers: { "if-none-match": header } });
          assert.equal(hit.status, 304, `${path}/{id} If-None-Match: ${header}`);
          assert.equal(hit.text, "");
          assert.equal(hit.headers.get("etag"), etag);
        }
        assert.equal((await raw("GET", `${path}/${first.id}`, { headers: { "if-none-match": '"0"' } })).status, 200);
      }
      checked++;
    }
    assert.ok(checked >= 10, `nur ${checked} Elemente geprüft`);
  });
});

describe("Beschreibung gegen echte Antworten: Schreiben und Fehler", () => {
  it("Anlegen (201 + Location), Ändern (200 + ETag) und Löschen (204) entsprechen der Beschreibung", async () => {
    const created = await raw("POST", "/customers", { body: { lastName: "Vertrag", city: "Köln" } });
    assert.equal(created.status, 201);
    responseSchema("/customers", "post", 201).parse(created.json);
    assert.equal(created.headers.get("location"), `/api/v1/customers/${created.json.data.id}`);
    assert.ok(doc.paths["/customers"].post.responses["201"].headers.Location, "Location ist dokumentiert");
    assert.ok(created.headers.get("etag"));

    const patched = await raw("PATCH", `/customers/${created.json.data.id}`, { body: { phone: "123" }, headers: { "if-match": created.headers.get("etag")! } });
    assert.equal(patched.status, 200);
    responseSchema("/customers/{id}", "patch", 200).parse(patched.json);

    const vehicle = await raw("POST", "/vehicles", { body: { plate: "B-VT 1", customerId: created.json.data.id } });
    assert.equal(vehicle.status, 201);
    responseSchema("/vehicles", "post", 201).parse(vehicle.json);
    const appointment = await raw("POST", "/appointments", { body: { title: "Vertrag", date: "2030-05-06", time: "09:00", durationMinutes: 30, vehicleId: vehicle.json.data.id } });
    assert.equal(appointment.status, 201, appointment.text);
    responseSchema("/appointments", "post", 201).parse(appointment.json);
    const invoice = await raw("POST", "/invoices", { body: { direction: "outgoing", number: "RE-VERTRAG", partyName: "Kunde", issueDate: "2030-05-06", grossCents: 100 } });
    assert.equal(invoice.status, 201, invoice.text);
    responseSchema("/invoices", "post", 201).parse(invoice.json);
    const paid = await raw("POST", `/invoices/${invoice.json.data.id}/pay`, { body: { paidAt: "2030-05-07" } });
    assert.equal(paid.status, 200);
    responseSchema("/invoices/{id}/pay", "post", 200).parse(paid.json);

    const removed = await raw("DELETE", `/appointments/${appointment.json.data.id}`);
    assert.equal(removed.status, 204);
  });

  it("jede Fehlerantwort ist ein Problem im dokumentierten Format; 400, 405, 409, 412, 413, 415, 422, 428 kommen vor und sind dokumentiert", async () => {
    const customer = (await raw("POST", "/customers", { body: { lastName: "Fehler" } })).json.data as Json;
    const problems: Array<[number, Awaited<ReturnType<typeof raw>>]> = [];
    const expect = async (status: number, call: Promise<Awaited<ReturnType<typeof raw>>>) => {
      const res = await call;
      assert.equal(res.status, status, `erwartet ${status}: ${res.text.slice(0, 160)}`);
      problems.push([status, res]);
      return res;
    };
    await expect(400, raw("POST", "/customers", { rawBody: "{kaputt", contentType: "application/json" }));
    await expect(404, raw("GET", "/customers/gibtsnicht"));
    await expect(405, raw("DELETE", "/appointment-bays/abc"));
    await expect(413, raw("POST", "/customers", { rawBody: JSON.stringify({ lastName: "x".repeat(1_100_000) }), contentType: "application/json" }));
    await expect(415, raw("POST", "/customers", { rawBody: "lastName=x", contentType: "application/x-www-form-urlencoded" }));
    await expect(422, raw("POST", "/customers", { body: { vorname: "x" } }));
    await expect(422, raw("DELETE", `/customers/${customer.id}`, { headers: { "idempotency-key": "ungültig mit leerzeichen" } }));
    await expect(428, raw("PATCH", `/customers/${customer.id}`, { body: { city: "Köln" } }));
    await expect(412, raw("PATCH", `/customers/${customer.id}`, { body: { city: "Köln" }, headers: { "if-match": '"1"' } }));
    await expect(400, raw("PATCH", `/customers/${customer.id}`, { body: { city: "Köln" }, headers: { "if-match": "kein-etag" } }));
    const vehicle = (await raw("POST", "/vehicles", { body: { plate: "B-FE 1", customerId: customer.id } })).json.data as Json;
    await expect(409, raw("DELETE", `/customers/${customer.id}`));
    assert.ok(vehicle.id);
    await expect(401, raw("GET", "/customers", { token: null }));

    const schema = problemSchema();
    for (const [status, res] of problems) {
      schema.parse(res.json);
      assert.equal(res.json.status, status);
      assert.match(res.headers.get("content-type") ?? "", /^application\/problem\+json/);
    }
    // Header laut Beschreibung
    assert.equal(problems.find(([s]) => s === 405)![1].headers.get("allow") !== null, true, "405 nennt Allow");
    assert.ok(problems.filter(([s]) => s !== 401).every(([, r]) => r.headers.get("ratelimit-limit")), "RateLimit-Header an jeder Antwort nach der Anmeldung");
  });

  it("Rate-Limit: 429 trägt Retry-After und die RateLimit-Header, wie beschrieben", async () => {
    const limited = (await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 2 })).token;
    await raw("GET", "/customers", { token: limited });
    await raw("GET", "/customers", { token: limited });
    const res = await raw("GET", "/customers", { token: limited });
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("retry-after"));
    for (const header of ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"]) assert.ok(res.headers.get(header), header);
    problemSchema().parse(res.json);
    const op = doc.paths["/customers"].get.responses["429"];
    assert.ok((deref(op) as Json).headers["Retry-After"], "Retry-After ist dokumentiert");
  });

  it("alles, was beobachtet wurde, steht in der Beschreibung (Statuscode je Operation)", () => {
    const undocumented = observed.filter((o) => !doc.paths[o.template][o.method].responses[String(o.status)]).map((o) => `${o.method.toUpperCase()} ${o.template} → ${o.status}`);
    assert.deepEqual([...new Set(undocumented)], []);
    assert.ok(observed.length > 40, `nur ${observed.length} Antworten beobachtet`);
    // dokumentierte Header gibt es wirklich
    for (const o of observed.filter((x) => x.status >= 200 && x.status < 300 && x.status !== 204)) {
      const documented = deref(doc.paths[o.template][o.method].responses[String(o.status)]) as Json;
      for (const name of Object.keys(documented.headers ?? {})) assert.ok(o.headers.get(name.toLowerCase()), `${o.method.toUpperCase()} ${o.template} ${o.status}: Header ${name} fehlt`);
    }
  });
});
