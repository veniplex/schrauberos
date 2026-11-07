import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { curlOf, docModel, fieldsOf, typeOf } from "./docs";

/** Darstellungsmodell der Doku-Seite: Typen, Felder, curl mit Platzhaltern, Vollständigkeit gegenüber den Endpunkten der Schnittstelle. */
describe("Typen und Felder aus JSON-Schema", () => {
  it("fasst Typen kurz: Aufzählungen, Nullbarkeit, Listen, Formate", () => {
    assert.equal(typeOf({ type: "string" }), "string");
    assert.equal(typeOf({ type: "integer" }), "integer");
    assert.equal(typeOf({ type: "string", format: "date-time" }), "string (date-time)");
    assert.equal(typeOf({ enum: ["a", "b"] }), "a | b");
    assert.equal(typeOf({ anyOf: [{ type: "string" }, { type: "null" }] }), "string | null");
    assert.equal(typeOf({ type: "array", items: { type: "integer" } }), "integer[]");
    assert.equal(typeOf({}), "any");
    assert.ok(typeOf({ enum: Array.from({ length: 80 }, (_, i) => `wert${i}`) }).length <= 140);
    assert.deepEqual(fieldsOf({ type: "object", properties: { a: { type: "string" }, b: { type: "integer" } }, required: ["a"] }), [
      { name: "a", type: "string", required: true },
      { name: "b", type: "integer", required: false },
    ]);
  });

  it("curl: Platzhalter statt Token, Idempotency-Key bei Schreibzugriffen, If-Match bei Änderungen, Körper nur mit Pflichtfeldern, Upload als multipart", () => {
    const body = { type: "object", properties: { name: { type: "string" }, kind: { enum: ["x", "y"] }, note: { type: "string" } }, required: ["name", "kind"] };
    const get = curlOf("GET", "/customers/{id}", "https://w.example", null, null, false);
    assert.equal(get, 'curl -X GET "https://w.example/api/v1/customers/<id>" \\\n  -H "Authorization: Bearer <TOKEN>"');
    const patch = curlOf("PATCH", "/customers/{id}", "https://w.example", body, "json", true);
    assert.match(patch, /Idempotency-Key: \$\(uuidgen\)/);
    assert.match(patch, /If-Match: "<etag>"/);
    assert.match(patch, /-d '\{"name":"…","kind":"x"\}'/);
    const upload = curlOf("POST", "/files", "https://w.example", { type: "object", properties: { ownerId: { type: "string" }, file: { type: "string" } }, required: ["ownerId", "file"] }, "multipart", false);
    assert.match(upload, /-F "file=@datei\.jpg"/);
    assert.match(upload, /-F "ownerId=…"/);
    assert.ok(!/sos_/.test(`${get}${patch}${upload}`), "nie ein echtes Token");
  });
});

describe("Modell der Doku aus der Beschreibung der Schnittstelle", () => {
  let env: TestEnv;
  before(async () => {
    env = await createTestEnv();
  });
  after(() => env.cleanup());

  it("jeder Endpunkt aktiver Funktionen steht genau einmal mit Recht und curl; Downloads und Uploads sind gekennzeichnet; nichts Geheimes", async () => {
    const { apiEndpoints } = await import("@/modules/api");
    const { buildOpenApi } = await import("@/server/api/openapi");
    const { FEATURES, fullFeatureId } = await import("@/modules/catalog");
    const all = new Set<string>(FEATURES.map((f) => fullFeatureId(f)));
    const groups = docModel(buildOpenApi(apiEndpoints, all), "https://w.example");
    const operations = groups.flatMap((g) => g.operations);
    assert.equal(operations.length, apiEndpoints.length);
    assert.deepEqual(operations.map((o) => o.id).sort(), apiEndpoints.map((e) => e.operationId).sort());
    for (const op of operations) {
      assert.ok(op.permission, op.id);
      assert.match(op.curl, /^curl -X (GET|POST|PATCH|DELETE) "https:\/\/w\.example\/api\/v1\//, op.id);
      assert.match(op.curl, /Authorization: Bearer <TOKEN>/, op.id);
      if (op.method !== "GET") assert.match(op.curl, /Idempotency-Key/, op.id);
      // If-Match steht im Beispiel genau dort, wo die Beschreibung den Kopf verlangt (Tabellen ohne Version haben keinen ETag)
      assert.equal(/If-Match/.test(op.curl), op.params.some((param) => param.name === "If-Match"), op.id);
    }
    assert.ok(operations.some((o) => o.bodyKind === "multipart"), "ein Upload-Endpunkt");
    assert.ok(operations.some((o) => o.download), "ein Download-Endpunkt");
    assert.ok(operations.some((o) => o.list && o.response && o.response.length > 0), "Listen nennen die Felder eines Elements");
    assert.ok(!/sos_[A-Za-z0-9_-]{43}|whsec_/.test(JSON.stringify(groups)));
    // Plattform und Verwaltung stehen nicht in der Beschreibung
    for (const op of operations) assert.ok(!/^\/(users|roles|settings|modules|backups|updates|audit|api-tokens|webhooks)\b/.test(op.path), op.path);
  });

  it("ausgeschaltete Funktionen erscheinen nicht", async () => {
    const { apiEndpoints } = await import("@/modules/api");
    const { buildOpenApi } = await import("@/server/api/openapi");
    const none = docModel(buildOpenApi(apiEndpoints, new Set()), "https://w.example");
    assert.deepEqual(none, []);
  });
});
