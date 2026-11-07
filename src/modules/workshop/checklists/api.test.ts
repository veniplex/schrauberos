import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Checklisten über die API: Vorlagen lesen, beginnen, Punkte mit eigener Version (If-Match), abschließen mit getipptem Namen, Rechte und Art. 18. */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let full: string;
let readOnly: string;
let vehiclesOnly: string;
let vehicleId: string;
let orderId: string;
let restrictedOrderId: string;
let templateId: string;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function owner(permissions: string[]) {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `api-${Math.random().toString(36).slice(2)}`, name: "API Person", roles: [role] });
  return (await makeToken(env, { ownerId: user.id, scope: permissions, rateLimitPerMinute: 6000 })).token;
}
const call = async (method: string, path: string, token: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, body: init.body, headers: init.headers }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json };
};

before(async () => {
  env = await createTestEnv();
  for (const key of ["workshop.checklists", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  const ops = await import("./operations");
  full = await owner(["checklists.view", "checklists.fill", "checklists.manage", "vehicles.view", "orders.view"]);
  readOnly = await owner(["checklists.view", "vehicles.view", "orders.view"]);
  vehiclesOnly = await owner(["checklists.view", "checklists.fill", "vehicles.view"]);
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 12", plateNorm: "BAB12" } })).id;
  orderId = (await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId } })).id;
  const customer = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const restrictedVehicle = await env.db.vehicle.create({ data: { plate: "B XY 9", plateNorm: "BXY9", customerId: customer.id } });
  restrictedOrderId = (await env.db.order.create({ data: { number: "A-2026-0002", status: "in_progress", vehicleId: restrictedVehicle.id, customerId: customer.id } })).id;
  const lead = await env.user({ username: "lead", name: "Leitung", roles: [await env.role({ isAdmin: true })] });
  await env.signIn(lead);
  const { getSession } = await import("@/server/auth/session");
  const session = (await getSession())!;
  env.signOut();
  templateId = (
    await ops.saveTemplateOperation.execute(session, {
      name: "Reifenwechsel",
      signatureMode: "optional",
      items: JSON.stringify([
        { label: "Sichtprüfung", type: "check", required: true },
        { label: "Drehmoment", type: "torque", unit: "Nm", minValue: 100, maxValue: 140, required: true },
        { label: "Zustand", type: "choice", options: "gut\nschlecht", required: false },
      ]),
    })
  ).ok
    ? (await env.db.checklistTemplate.findFirstOrThrow()).id
    : "";
});
after(() => env.cleanup());

describe("Checklisten: API", () => {
  it("Vorlagen lesen (aktive, mit den Punkten der aktuellen Version); Einzelabruf", async () => {
    const list = await call("GET", "/checklist-templates", readOnly);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 1);
    assert.deepEqual([list.json.data[0].name, list.json.data[0].version, list.json.data[0].signatureMode], ["Reifenwechsel", 1, "optional"]);
    assert.deepEqual(list.json.data[0].items.map((i: Json) => i.type), ["check", "torque", "choice"]);
    assert.deepEqual(list.json.data[0].items[2].options, ["gut", "schlecht"]);
    assert.equal((await call("GET", `/checklist-templates/${templateId}`, readOnly)).status, 200);
    assert.equal((await call("GET", "/checklist-templates/gibt-es-nicht", readOnly)).status, 404);
  });

  it("beginnen (201 mit Location und ETag), Punkte speichern mit der Version des Punkts in If-Match, abschließen mit getipptem Namen", async () => {
    const created = await call("POST", "/checklists", full, { body: { templateId, orderId } });
    assert.equal(created.status, 201);
    assert.match(created.headers.get("location") ?? "", /^\/api\/v1\/checklists\//);
    const id = created.json.data.id as string;
    assert.equal(created.json.data.itemsTotal, 3);
    const items = created.json.data.items as Json[];
    const tick = items.find((i) => i.label === "Sichtprüfung")!;

    assert.equal((await call("PATCH", `/checklist-items/${tick.id}`, full, { body: { done: true } })).status, 428);
    const ticked = await call("PATCH", `/checklist-items/${tick.id}`, full, { body: { done: true }, headers: { "if-match": `"${tick.version}"` } });
    assert.equal(ticked.status, 200);
    assert.equal(ticked.json.data.done, true);
    assert.equal((await call("PATCH", `/checklist-items/${tick.id}`, full, { body: { done: false }, headers: { "if-match": `"${tick.version}"` } })).status, 412, "veraltete Version des Punkts");

    const torque = items.find((i) => i.label === "Drehmoment")!;
    const out = await call("PATCH", `/checklist-items/${torque.id}`, full, { body: { numberValue: 150 }, headers: { "if-match": `"${torque.version}"` } });
    assert.equal(out.status, 200);
    assert.deepEqual([out.json.data.numberValue, out.json.data.outOfRange], [150, true]);

    const before = await call("GET", `/checklists/${id}`, full);
    assert.equal(before.json.data.requiredOpen, 0);
    const done = await call("POST", `/checklists/${id}/complete`, full, { body: { customerName: "Erika Muster", signedName: "erika muster" }, headers: { "if-match": before.headers.get("etag")! } });
    assert.equal(done.status, 200);
    assert.deepEqual([done.json.data.status, done.json.data.signed], ["completed", true]);
    // unveränderlich
    assert.equal((await call("PATCH", `/checklist-items/${tick.id}`, full, { body: { done: false }, headers: { "if-match": `"${ticked.json.data.version}"` } })).status, 422);
    assert.equal((await call("POST", `/checklists/${id}/complete`, full, { body: {}, headers: { "if-match": done.headers.get("etag")! } })).status, 422);
  });

  it("abschließen mit offenen Pflichtpunkten 422; falscher Name der Unterschrift 422; Rechte: ohne checklists.fill 403, ohne orders.view 404/403", async () => {
    const created = await call("POST", "/checklists", full, { body: { templateId, vehicleId } });
    const id = created.json.data.id as string;
    assert.equal((await call("POST", `/checklists/${id}/complete`, full, { body: {}, headers: { "if-match": created.headers.get("etag")! } })).status, 422);
    assert.equal((await call("POST", "/checklists", readOnly, { body: { templateId, vehicleId } })).status, 403);
    assert.equal((await call("POST", "/checklists", vehiclesOnly, { body: { templateId, orderId } })).status, 403);
    assert.equal((await call("POST", "/checklists", full, { body: { templateId, orderId: restrictedOrderId } })).status, 404);
    assert.equal((await call("POST", "/checklists", full, { body: { templateId } })).status, 422);
  });

  it("Lesen: nur sichtbare Checklisten; Art. 18 und fehlendes Recht auf den Auftrag sind 404; Filter", async () => {
    const mine = await call("POST", "/checklists", full, { body: { templateId, orderId } });
    const onVehicle = await call("POST", "/checklists", full, { body: { templateId, vehicleId } });
    const hidden = await env.db.checklist.create({ data: { templateId, versionId: (await env.db.checklistTemplateVersion.findFirstOrThrow({ where: { templateId } })).id, templateName: "Reifenwechsel", templateVersion: 1, vehicleId, orderId: restrictedOrderId, createdByName: "X" } });
    assert.equal((await call("GET", `/checklists/${hidden.id}`, full)).status, 404);
    const all = await call("GET", "/checklists", full);
    assert.ok(all.json.data.every((c: Json) => c.id !== hidden.id));
    assert.ok(all.json.data.some((c: Json) => c.id === mine.json.data.id));
    const fahrzeug = await call("GET", "/checklists", vehiclesOnly);
    assert.deepEqual(fahrzeug.json.data.map((c: Json) => c.id).filter((id: string) => id === mine.json.data.id), [], "ohne orders.view keine Checkliste am Auftrag");
    assert.ok(fahrzeug.json.data.some((c: Json) => c.id === onVehicle.json.data.id));
    assert.equal((await call("GET", `/checklists/${mine.json.data.id}`, vehiclesOnly)).status, 404);
    assert.ok((await call("GET", `/checklists?orderId=${orderId}`, full)).json.data.every((c: Json) => c.orderId === orderId));
    const etag = (await call("GET", `/checklists/${mine.json.data.id}`, full)).headers.get("etag")!;
    assert.equal((await call("GET", `/checklists/${mine.json.data.id}`, full, { headers: { "if-none-match": etag } })).status, 304);
  });
});
