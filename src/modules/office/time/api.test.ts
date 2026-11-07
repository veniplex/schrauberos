import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { addDaysToKey, dayKey } from "@/lib/zone";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Zeiterfassung über die API: nur eigene Zeiten (time.viewAll und time.correctAll trägt kein Token), Stempeln mit `Idempotency-Key`, Nachtragen mit Begründung; Korrigieren gibt es nicht. */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let own: string;
let other: string;
let viewAll: string;
let readOnly: string;
let otherEmployee: string;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: string, path: string, token: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, body: init.body, headers: init.headers }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json };
};

async function owner(permissions: string[], employee?: { firstName: string; lastName: string }) {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `api-${Math.random().toString(36).slice(2)}`, roles: [role] });
  const person = employee ? await env.db.employee.create({ data: { ...employee, userId: user.id } }) : null;
  const { token } = await makeToken(env, { ownerId: user.id, scope: permissions, rateLimitPerMinute: 6000 });
  return { token, employeeId: person?.id ?? "" };
}

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.time", enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  own = (await owner(["time.view", "time.stamp", "time.correct"], { firstName: "Tom", lastName: "Meyer" })).token;
  const second = await owner(["time.view", "time.stamp", "time.correct"], { firstName: "Lena", lastName: "Hoffmann" });
  other = second.token;
  otherEmployee = second.employeeId;
  viewAll = (await owner(["time.view", "time.viewAll"], { firstName: "Chef", lastName: "Brandt" })).token;
  readOnly = (await owner(["time.view"])).token;
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.db.timeCorrection.deleteMany();
  await env.db.timeEntry.deleteMany();
});

describe("Zeiterfassung: API", () => {
  it("Stempeln: start (201 mit Location und ETag), zweiter Start 409, stop; Wiederholung mit demselben Idempotency-Key liefert dieselbe Antwort", async () => {
    const first = await call("POST", "/time-entries/start", own, { body: { activity: "Bremsen" }, headers: { "idempotency-key": "k-start-1" } });
    assert.equal(first.status, 201);
    assert.match(first.headers.get("location")!, /^\/api\/v1\/time-entries\//);
    assert.ok(first.headers.get("etag"));
    assert.equal(first.json.data.running, true);
    const again = await call("POST", "/time-entries/start", own, { body: { activity: "Bremsen" }, headers: { "idempotency-key": "k-start-1" } });
    assert.equal(again.status, 201);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.equal(again.json.data.id, first.json.data.id);
    assert.equal(await env.db.timeEntry.count(), 1);

    assert.equal((await call("POST", "/time-entries/start", own, { body: {} })).status, 409, "es läuft schon einer");
    await env.db.timeEntry.updateMany({ where: { id: first.json.data.id }, data: { startedAt: new Date(Date.now() - 3_600_000) } }); // die Pause muss in die Dauer passen
    const stopped = await call("POST", "/time-entries/stop", own, { body: { breakMinutes: 5 }, headers: { "idempotency-key": "k-stop-1" } });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.data.running, false);
    assert.equal(stopped.json.data.breakMinutes, 5);
    assert.equal(stopped.json.data.id, first.json.data.id);
    assert.equal((await call("POST", "/time-entries/stop", own, { body: {} })).status, 422, "nichts läuft mehr");
  });

  it("Lesen: nur eigene Zeiten, fremde sind 404 – auch mit time.viewAll im Scope (das Recht trägt kein Token); 304 bei If-None-Match", async () => {
    const mine = await call("POST", "/time-entries/start", own, { body: {} });
    await call("POST", "/time-entries/start", other, { body: {} });
    const list = await call("GET", "/time-entries", own);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 1);
    assert.equal(list.json.data[0].id, mine.json.data.id);
    const foreign = await env.db.timeEntry.findFirstOrThrow({ where: { employeeId: otherEmployee } });
    assert.equal((await call("GET", `/time-entries/${foreign.id}`, own)).status, 404);
    assert.equal((await call("GET", `/time-entries/${foreign.id}`, viewAll)).status, 404, "time.viewAll im Scope wirkt nicht: gesperrte Rechte fallen weg");
    assert.equal((await call("GET", "/time-entries", viewAll)).json.data.length, 0, "der Chef hat selbst keinen Eintrag");
    assert.equal((await call("GET", `/time-entries?employeeId=${otherEmployee}`, own)).status, 422, "den Filter nach Mitarbeitern gibt es nicht");
    const item = await call("GET", `/time-entries/${mine.json.data.id}`, own);
    assert.equal((await call("GET", `/time-entries/${mine.json.data.id}`, own, { headers: { "if-none-match": item.headers.get("etag")! } })).status, 304);
  });

  it("Nachtragen: nur für sich selbst, mit Begründung (422 ohne); ein Feld employeeId gibt es nicht; Rechte: Lesen allein stempelt nicht", async () => {
    const day = addDaysToKey(dayKey(new Date()), -1);
    const body = { startDate: day, startTime: "08:00", endDate: day, endTime: "12:00", reason: "Stempeln vergessen" };
    const created = await call("POST", "/time-entries", own, { body });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.source, "manual");
    assert.equal(created.json.data.minutes, 240);
    assert.equal((await call("POST", "/time-entries", own, { body: { ...body, reason: "" } })).status, 422);
    assert.equal((await call("POST", "/time-entries", own, { body: { ...body, startTime: "09:00", employeeId: otherEmployee } })).status, 422, "kein Nachtrag für andere über die API");
    assert.equal((await call("POST", "/time-entries", own, { body })).status, 422, "Überschneidung");
    assert.equal((await call("POST", "/time-entries/start", readOnly, { body: {} })).status, 403);
    assert.equal((await call("GET", "/time-entries", readOnly)).json.data.length, 0, "ohne Mitarbeiterprofil gibt es nichts zu sehen");
    assert.equal((await call("PATCH", `/time-entries/${created.json.data.id}`, own, { body: { note: "x" } })).status, 405, "Korrigieren gibt es nicht über die API");
  });
});
