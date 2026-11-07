import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { grantablePermissions } from "@/lib/api/scope";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** API der Mitarbeiter (P4b-4): Arbeitstage-Muster, Resturlaub von Hand, Abwesenheit/Qualifikation ändern (If-Match) – weiterhin ohne Krankheit und ohne Notfallkontakt. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("@/server/api/router");
let token: string;

before(async () => {
  env = await createTestEnv();
  router = await import("@/server/api/router");
  (await import("@/server/api/state")).apiLimits.failuresGlobal = 1_000_000;
});
after(() => env.cleanup());

beforeEach(async () => {
  for (const table of ["apiToken", "auditLog", "absence", "qualification", "employee"] as const) await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  token = (await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 })).token;
});

const api = async (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, ...init }));
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
};
const ifMatch = (item: Json) => ({ "if-match": `"${item.version}"` });

describe("Mitarbeiter über die API (P4b-4)", () => {
  it("Arbeitstage-Muster: Standard Montag bis Freitag, änderbar; ungültig wird abgelehnt; kein Notfallkontakt in der Antwort", async () => {
    const created = await api("POST", "/employees", { body: { firstName: "Erika", lastName: "Muster", vacationDaysPerYear: 18, workWeekdays: [3, 1, 2] } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.json.data.workWeekdays, [1, 2, 3]);
    assert.equal("emergencyName" in created.json.data, false);
    const plain = await api("POST", "/employees", { body: { firstName: "Max", lastName: "Mustermann" } });
    assert.deepEqual(plain.json.data.workWeekdays, [1, 2, 3, 4, 5]);
    assert.equal((await api("POST", "/employees", { body: { firstName: "A", lastName: "B", workWeekdays: [] } })).status, 422);
    assert.equal((await api("POST", "/employees", { body: { firstName: "A", lastName: "B", workWeekdays: [8] } })).status, 422);
    const patched = await api("PATCH", `/employees/${created.json.data.id}`, { body: { workWeekdays: [0, 6], vacationCarryYear: 2026, vacationCarryDays: 2.5 }, headers: ifMatch(created.json.data) });
    assert.deepEqual([patched.status, patched.json.data.workWeekdays, patched.json.data.vacationCarryDays], [200, [0, 6], 2.5]);
    assert.equal((await api("PATCH", `/employees/${created.json.data.id}`, { body: { vacationCarryYear: 2027 }, headers: ifMatch(patched.json.data) })).json.data?.vacationCarryDays, 2.5, "die Angaben bleiben gemeinsam gültig");
  });

  it("Abwesenheit und Qualifikation ändern: If-Match Pflicht, veraltete Version 412, die Person bleibt, Krankheit gibt es nicht", async () => {
    const emp = (await api("POST", "/employees", { body: { firstName: "Erika", lastName: "Muster" } })).json.data;
    const absence = await api("POST", "/employee-absences", { body: { employeeId: emp.id, type: "vacation", startDate: "2030-07-01", endDate: "2030-07-05" } });
    assert.equal(absence.status, 201);
    assert.equal((await api("PATCH", `/employee-absences/${absence.json.data.id}`, { body: { endDate: "2030-07-08" } })).status, 428);
    const patched = await api("PATCH", `/employee-absences/${absence.json.data.id}`, { body: { endDate: "2030-07-08", note: "verlängert" }, headers: ifMatch(absence.json.data) });
    assert.deepEqual([patched.status, patched.json.data.endDate, patched.json.data.note, patched.json.data.employeeId], [200, "2030-07-08", "verlängert", emp.id]);
    assert.equal((await api("PATCH", `/employee-absences/${absence.json.data.id}`, { body: { note: "alt" }, headers: ifMatch(absence.json.data) })).status, 412);
    assert.equal((await api("PATCH", `/employee-absences/${absence.json.data.id}`, { body: { type: "sick" }, headers: ifMatch(patched.json.data) })).status, 422);
    assert.equal((await api("PATCH", `/employee-absences/${absence.json.data.id}`, { body: { employeeId: "x" }, headers: ifMatch(patched.json.data) })).status, 422, "die Person lässt sich nicht wechseln");

    const q = await api("POST", "/employee-qualifications", { body: { employeeId: emp.id, name: "Staplerschein" } });
    const changed = await api("PATCH", `/employee-qualifications/${q.json.data.id}`, { body: { expiresAt: "2031-01-01" }, headers: ifMatch(q.json.data) });
    assert.deepEqual([changed.status, changed.json.data.expiresAt, changed.json.data.name], [200, "2031-01-01", "Staplerschein"]);
  });
});
