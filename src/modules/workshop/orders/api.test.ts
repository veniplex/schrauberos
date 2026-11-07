import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * API der Aufträge (`/api/v1/orders`, `/order-items`, `/order-approvals`): dieselben Operationen wie die Oberfläche; keine Preise in `/orders`; Positionen und Freigaben nur mit
 * `orders.prices`; Wiederöffnen gibt es nicht; eingeschränkte Kunden sind 404; Wirksam ist Scope ∩ Rechte des Besitzers.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("@/server/api/router");
let state: typeof import("@/server/api/state");
let full: string;
let vehicleId: string;

const FULL_SCOPE = ["orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices"];

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "workshop.orders", enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  state = await import("@/server/api/state");
  state.apiLimits.failuresGlobal = 1_000_000;
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  for (const table of ["apiIdempotencyKey", "orderEvent", "orderApproval", "orderFinding", "orderItem", "order", "counter", "auditLog", "vehicle", "customer"] as const) {
    await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  }
  full = (await makeToken(env, { ownerPermissions: [...FULL_SCOPE, "orders.reopen"], scope: FULL_SCOPE, rateLimitPerMinute: 6000 })).token;
  const owner = await env.db.customer.create({ data: { lastName: "Muster", nameKey: "muster" } });
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1", customerId: owner.id, mileageKm: 1000 } })).id;
});

const call = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, body, headers }));
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
};
const ifMatch = (item: Json) => ({ "if-match": `"${item.version}"` });
const fresh = async (token: string, id: string) => (await call(token, "GET", `/orders/${id}`)).json.data as Json;
async function newOrder(extra: Record<string, unknown> = {}) {
  const created = await call(full, "POST", "/orders", { vehicleId, request: "Ölwechsel", mileageKm: 2000, ...extra });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.data as Json;
}

describe("Aufträge über die API", () => {
  it("anlegen (Nummer aus dem Zähler, Kilometerstand ins Fahrzeug), lesen ohne Preise, ändern mit If-Match", async () => {
    const order = await newOrder();
    assert.match(order.number, /^A-\d{4}-0001$/);
    assert.equal(order.status, "accepted");
    assert.equal(order.mileageKm, 2000);
    assert.ok(!("totalCents" in order) && !("grossCents" in order), "keine Preise in /orders");
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileageKm, 2000);
    assert.equal((await call(full, "PATCH", `/orders/${order.id}`, { request: "neu" })).status, 428);
    const patched = await call(full, "PATCH", `/orders/${order.id}`, { request: "Ölwechsel und Bremsen" }, ifMatch(order));
    assert.equal(patched.status, 200);
    assert.equal(patched.json.data.request, "Ölwechsel und Bremsen");
    const stale = await call(full, "PATCH", `/orders/${order.id}`, { request: "x" }, ifMatch(order));
    assert.equal(stale.status, 412);
  });

  it("Statuskette: status, close (Hooks laufen), Wiederöffnen gibt es nicht; ungültige Schritte sind 422", async () => {
    const order = await newOrder();
    const started = await call(full, "POST", `/orders/${order.id}/status`, { status: "in_progress" }, ifMatch(order));
    assert.equal(started.status, 200);
    assert.equal(started.json.data.status, "in_progress");
    const toPickedUp = await call(full, "POST", `/orders/${order.id}/status`, { status: "picked_up" }, ifMatch(started.json.data));
    assert.equal(toPickedUp.status, 422, "Abgeholt gibt es nur über /close");
    const closed = await call(full, "POST", `/orders/${order.id}/close`, undefined, ifMatch(started.json.data));
    assert.equal(closed.status, 200);
    assert.equal(closed.json.data.status, "picked_up");
    assert.ok(closed.json.data.closedAt);
    assert.equal((await call(full, "POST", `/orders/${order.id}/reopen`, undefined, ifMatch(closed.json.data))).status, 404, "Wieder öffnen ist keine API-Aktion");
    assert.equal((await call(full, "POST", `/orders/${order.id}/status`, { status: "ready" }, ifMatch(closed.json.data))).status, 422);
  });

  it("Positionen: ersetzen (orders.prices), lesen nur mit orders.prices; Summen entstehen aus Zahlen", async () => {
    const order = await newOrder();
    const items = [
      { description: "Arbeit", unit: "Std.", kind: "labor", quantityMilli: 1500, unitCents: 8500, taxBp: 1900 },
      { description: "Filter", unit: "Stk", kind: "part", quantityMilli: 1000, unitCents: 1250, taxBp: 1900, discountBp: 1000 },
    ];
    const saved = await call(full, "POST", `/orders/${order.id}/items`, { items }, ifMatch(order));
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const listed = await call(full, "GET", `/order-items?orderId=${order.id}`);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.data.map((i: Json) => [i.position, i.kind, i.unitCents, i.discountBp]), [[0, "labor", 8500, 0], [1, "part", 1250, 1000]]);
    const bad = await call(full, "POST", `/orders/${order.id}/items`, { items: [{ description: "x", quantityMilli: 1, unitCents: 1, taxBp: 99999 }] }, ifMatch(saved.json.data));
    assert.equal(bad.status, 422);
    // ohne orders.prices: weder lesen noch ersetzen, /orders selbst bleibt lesbar
    const noPrices = (await makeToken(env, { ownerPermissions: FULL_SCOPE, scope: ["orders.view", "orders.edit"], rateLimitPerMinute: 6000 })).token;
    assert.equal((await call(noPrices, "GET", "/order-items")).status, 403);
    assert.equal((await call(noPrices, "POST", `/orders/${order.id}/items`, { items }, ifMatch(await fresh(noPrices, order.id)))).status, 403);
    assert.equal((await call(noPrices, "GET", `/orders/${order.id}`)).status, 200);
    // Besitzer ohne orders.prices, Scope mit: wirksam ist die Schnittmenge
    const ownerLost = (await makeToken(env, { ownerPermissions: ["orders.view", "orders.edit"], scope: FULL_SCOPE, rateLimitPerMinute: 6000 })).token;
    assert.equal((await call(ownerLost, "GET", "/order-items")).status, 403);
  });

  it("Freigaben: telefonisch und getippt anlegen, lesen; die Unterschrift am Gerät gibt es nicht; kein Ändern oder Löschen", async () => {
    const order = await newOrder();
    const phone = await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 24000, reason: "Kondensator", method: "phone", approverName: "Erika Muster" });
    assert.equal(phone.status, 201, JSON.stringify(phone.json));
    assert.deepEqual([phone.json.data.method, phone.json.data.amountCents, phone.json.data.orderId], ["phone", 24000, order.id]);
    const typed = await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 500, reason: "Kleinteile", method: "typed", approverName: "Hans" });
    assert.equal(typed.status, 201);
    assert.equal(typed.json.data.method, "typed");
    assert.equal((await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 500, reason: "x", method: "signature", approverName: "Hans" })).status, 422, "Zeichnen gibt es nur in der Oberfläche");
    assert.equal((await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 0, reason: "x", method: "phone", approverName: "A" })).status, 422);
    assert.equal((await call(full, "GET", `/order-approvals?orderId=${order.id}`)).json.data.length, 2);
    assert.equal((await call(full, "PATCH", `/order-approvals/${phone.json.data.id}`, { amountCents: 1 })).status, 405);
    assert.equal((await call(full, "DELETE", `/order-approvals/${phone.json.data.id}`)).status, 405);
    assert.equal((await call(full, "POST", "/order-approvals", { orderId: "gibtsnicht", amountCents: 1, reason: "x", method: "phone", approverName: "A" })).status, 404);
  });

  it("Befund anlegen; Aufträge eines Kunden mit eingeschränkter Verarbeitung gibt es für die API nicht (404, nicht in der Liste)", async () => {
    const order = await newOrder();
    assert.equal((await call(full, "POST", `/orders/${order.id}/findings`, { text: "Bremsscheiben verschlissen" })).status, 200);
    assert.equal(await env.db.orderFinding.count(), 1);
    const owner = (await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).customerId!;
    await env.db.customer.update({ where: { id: owner }, data: { processingRestrictedAt: new Date() } });
    assert.equal((await call(full, "GET", `/orders/${order.id}`)).status, 404);
    assert.equal((await call(full, "GET", "/orders")).json.data.length, 0);
    assert.equal((await call(full, "GET", "/order-items")).json.data.length, 0);
  });

  it("Filter und Fehler: unbekannter Filter 422, Fahrzeug unbekannt 422, doppelter Termin 409", async () => {
    assert.equal((await call(full, "GET", "/orders?foo=1")).status, 422);
    assert.equal((await call(full, "POST", "/orders", { vehicleId: "gibtsnicht" })).status, 422);
    const appointment = await env.db.appointment.create({ data: { title: "HU", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId } });
    await newOrder({ appointmentId: appointment.id });
    assert.equal((await call(full, "POST", "/orders", { vehicleId, appointmentId: appointment.id })).status, 409);
    const filtered = await call(full, "GET", `/orders?appointmentId=${appointment.id}&status=accepted`);
    assert.equal(filtered.json.data.length, 1);
  });
});
