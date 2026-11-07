import assert from "node:assert/strict";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@/generated/prisma/client";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Datenzugriff „Mitarbeiter“ (P1c-2): Ohne `employees.sensitive` werden Notfallkontakt und Krankheit (Art, Anmerkung) gar nicht aus der Datenbank gelesen – geprüft am
 * protokollierten SQL, nicht an der Antwort. Mit dem Recht sind die Daten da.
 */
let env: TestEnv;
let logged: PrismaClient;
let sql: string[] = [];
let q: typeof import("./queries");

/** Auswahlliste eines SELECT (zwischen SELECT und dem ersten FROM). */
const selectList = (statement: string) => /^\s*SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(statement)?.[1] ?? "";
const isSelect = (statement: string) => /^\s*SELECT/i.test(statement);
const names = (list: string, column: string) => new RegExp(`[\`"]${column}[\`"]`).test(list);
/** Alle mitgeschriebenen Abfragen, die `column` in ihrer Auswahlliste lesen. */
const reading = (column: string) => sql.filter((s) => isSelect(s) && names(selectList(s), column));

type Viewer = Parameters<typeof q.listEmployees>[0];
const viewer = (...permissions: string[]): Viewer => ({ can: (p: string) => permissions.includes(p) }) as Viewer;
const NONE = viewer("employees.view");
const SENSITIVE = viewer("employees.view", "employees.sensitive");
const EMERGENCY = ["emergencyName", "emergencyPhone", "emergencyRelation"];

before(async () => {
  env = await createTestEnv();
  // Zweiter Client auf dieselbe Datei, der jede Anweisung mitschreibt; die Anwendung (`@/server/db`) benutzt ihn
  logged = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${env.dir}/test.db` }), log: [{ emit: "event", level: "query" }] });
  (logged as unknown as { $on(name: "query", cb: (event: { query: string }) => void): void }).$on("query", (event) => sql.push(event.query));
  (globalThis as unknown as { __db?: PrismaClient }).__db = logged;
  q = await import("./queries");
});
after(async () => {
  await logged.$disconnect();
  await env.cleanup();
});
beforeEach(async () => {
  await env.db.absence.deleteMany();
  await env.db.qualification.deleteMany();
  await env.db.employee.deleteMany();
  sql = [];
});

async function seed() {
  const e = await env.db.employee.create({
    data: { firstName: "Erika", lastName: "Muster", emergencyName: "Max Muster", emergencyPhone: "0170 1", emergencyRelation: "Ehemann", jobTitle: "Meisterin" },
  });
  const day = (d: string) => new Date(`${d}T12:00:00.000Z`);
  await env.db.absence.create({ data: { employeeId: e.id, type: "vacation", startDate: day("2030-05-02"), endDate: day("2030-05-03"), note: "Urlaub am See" } });
  await env.db.absence.create({ data: { employeeId: e.id, type: "sick", startDate: day("2030-05-06"), endDate: day("2030-05-07"), note: "Grippe" } });
  await env.db.qualification.create({ data: { employeeId: e.id, name: "Ersthelfer", expiresAt: day("2030-06-01"), note: "intern" } });
  sql = [];
  return e;
}

describe("Mitarbeiter: Datenzugriff ohne employees.sensitive", () => {
  it("Liste, Detail und Bearbeiten lesen den Notfallkontakt nicht aus der Datenbank", async () => {
    const e = await seed();
    const list = await q.listEmployees(NONE, { where: {}, orderBy: [{ lastName: "asc" }] });
    const detail = await q.getEmployeeDetail(NONE, e.id);
    const edit = await q.getEmployeeForEdit(NONE, e.id);
    assert.ok(sql.some((s) => /Employee/.test(s)), "es wurde überhaupt gelesen");
    for (const column of EMERGENCY) assert.deepEqual(reading(column), [], `${column} wurde gelesen`);
    assert.equal(list.length, 1);
    assert.equal(detail?.emergency, null);
    assert.equal(edit?.emergency, null);
    assert.ok(!("emergencyName" in list[0]), "kein sensibles Feld im Ergebnis");
  });

  it("Krankheit: Art und Anmerkung dieser Zeilen verlassen die Datenbank nicht; der Zeitraum kommt als „masked“", async () => {
    const e = await seed();
    const detail = await q.getEmployeeDetail(NONE, e.id);
    const around = await q.absencesOverlapping(NONE, new Date("2030-05-01T00:00:00Z"), new Date("2030-05-31T00:00:00Z"));
    const all = [...(detail?.absences ?? []), ...around];
    assert.ok(all.some((a) => a.type === "masked") && all.some((a) => a.type === "vacation") && !all.some((a) => a.type === "sick"));
    for (const a of all) {
      assert.ok(!JSON.stringify(a).includes("Grippe"), "Anmerkung der Krankheit im Ergebnis");
      if (a.type === "masked") assert.equal(a.note, null);
    }
    // Eine Abfrage, die Art oder Anmerkung auswählt, schließt die Krankheit aus („type <> ?“); die Abfrage der Krankheitszeilen wählt weder Art noch Anmerkung
    const absenceSelects = sql.filter((s) => isSelect(s) && /FROM\s+\S*Absence/i.test(s));
    assert.ok(absenceSelects.length >= 2, "offene und verdeckte Abfrage");
    for (const s of absenceSelects) {
      const list = selectList(s);
      if (names(list, "type") || names(list, "note")) assert.match(s.split(/\bWHERE\b/i)[1] ?? "", /<>|NOT/i, `Art/Anmerkung ohne Ausschluss der Krankheit: ${s}`);
    }
  });

  it("Widget-Abfragen: ebenso; Qualifikationen ohne Anmerkung und ohne ganze Mitarbeiterzeile", async () => {
    await seed();
    const absent = await q.absencesAround(NONE, new Date("2030-05-06T00:00:00Z"), new Date("2030-05-07T00:00:00Z"));
    assert.deepEqual(absent.map((a) => a.type), ["masked"]);
    const quals = await q.expiringQualifications(NONE, new Date("2031-01-01T00:00:00Z"), 6);
    assert.equal(quals.length, 1);
    assert.ok(!("note" in quals[0]));
    for (const column of EMERGENCY) assert.deepEqual(reading(column), [], `${column} wurde gelesen`);
  });

  it("Auswahllisten, Suche und Konto-Zuordnung lesen nur Namen/Stammdaten", async () => {
    await seed();
    await q.activeEmployees();
    await q.staffWithAccount();
    await q.searchEmployees(NONE, "Mus", 5);
    await q.linkableAccounts(viewer("employees.edit"));
    assert.ok(sql.length >= 4);
    for (const column of EMERGENCY) assert.deepEqual(reading(column), [], `${column} wurde gelesen`);
  });

  it("ohne employees.view wirft die Abfrage (zweite Linie)", async () => {
    await assert.rejects(() => q.listEmployees(viewer(), { where: {}, orderBy: [{ lastName: "asc" }] }));
    await assert.rejects(() => q.absencesOverlapping(viewer(), new Date(), new Date()));
  });
});

describe("Mitarbeiter: Datenzugriff mit employees.sensitive", () => {
  it("Notfallkontakt und Krankheit sind da", async () => {
    const e = await seed();
    const edit = await q.getEmployeeForEdit(SENSITIVE, e.id);
    assert.deepEqual(edit?.emergency, { name: "Max Muster", phone: "0170 1", relation: "Ehemann" });
    const detail = await q.getEmployeeDetail(SENSITIVE, e.id);
    assert.deepEqual(detail?.absences.map((a) => a.type).sort(), ["sick", "vacation"]);
    assert.equal(detail?.absences.find((a) => a.type === "sick")?.note, "Grippe");
    assert.equal(detail?.emergency?.relation, "Ehemann");
  });

  it("die Reihenfolge der Abwesenheiten bleibt bei der Zusammenführung erhalten (neueste zuerst)", async () => {
    const e = await seed();
    const detail = await q.getEmployeeDetail(NONE, e.id);
    assert.deepEqual(detail?.absences.map((a) => a.type), ["masked", "vacation"]);
  });
});
