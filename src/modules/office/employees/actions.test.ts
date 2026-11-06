import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Mitarbeiter im Aktions-Rahmen: Rechte, Eindeutigkeit, Versionssperre, Audit – und sensible Daten (Notfallkontakt, Krankheit). */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

const login = async (permissions: string[]) => {
  const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
  await env.signIn(user);
  return user;
};
const person = { firstName: "Erika", lastName: "Muster" };
const save = (fields: Record<string, string | number | boolean | undefined> = {}) => actions.saveEmployee({}, form({ ...person, active: true, ...fields }));
const entries = (action: string) => env.db.auditLog.findMany({ where: { action } });

beforeEach(async () => {
  await env.db.employee.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
});

describe("Mitarbeiter speichern", () => {
  it("braucht employees.edit; legt an, protokolliert mit Namen, leitet zum Mitarbeiter", async () => {
    await login(["employees.view"]);
    assert.equal(await redirectOf(() => save()), "/forbidden");
    await login(["employees.edit"]);
    const target = await redirectOf(() => save({ personnelNumber: "P-1", department: "workshop" }));
    const emp = await env.db.employee.findFirstOrThrow();
    assert.equal(target, `/employees/${emp.id}`);
    assert.equal(emp.active, true);
    const [entry] = await entries("employee.create");
    assert.deepEqual([entry.target, entry.entityId], ["Erika Muster", emp.id]);
  });

  it("Personalnummer ist eindeutig, Austritt nicht vor Eintritt, Konto nur einem Mitarbeiter zugeordnet", async () => {
    await login(["employees.edit"]);
    await redirectOf(() => save({ personnelNumber: "P-1" }));
    assert.ok((await save({ firstName: "Max", personnelNumber: "P-1" })).fieldErrors?.personnelNumber);
    assert.ok((await save({ firstName: "Max", hireDate: "2024-05-01", leaveDate: "2024-04-01" })).fieldErrors?.leaveDate);
    const account = await env.user({ username: "konto" });
    await redirectOf(() => save({ firstName: "Eins", userId: account.id }));
    assert.ok((await save({ firstName: "Zwei", userId: account.id })).fieldErrors?.userId);
    assert.ok((await save({ firstName: "Drei", userId: "gibt-es-nicht" })).fieldErrors?.userId);
    assert.equal(await env.db.employee.count(), 2);
  });

  it("Ändern prüft die Version und protokolliert; Häkchen „aktiv“ fehlt = inaktiv", async () => {
    await login(["employees.edit"]);
    await redirectOf(() => save());
    const emp = await env.db.employee.findFirstOrThrow();
    const stale = versionOf(emp);
    assert.ok(await redirectOf(() => save({ id: emp.id, version: stale, active: false, jobTitle: "Meisterin" })));
    const changed = await env.db.employee.findUniqueOrThrow({ where: { id: emp.id } });
    assert.deepEqual([changed.active, changed.jobTitle], [false, "Meisterin"]);
    assert.ok((await save({ id: emp.id, version: stale, jobTitle: "Veraltet" })).error);
    assert.equal((await env.db.employee.findUniqueOrThrow({ where: { id: emp.id } })).jobTitle, "Meisterin");
    assert.equal((await entries("employee.update")).length, 1);
  });

  it("Löschen braucht employees.delete und wird protokolliert", async () => {
    await login(["employees.edit"]);
    await redirectOf(() => save());
    const emp = await env.db.employee.findFirstOrThrow();
    assert.equal(await redirectOf(() => actions.deleteEmployee(form({ id: emp.id }))), "/forbidden");
    await login(["employees.delete"]);
    assert.equal(await redirectOf(() => actions.deleteEmployee(form({ id: emp.id }))), "/employees");
    assert.equal(await env.db.employee.count(), 0);
    assert.equal((await entries("employee.delete"))[0].target, "Erika Muster");
  });
});

describe("Sensible Daten: Notfallkontakt", () => {
  const emergency = { emergencyName: "Hans Muster", emergencyPhone: "0171 1234567", emergencyRelation: "Ehemann" };

  it("ohne employees.sensitive wird der Notfallkontakt weder gespeichert noch überschrieben", async () => {
    await login(["employees.edit", "employees.sensitive"]);
    await redirectOf(() => save(emergency));
    const emp = await env.db.employee.findFirstOrThrow();
    assert.equal(emp.emergencyName, "Hans Muster");

    await login(["employees.edit"]);
    await redirectOf(() => save({ id: emp.id, version: versionOf(emp), emergencyName: "Eingeschleust", emergencyPhone: "", jobTitle: "Neu" }));
    const after = await env.db.employee.findUniqueOrThrow({ where: { id: emp.id } });
    assert.deepEqual([after.emergencyName, after.emergencyPhone, after.emergencyRelation], ["Hans Muster", "0171 1234567", "Ehemann"], "unverändert");
    assert.equal(after.jobTitle, "Neu");

    await env.db.employee.deleteMany();
    await redirectOf(() => save(emergency));
    assert.equal((await env.db.employee.findFirstOrThrow()).emergencyName, null, "ohne Recht wird beim Anlegen nichts gespeichert");
  });

  it("Änderungen am Notfallkontakt haben einen eigenen Audit-Eintrag – ohne die Werte selbst", async () => {
    await login(["employees.edit", "employees.sensitive"]);
    await redirectOf(() => save(emergency));
    const emp = await env.db.employee.findFirstOrThrow();
    assert.equal((await entries("employee.sensitiveUpdate")).length, 1, "Anlegen mit Notfallkontakt");
    await redirectOf(() => save({ id: emp.id, version: versionOf(emp), ...emergency, jobTitle: "Nur Titel" }));
    assert.equal((await entries("employee.sensitiveUpdate")).length, 1, "unveränderter Notfallkontakt: kein weiterer Eintrag");
    const fresh = await env.db.employee.findUniqueOrThrow({ where: { id: emp.id } });
    await redirectOf(() => save({ id: emp.id, version: versionOf(fresh), ...emergency, emergencyPhone: "0800 000000" }));
    assert.equal((await entries("employee.sensitiveUpdate")).length, 2);
    const dump = JSON.stringify(await env.db.auditLog.findMany());
    for (const secret of ["Hans Muster", "0171 1234567", "0800 000000", "Ehemann"]) assert.equal(dump.includes(secret), false, `${secret} darf nicht im Audit-Log stehen`);
  });
});

describe("Abwesenheiten und Qualifikationen", () => {
  let emp: { id: string };
  beforeEach(async () => {
    emp = await env.db.employee.create({ data: { ...person, active: true } });
  });
  const absence = (fields: Record<string, string> = {}) => actions.saveAbsence({}, form({ employeeId: emp.id, type: "vacation", startDate: "2030-07-01", endDate: "2030-07-05", ...fields }));

  it("Urlaub eintragen: Zeitraum wird geprüft, Rücksprungziel gesichert, Audit ohne Art und Zeitraum", async () => {
    await login(["employees.edit"]);
    assert.ok((await absence({ endDate: "2030-06-30" })).fieldErrors?.endDate);
    assert.equal(await redirectOf(() => absence()), "/employees/absences?month=2030-07");
    assert.equal(await redirectOf(() => absence({ returnTo: "https://evil.example" })), "/employees/absences?month=2030-07");
    assert.equal(await env.db.absence.count(), 2);
    const [entry] = await entries("employee.absenceCreate");
    assert.equal(entry.target, "Erika Muster");
    assert.equal(JSON.stringify(entry).includes("vacation"), false);
    assert.equal((await absence({ employeeId: "gibt-es-nicht" })).fieldErrors?.employeeId !== undefined, true);
  });

  it("Krankheit nur mit employees.sensitive eintragen und löschen – ohne Recht bleibt der Eintrag bestehen", async () => {
    await login(["employees.edit"]);
    assert.ok((await absence({ type: "sick" })).fieldErrors?.type);
    assert.equal(await env.db.absence.count(), 0);

    await login(["employees.edit", "employees.sensitive"]);
    await redirectOf(() => absence({ type: "sick" }));
    const sick = await env.db.absence.findFirstOrThrow();
    assert.equal(sick.type, "sick");
    assert.equal(JSON.stringify(await env.db.auditLog.findMany()).includes("sick"), false, "die Art „Krankheit“ steht nicht im Audit-Log");

    await login(["employees.edit"]);
    await redirectOf(() => actions.deleteAbsence(form({ id: sick.id })));
    assert.equal(await env.db.absence.count(), 1, "Krankheitseintrag ohne Recht nicht löschbar");

    await login(["employees.edit", "employees.sensitive"]);
    assert.equal(await redirectOf(() => actions.deleteAbsence(form({ id: sick.id, returnTo: "/employees/absences?month=2030-07" }))), "/employees/absences?month=2030-07");
    assert.equal(await env.db.absence.count(), 0);
    assert.equal((await entries("employee.absenceDelete")).length, 1);
  });

  it("Qualifikation: Zeitraum wird geprüft, Eintragen und Löschen werden protokolliert", async () => {
    await login(["employees.edit"]);
    const bad = await actions.saveQualification({}, form({ employeeId: emp.id, name: "Staplerschein", issuedAt: "2024-01-01", expiresAt: "2023-01-01" }));
    assert.ok(bad.fieldErrors?.expiresAt);
    const ok = await actions.saveQualification({}, form({ employeeId: emp.id, name: "Staplerschein", issuedAt: "2024-01-01", expiresAt: "2029-01-01" }));
    assert.equal(ok.ok, true);
    const q = await env.db.qualification.findFirstOrThrow();
    await actions.deleteQualification(form({ id: q.id }));
    assert.equal(await env.db.qualification.count(), 0);
    assert.deepEqual([(await entries("employee.qualificationCreate")).length, (await entries("employee.qualificationDelete")).length], [1, 1]);
    assert.equal((await entries("employee.qualificationCreate"))[0].target, "Erika Muster: Staplerschein");
  });

  it("alles verlangt employees.edit", async () => {
    const q = await env.db.qualification.create({ data: { employeeId: emp.id, name: "X" } });
    await login(["employees.view"]);
    assert.equal(await redirectOf(() => absence()), "/forbidden");
    assert.equal(await redirectOf(() => actions.saveQualification({}, form({ employeeId: emp.id, name: "Y" }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.deleteQualification(form({ id: q.id }))), "/forbidden");
    assert.equal(await env.db.qualification.count(), 1);
  });
});
