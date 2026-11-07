import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Hinweise beim Eintragen einer Abwesenheit (P2b-2): nur mit employees.edit, Krankheit bleibt ohne employees.sensitive maskiert. */
let env: TestEnv;
let route: typeof import("./absence-hints/route");

before(async () => {
  env = await createTestEnv();
  route = await import("./absence-hints/route");
});
after(() => env.cleanup());

let employeeId = "";
beforeEach(async () => {
  await env.db.absence.deleteMany();
  await env.db.employee.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  env.signOut();
  const employee = await env.db.employee.create({ data: { firstName: "Erika", lastName: "Muster" } });
  employeeId = employee.id;
  const other = await env.db.employee.create({ data: { firstName: "Max", lastName: "Andere" } });
  const noon = (day: string) => new Date(`${day}T12:00:00Z`);
  await env.db.absence.createMany({
    data: [
      { employeeId, type: "vacation", startDate: noon("2030-07-08"), endDate: noon("2030-07-12"), note: "Sommer" },
      { employeeId, type: "sick", startDate: noon("2030-07-10"), endDate: noon("2030-07-11"), note: "Grippe" },
      { employeeId: other.id, type: "training", startDate: noon("2030-07-08"), endDate: noon("2030-07-12") },
    ],
  });
});

const as = async (permissions: string[]) => env.signIn(await env.user({ username: `u${Math.random()}`, roles: [await env.role({ permissions })] }));
const get = async (params: Record<string, string>) => {
  const response = await route.GET({ nextUrl: new URL(`http://localhost/x?${new URLSearchParams(params)}`) } as never);
  return { status: response.status, body: (await response.json()) as { duplicate?: boolean; overlaps?: Array<{ start: string; end: string; type: string }> } };
};
const query = (extra: Record<string, string> = {}) => ({ employeeId, type: "vacation", start: "2030-07-09", end: "2030-07-15", ...extra });

describe("GET /api/employees/absence-hints", () => {
  it("ohne Sitzung 401, ohne employees.edit 403, ungültige Eingabe 400", async () => {
    assert.equal((await get(query())).status, 401);
    await as(["employees.view"]);
    assert.equal((await get(query())).status, 403);
    await as(["employees.edit"]);
    assert.equal((await get(query({ start: "2030-07-20" }))).status, 400, "Ende vor Beginn");
    assert.equal((await get(query({ type: "nonsense" }))).status, 400);
    assert.equal((await get(query({ start: "2030-02-31" }))).status, 400);
  });

  it("nennt nur die Abwesenheiten derselben Person; ohne employees.sensitive ist Krankheit maskiert (kein „sick“, keine Notiz)", async () => {
    await as(["employees.edit"]);
    const { status, body } = await get(query());
    assert.equal(status, 200);
    assert.deepEqual(body.overlaps?.map((o) => [o.start, o.end, o.type]), [["2030-07-08", "2030-07-12", "vacation"], ["2030-07-10", "2030-07-11", "masked"]]);
    assert.equal(body.duplicate, false);
    const text = JSON.stringify(body);
    assert.equal(text.includes("sick"), false);
    assert.equal(text.includes("Grippe"), false);
    assert.equal(text.includes("Sommer"), false);
  });

  it("mit employees.sensitive steht die Art der Krankheit da; eine exakte Dublette wird gemeldet", async () => {
    await as(["employees.edit", "employees.sensitive"]);
    const { body } = await get(query());
    assert.deepEqual(body.overlaps?.map((o) => o.type), ["vacation", "sick"]);
    assert.equal((await get(query({ start: "2030-07-08", end: "2030-07-12" }))).body.duplicate, true);
  });

  it("ohne employees.sensitive wird die Krankheit nicht abgefragt (nichts, was sie verriete)", async () => {
    await as(["employees.edit"]);
    assert.deepEqual((await get(query({ type: "sick", start: "2030-07-10", end: "2030-07-11" }))).body, { duplicate: false, overlaps: [] });
  });
});
