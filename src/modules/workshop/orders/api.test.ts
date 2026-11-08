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
/** zusätzlich: Termine sehen (nötig, um einen Termin mit einem Auftrag zu verknüpfen) */
const WITH_APPOINTMENTS = [...FULL_SCOPE, "appointments.view"];

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
  full = (await makeToken(env, { ownerPermissions: [...WITH_APPOINTMENTS, "orders.reopen"], scope: WITH_APPOINTMENTS, rateLimitPerMinute: 6000 })).token;
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
    // Z6-1 L7: Der Endpunkt verlangt orders.edit **und** orders.prices (OpenAPI: x-required-permission + x-also-requires) – ein Token mit nur einem der beiden sieht ihn weder in der Beschreibung noch kommt es durch
    const onlyPrices = (await makeToken(env, { ownerPermissions: FULL_SCOPE, scope: ["orders.view", "orders.prices"], rateLimitPerMinute: 6000 })).token;
    assert.equal((await call(onlyPrices, "POST", `/orders/${order.id}/items`, { items }, ifMatch(await fresh(onlyPrices, order.id)))).status, 403);
    const docOf = async (token: string) => (await call(token, "GET", "/openapi.json")).json.paths as Json;
    assert.ok(!(await docOf(noPrices))["/orders/{id}/items"], "ohne orders.prices fehlt der Endpunkt in der Beschreibung");
    assert.ok(!(await docOf(onlyPrices))["/orders/{id}/items"], "ohne orders.edit auch");
    const documented = (await docOf(full))["/orders/{id}/items"].post;
    assert.deepEqual([documented["x-required-permission"], documented["x-also-requires"]], ["orders.edit", ["orders.prices"]]);
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

describe("Fix-Runde 12b: Positionen verlustfrei, eingeschränkte Kunden überall 404", () => {
  const prepareArticle = async (stockMilli = 10_000) => {
    await env.db.featureSetting.upsert({ where: { key: "workshop.parts" }, update: { enabled: true }, create: { key: "workshop.parts", enabled: true, updatedByName: "test" } });
    await env.db.stockMovement.deleteMany();
    await env.db.article.deleteMany();
    return env.db.article.create({ data: { number: "OF-1", name: "Ölfilter", searchKey: "of-1 ölfilter", stockMilli } });
  };
  const toWorking = async (order: Json) => {
    const started = await call(full, "POST", `/orders/${order.id}/status`, { status: "in_progress" }, ifMatch(order));
    assert.equal(started.status, 200);
    return started.json.data as Json;
  };

  it("H1: lesen → ändern → zurückschicken erhält den Artikelverweis; der Abschluss bucht ab", async () => {
    const article = await prepareArticle();
    try {
      let order = await toWorking(await newOrder());
      const first = await call(
        full,
        "POST",
        `/orders/${order.id}/items`,
        {
          items: [
            { description: "Arbeit", unit: "Std.", kind: "labor", quantityMilli: 1000, unitCents: 8500, taxBp: 1900 },
            { description: "Ölfilter", unit: "Stk", kind: "part", quantityMilli: 2000, unitCents: 1250, taxBp: 1900, refType: "article", refId: article.id },
          ],
        },
        ifMatch(order),
      );
      assert.equal(first.status, 200, JSON.stringify(first.json));
      const read = (await call(full, "GET", `/order-items?orderId=${order.id}`)).json.data as Json[];
      assert.deepEqual(read.map((i) => [i.kind, i.refType, i.refId]), [["labor", null, null], ["part", "article", article.id]]);

      // genau das Gelesene (samt id, orderId, position, null-Verweisen) mit einer Änderung zurückschicken
      const changed = read.map((item) => (item.kind === "part" ? { ...item, description: "Ölfilter groß" } : item));
      order = (await call(full, "GET", `/orders/${order.id}`)).json.data;
      const again = await call(full, "POST", `/orders/${order.id}/items`, { items: changed }, ifMatch(order));
      assert.equal(again.status, 200, JSON.stringify(again.json));
      const reread = (await call(full, "GET", `/order-items?orderId=${order.id}`)).json.data as Json[];
      assert.deepEqual(reread.map((i) => [i.position, i.kind, i.description, i.quantityMilli, i.unitCents, i.refType, i.refId]), [
        [0, "labor", "Arbeit", 1000, 8500, null, null],
        [1, "part", "Ölfilter groß", 2000, 1250, "article", article.id],
      ]);

      order = (await call(full, "GET", `/orders/${order.id}`)).json.data;
      assert.equal((await call(full, "POST", `/orders/${order.id}/close`, undefined, ifMatch(order))).status, 200);
      assert.equal((await env.db.article.findUniqueOrThrow({ where: { id: article.id } })).stockMilli, 8000, "der Abschluss hat abgebucht");
      assert.equal(await env.db.stockMovement.count({ where: { articleId: article.id, kind: "order" } }), 1);
    } finally {
      await env.db.featureSetting.update({ where: { key: "workshop.parts" }, data: { enabled: false } });
    }
  });

  it("H1: unbekannter Artikel ist 422 (Feld items.0.refId), Typ ohne Kennung ebenso; ein abgelehnter Körper ändert nichts", async () => {
    const article = await prepareArticle();
    try {
      const order = await toWorking(await newOrder());
      const line = { description: "Ölfilter", unit: "Stk", kind: "part", quantityMilli: 1000, unitCents: 1250, taxBp: 1900 };
      const unknown = await call(full, "POST", `/orders/${order.id}/items`, { items: [{ ...line, refType: "article", refId: "gibtsnicht" }] }, ifMatch(order));
      assert.equal(unknown.status, 422);
      assert.ok(unknown.json.fields?.["items.0.refId"], JSON.stringify(unknown.json));
      const half = await call(full, "POST", `/orders/${order.id}/items`, { items: [{ ...line, refType: "article" }] }, ifMatch(order));
      assert.equal(half.status, 422);
      assert.equal(await env.db.orderItem.count({ where: { orderId: order.id } }), 0, "ein abgelehnter Körper ändert nichts");
      const ok = await call(full, "POST", `/orders/${order.id}/items`, { items: [{ ...line, refType: "article", refId: article.id }] }, ifMatch(order));
      assert.equal(ok.status, 200);
    } finally {
      await env.db.featureSetting.update({ where: { key: "workshop.parts" }, data: { enabled: false } });
    }
  });

  it("M2: bei einem Kunden mit eingeschränkter Verarbeitung ist jeder Weg 404 – auch das Anlegen einer (unveränderlichen) Freigabe – und es entsteht nichts", async () => {
    const order = await newOrder();
    const items = [{ description: "Arbeit", unit: "Std.", kind: "labor", quantityMilli: 1000, unitCents: 8500, taxBp: 1900 }];
    const saved = await call(full, "POST", `/orders/${order.id}/items`, { items }, ifMatch(order));
    assert.equal(saved.status, 200);
    const owner = (await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).customerId!;
    await env.db.customer.update({ where: { id: owner }, data: { processingRestrictedAt: new Date() } });
    const version = `"${order.version}"`;
    const stale = { "if-match": version };
    const events = await env.db.orderEvent.count();
    const audits = await env.db.auditLog.count();

    const approval = await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 24000, reason: "Kondensator", method: "phone", approverName: "Erika Muster" });
    assert.equal(approval.status, 404, JSON.stringify(approval.json));
    const typed = await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 100, reason: "x", method: "typed", approverName: "Hans" });
    assert.equal(typed.status, 404);
    assert.equal(await env.db.orderApproval.count(), 0, "keine Freigabe angelegt");

    assert.equal((await call(full, "GET", `/order-approvals?orderId=${order.id}`)).json.data.length, 0);
    assert.equal((await call(full, "PATCH", `/orders/${order.id}`, { request: "neu" }, stale)).status, 404);
    assert.equal((await call(full, "POST", `/orders/${order.id}/status`, { status: "in_progress" }, stale)).status, 404);
    assert.equal((await call(full, "POST", `/orders/${order.id}/close`, undefined, stale)).status, 404);
    assert.equal((await call(full, "POST", `/orders/${order.id}/items`, { items }, stale)).status, 404);
    assert.equal((await call(full, "POST", `/orders/${order.id}/findings`, { text: "Befund" })).status, 404);
    assert.equal((await call(full, "POST", "/orders", { vehicleId })).status, 422, "neuer Auftrag für das Fahrzeug des Kunden: gesperrt");
    assert.equal(await env.db.orderFinding.count(), 0);
    assert.equal(await env.db.orderEvent.count(), events, "kein Verlaufseintrag");
    assert.equal(await env.db.auditLog.count(), audits, "kein Audit-Eintrag");
    const row = await env.db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([row.status, row.request], ["accepted", "Ölwechsel"]);

    // Einschränkung aufgehoben: dieselbe Freigabe geht
    await env.db.customer.update({ where: { id: owner }, data: { processingRestrictedAt: null } });
    assert.equal((await call(full, "POST", "/order-approvals", { orderId: order.id, amountCents: 24000, reason: "Kondensator", method: "phone", approverName: "Erika Muster" })).status, 201);
  });

  it("M2: ein Auftrag ohne Kunde (Laufkundschaft) ist für die API normal erreichbar", async () => {
    const lone = await env.db.vehicle.create({ data: { plate: "B LO 1", plateNorm: "BLO1" } });
    const created = await call(full, "POST", "/orders", { vehicleId: lone.id });
    assert.equal(created.status, 201);
    assert.equal((await call(full, "POST", "/order-approvals", { orderId: created.json.data.id, amountCents: 100, reason: "x", method: "phone", approverName: "A" })).status, 201);
  });

  it("N4: ein Termin lässt sich über die API nur mit appointments.view verknüpfen (422, ohne etwas über den Termin zu verraten)", async () => {
    const appointment = await env.db.appointment.create({ data: { title: "HU", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId } });
    const blind = (await makeToken(env, { ownerPermissions: FULL_SCOPE, scope: FULL_SCOPE, rateLimitPerMinute: 6000 })).token;
    const refused = await call(blind, "POST", "/orders", { vehicleId, appointmentId: appointment.id });
    assert.equal(refused.status, 422);
    const unknown = await call(blind, "POST", "/orders", { vehicleId, appointmentId: "gibtsnicht" });
    assert.deepEqual(unknown.json.fields, refused.json.fields);
    assert.equal(await env.db.order.count(), 0);
  });
});
