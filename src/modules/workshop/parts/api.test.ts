import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** API von Teile & Lager: Artikel ohne Preise, Preise nur mit `parts.prices`, Wareneingang als Anlegen einer Bewegung, Bewegungen unveränderlich, Abschluss eines Auftrags bucht ab. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("@/server/api/router");
let state: typeof import("@/server/api/state");
let full: string;
let readOnly: string;
let noPrices: string;

const FULL = ["parts.view", "parts.edit", "parts.stock", "parts.prices", "orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices"];

before(async () => {
  env = await createTestEnv();
  for (const key of ["workshop.orders", "workshop.parts"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  state = await import("@/server/api/state");
  state.apiLimits.failuresGlobal = 1_000_000;
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  for (const table of ["apiIdempotencyKey", "stockMovement", "article", "orderEvent", "orderItem", "order", "counter", "auditLog", "vehicle"] as const) {
    await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  }
  full = (await makeToken(env, { ownerPermissions: FULL, scope: FULL, rateLimitPerMinute: 6000 })).token;
  readOnly = (await makeToken(env, { ownerPermissions: FULL, scope: ["parts.view"], rateLimitPerMinute: 6000 })).token;
  noPrices = (await makeToken(env, { ownerPermissions: ["parts.view", "parts.edit", "parts.stock"], scope: ["parts.view", "parts.edit", "parts.stock", "parts.prices"], rateLimitPerMinute: 6000 })).token;
});

const call = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, body, headers }));
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
};
const ifMatch = (item: Json) => ({ "if-match": `"${item.version}"` });

describe("Artikel über die API", () => {
  it("anlegen mit Preisen, lesen ohne Preise; Preise nur in /article-prices mit parts.prices", async () => {
    const created = await call(full, "POST", "/articles", { number: "oel-1", name: "Motoröl", unit: "l", taxBp: 1900, minStockMilli: 5000, purchaseCents: 780, saleCents: 1450 });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const article = created.json.data as Json;
    assert.equal(article.number, "OEL-1");
    assert.ok(!("purchaseCents" in article) && !("saleCents" in article), "/articles zeigt keine Preise");
    assert.equal(article.stockMilli, 0);
    const prices = await call(full, "GET", `/article-prices`);
    assert.deepEqual(prices.json.data.map((p: Json) => [p.number, p.purchaseCents, p.saleCents]), [["OEL-1", 780, 1450]]);
    assert.equal((await call(readOnly, "GET", "/article-prices")).status, 403);
    assert.equal((await call(noPrices, "GET", "/articles")).status, 200);
    const stored = await env.db.article.findUniqueOrThrow({ where: { id: article.id } });
    assert.deepEqual([stored.purchaseCents, stored.saleCents, stored.taxBp, stored.minStockMilli], [780, 1450, 1900, 5000]);
  });

  it("Preis im Körper ohne wirksames parts.prices → 403, nichts angelegt; ohne Preise im Körper ist es erlaubt", async () => {
    const denied = await call(noPrices, "POST", "/articles", { number: "x1", name: "Teil", saleCents: 100 });
    assert.equal(denied.status, 403);
    assert.equal(await env.db.article.count(), 0);
    assert.equal((await call(noPrices, "POST", "/articles", { number: "x1", name: "Teil" })).status, 201);
  });

  it("ändern mit If-Match behält Preise, wenn sie nicht im Körper stehen; null löscht; Nummer doppelt → 422", async () => {
    const created = (await call(full, "POST", "/articles", { number: "a1", name: "A", purchaseCents: 100, saleCents: 200 })).json.data as Json;
    const patched = await call(full, "PATCH", `/articles/${created.id}`, { name: "A neu" }, ifMatch(created));
    assert.equal(patched.status, 200);
    assert.equal(patched.json.data.name, "A neu");
    assert.deepEqual([(await env.db.article.findUniqueOrThrow({ where: { id: created.id } })).purchaseCents, (await env.db.article.findUniqueOrThrow({ where: { id: created.id } })).saleCents], [100, 200]);
    // ohne parts.prices am Token: eine reine Namensänderung bleibt erlaubt
    assert.equal((await call(noPrices, "PATCH", `/articles/${created.id}`, { name: "B" }, ifMatch(patched.json.data))).status, 200);
    const cleared = await call(full, "PATCH", `/articles/${created.id}`, { saleCents: null }, ifMatch((await call(full, "GET", `/articles/${created.id}`)).json.data));
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    assert.equal((await env.db.article.findUniqueOrThrow({ where: { id: created.id } })).saleCents, null);
    const dup = await call(full, "POST", "/articles", { number: "A1", name: "doppelt" });
    assert.equal(dup.status, 422);
    assert.ok(dup.json.fields.number);
    assert.equal((await call(full, "PATCH", `/articles/${created.id}`, { name: "x" }, { "if-match": '"1"' })).status, 412);
  });

  it("archivieren und wieder aktivieren (If-Match); Filter archived", async () => {
    const a = (await call(full, "POST", "/articles", { number: "a1", name: "A" })).json.data as Json;
    const archived = await call(full, "POST", `/articles/${a.id}/archive`, undefined, ifMatch(a));
    assert.equal(archived.status, 200);
    assert.ok(archived.json.data.archivedAt);
    assert.equal((await call(full, "GET", "/articles?archived=false")).json.data.length, 0);
    assert.equal((await call(full, "GET", "/articles?archived=true")).json.data.length, 1);
    assert.equal((await call(full, "POST", `/articles/${a.id}/unarchive`, undefined, ifMatch(archived.json.data))).json.data.archivedAt, null);
  });
});

describe("Bewegungen über die API", () => {
  it("Wareneingang anlegen (Menge in Tausendsteln), Bewegungen lesen und filtern; kein Ändern/Löschen; ohne parts.stock 403", async () => {
    const a = (await call(full, "POST", "/articles", { number: "a1", name: "A" })).json.data as Json;
    const receipt = await call(full, "POST", "/stock-movements", { articleId: a.id, quantityMilli: 2500, reference: "LS-1" });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.json));
    assert.deepEqual([receipt.json.data.kind, receipt.json.data.quantityMilli, receipt.json.data.stockAfterMilli, receipt.json.data.reference], ["receipt", 2500, 2500, "LS-1"]);
    assert.equal((await call(full, "GET", `/articles/${a.id}`)).json.data.stockMilli, 2500);
    assert.equal((await call(full, "GET", `/stock-movements?articleId=${a.id}&kind=receipt`)).json.data.length, 1);
    assert.equal((await call(full, "PATCH", `/stock-movements/${receipt.json.data.id}`, { quantityMilli: 1 })).status, 405);
    assert.equal((await call(full, "DELETE", `/stock-movements/${receipt.json.data.id}`)).status, 405);
    assert.equal((await call(readOnly, "POST", "/stock-movements", { articleId: a.id, quantityMilli: 1 })).status, 403);
    assert.equal((await call(full, "POST", "/stock-movements", { articleId: a.id, quantityMilli: 0 })).status, 422);
    assert.equal((await call(full, "POST", "/stock-movements", { articleId: "gibtsnicht", quantityMilli: 1 })).status, 422);
    assert.equal((await call(readOnly, "GET", "/stock-movements")).status, 200);
  });

  it("der Abschluss eines Auftrags über die API bucht ab (gleiche Operationen und Hooks wie die Oberfläche); Wareneingang nach dem Abgang zeigt beides", async () => {
    const vehicle = await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } });
    const a = (await call(full, "POST", "/articles", { number: "a1", name: "Filter", saleCents: 1000 })).json.data as Json;
    await call(full, "POST", "/stock-movements", { articleId: a.id, quantityMilli: 5000 });
    let order = (await call(full, "POST", "/orders", { vehicleId: vehicle.id })).json.data as Json;
    order = (await call(full, "POST", `/orders/${order.id}/status`, { status: "in_progress" }, ifMatch(order))).json.data as Json;
    // die API setzt Positionen ohne Verweis; der Verweis entsteht in der Oberfläche (Artikelauswahl) – hier direkt in der Datenbank
    order = (await call(full, "POST", `/orders/${order.id}/items`, { items: [{ description: "Filter", unit: "Stk", kind: "part", quantityMilli: 2000, unitCents: 1000, taxBp: 1900 }] }, ifMatch(order))).json.data as Json;
    await env.db.orderItem.updateMany({ where: { orderId: order.id }, data: { refType: "article", refId: a.id } });
    const closed = await call(full, "POST", `/orders/${order.id}/close`, undefined, ifMatch(order));
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal((await call(full, "GET", `/articles/${a.id}`)).json.data.stockMilli, 3000);
    const moves = await call(full, "GET", `/stock-movements?orderId=${order.id}`);
    assert.deepEqual(moves.json.data.map((m: Json) => [m.kind, m.quantityMilli, m.orderNumber === order.number]), [["order", -2000, true]]);
  });
});
