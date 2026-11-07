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
const save = (fields: Record<string, string | number | boolean | ReadonlyArray<number> | undefined> = {}) => actions.saveEmployee({}, form({ ...person, active: true, workWeekdays: [1, 2, 3, 4, 5], ...fields }));
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

  it("Exakte Dublette (gleiche Art, gleicher Zeitraum) wird abgelehnt; Überschneidung anderer Art oder Dauer nicht (nur Hinweis im Formular)", async () => {
    await login(["employees.edit"]);
    await redirectOf(() => absence());
    assert.ok((await absence()).fieldErrors?.startDate, "dieselbe Art, derselbe Zeitraum");
    await redirectOf(() => absence({ type: "training" }));
    await redirectOf(() => absence({ endDate: "2030-07-03" }));
    assert.equal(await env.db.absence.count(), 3);
  });

  it("Urlaub eintragen: Zeitraum wird geprüft, Rücksprungziel gesichert, Audit ohne Art und Zeitraum", async () => {
    await login(["employees.edit"]);
    assert.ok((await absence({ endDate: "2030-06-30" })).fieldErrors?.endDate);
    assert.equal(await redirectOf(() => absence()), "/employees/absences?month=2030-07");
    assert.equal(await redirectOf(() => absence({ returnTo: "https://evil.example", endDate: "2030-07-06" })), "/employees/absences?month=2030-07");
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

describe("Teilzeit und Resturlaub (P4b-4)", () => {
  it("Arbeitstage-Muster wird gespeichert, sortiert und ist Pflicht (mindestens ein Tag); Standard Montag bis Freitag in der Datenbank", async () => {
    await login(["employees.edit"]);
    assert.equal(await redirectOf(() => save({ workWeekdays: [3, 1, 2, 2] })), `/employees/${(await env.db.employee.findFirstOrThrow()).id}`);
    assert.equal((await env.db.employee.findFirstOrThrow()).workWeekdays, "1,2,3");
    assert.ok((await save({ firstName: "Leer", workWeekdays: [] })).fieldErrors?.workWeekdays);
    assert.ok((await save({ firstName: "Falsch", workWeekdays: [7] })).fieldErrors?.workWeekdays);
    assert.equal(await env.db.employee.count(), 1);
    const plain = await env.db.employee.create({ data: { firstName: "Nur", lastName: "Name" } });
    assert.equal(plain.workWeekdays, "1,2,3,4,5");
  });

  it("von Hand erfasster Resturlaub: Jahr und Tage zusammen, in halben Tagen (auch mit Komma)", async () => {
    await login(["employees.edit"]);
    assert.ok((await save({ vacationCarryYear: 2026 })).fieldErrors?.vacationCarryDays);
    assert.ok((await save({ vacationCarryDays: "5" })).fieldErrors?.vacationCarryYear);
    assert.ok((await save({ vacationCarryYear: 2026, vacationCarryDays: "5,3" })).fieldErrors?.vacationCarryDays);
    assert.ok((await save({ vacationCarryYear: 2026, vacationCarryDays: "-1" })).fieldErrors?.vacationCarryDays);
    await redirectOf(() => save({ vacationCarryYear: 2026, vacationCarryDays: "5,5" }));
    const emp = await env.db.employee.findFirstOrThrow();
    assert.deepEqual([emp.vacationCarryYear, emp.vacationCarryDays], [2026, 5.5]);
  });

  it("Einstellung Verfall-Stichtag: braucht settings.manage, prüft den Tag des Monats, Audit", async () => {
    await login(["employees.edit"]);
    assert.equal(await redirectOf(() => actions.saveEmployeeSettings({}, form({ vacationCarryMonth: 5, vacationCarryDay: 31 }))), "/forbidden");
    await login(["settings.manage"]);
    assert.ok((await actions.saveEmployeeSettings({}, form({ vacationCarryMonth: 2, vacationCarryDay: 30 }))).fieldErrors?.vacationCarryDay);
    assert.ok((await actions.saveEmployeeSettings({}, form({ vacationCarryMonth: 4, vacationCarryDay: 31 }))).fieldErrors?.vacationCarryDay);
    assert.equal((await actions.saveEmployeeSettings({}, form({ vacationCarryMonth: 5, vacationCarryDay: 31 }))).ok, true);
    const row = await env.db.employeeSettings.findUniqueOrThrow({ where: { id: "default" } });
    assert.deepEqual([row.vacationCarryMonth, row.vacationCarryDay], [5, 31]);
    assert.equal((await entries("settings.employees")).length, 1);
  });

  it("Urlaubsstand aus der Datenbank: Teilzeit-Muster, Feiertag, Übertrag ab Anlage und von Hand, Stichtag aus den Einstellungen", async () => {
    await login(["employees.view"]);
    const queries = await import("./queries");
    const settings = await import("./settings");
    const nrw = await env.db.holidaySettings.upsert({ where: { id: "default" }, update: { region: "DE-NW" }, create: { id: "default", region: "DE-NW" } });
    void nrw;
    const emp = await env.db.employee.create({
      data: { ...person, active: true, vacationDaysPerYear: 18, workWeekdays: "1,2,3", hireDate: new Date("2020-01-01T12:00:00Z"), vacationCarryYear: 2026, vacationCarryDays: 4 },
    });
    const noon = (day: string) => new Date(`${day}T12:00:00Z`);
    // Montag 2026-06-01 bis Freitag 2026-06-12: Mo–Mi, zwei Wochen = 6 Tage; Fronleichnam (Do) ist kein Arbeitstag der Person; Februar: 2 Tage (Übertrag)
    await env.db.absence.createMany({
      data: [
        { employeeId: emp.id, type: "vacation", startDate: noon("2026-06-01"), endDate: noon("2026-06-12") },
        { employeeId: emp.id, type: "vacation", startDate: noon("2026-02-09"), endDate: noon("2026-02-10") },
        { employeeId: emp.id, type: "sick", startDate: noon("2026-04-06"), endDate: noon("2026-04-10") },
      ],
    });
    const balance = await queries.getVacationBalance(await currentViewer(), emp.id, 2026);
    assert.ok(balance);
    assert.equal(balance.used, 8, "Krankheit zählt nicht; Teilzeit Mo–Mi");
    assert.deepEqual([balance.carryIn, balance.carryUsed, balance.carryExpired], [4, 2, 2], "Übertrag bis 31.3. 2 genommen, der Rest verfällt");
    assert.equal(balance.entitlement?.days, 18);
    // anderer Stichtag
    await settings.getEmployeeRules();
    await env.db.employeeSettings.update({ where: { id: "default" }, data: { vacationCarryMonth: 6, vacationCarryDay: 30 } });
    const later = await queries.getVacationBalance(await currentViewer(), emp.id, 2026);
    assert.deepEqual([later?.carryUsed, later?.carryExpired], [4, 0], "bis 30.6. ist der Übertrag aufgebraucht (8 Tage genommen)");
  });
});

describe("Abwesenheit und Qualifikation bearbeiten (P4b-4)", () => {
  let emp: { id: string };
  beforeEach(async () => {
    emp = await env.db.employee.create({ data: { ...person, active: true } });
  });
  const absenceSave = (fields: Record<string, string>) => actions.saveAbsence({}, form({ employeeId: emp.id, type: "vacation", startDate: "2030-07-01", endDate: "2030-07-05", ...fields }));

  it("Abwesenheit ändern: Version wird geprüft, Dublette ausgenommen die Zeile selbst, Person bleibt dieselbe, Audit absenceUpdate ohne Art und Zeitraum", async () => {
    await login(["employees.edit"]);
    await redirectOf(() => absenceSave({}));
    const row = await env.db.absence.findFirstOrThrow();
    const other = await env.db.employee.create({ data: { firstName: "Max", lastName: "Andere", active: true } });
    assert.ok(await redirectOf(() => absenceSave({ id: row.id, version: versionOf(row), endDate: "2030-07-08", note: "verlängert" })));
    const changed = await env.db.absence.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([changed.endDate.toISOString().slice(0, 10), changed.note], ["2030-07-08", "verlängert"]);
    assert.ok((await absenceSave({ id: row.id, version: versionOf(row), note: "alt" })).error, "veraltete Version");
    assert.ok((await absenceSave({ id: row.id, version: versionOf(changed), employeeId: other.id })).fieldErrors?.employeeId, "die Person lässt sich nicht wechseln");
    // keine Dublette durch Ändern: die Zeile verträgt sich mit sich selbst, aber nicht mit einer zweiten gleichen
    await redirectOf(() => absenceSave({ startDate: "2030-08-01", endDate: "2030-08-02" }));
    const second = await env.db.absence.findFirstOrThrow({ where: { startDate: new Date("2030-08-01T12:00:00") } });
    assert.ok((await absenceSave({ id: second.id, version: versionOf(second), startDate: "2030-07-01", endDate: "2030-07-08" })).fieldErrors?.startDate);
    assert.equal(await redirectOf(() => absenceSave({ id: second.id, version: versionOf(second), startDate: "2030-08-01", endDate: "2030-08-03" })), "/employees/absences?month=2030-08");
    const [entry] = await entries("employee.absenceUpdate");
    assert.equal(entry.target, "Erika Muster");
    assert.equal(JSON.stringify(await env.db.auditLog.findMany()).includes("vacation"), false);
    assert.ok((await absenceSave({ id: "gibt-es-nicht", version: "1" })).error, "unbekannte Abwesenheit");
  });

  it("Krankheit bearbeiten: nur mit employees.sensitive – weder bearbeiten noch zu Krankheit machen ohne das Recht", async () => {
    const sick = await env.db.absence.create({ data: { employeeId: emp.id, type: "sick", startDate: new Date("2030-07-01T12:00:00Z"), endDate: new Date("2030-07-02T12:00:00Z") } });
    const vacation = await env.db.absence.create({ data: { employeeId: emp.id, type: "vacation", startDate: new Date("2030-09-01T12:00:00Z"), endDate: new Date("2030-09-02T12:00:00Z") } });
    await login(["employees.edit"]);
    const state = await absenceSave({ id: sick.id, version: versionOf(sick), type: "training", startDate: "2030-07-01", endDate: "2030-07-02" });
    assert.ok(state.error, "eine Krankheitszeile ohne Recht nicht umschreiben");
    assert.ok((await absenceSave({ id: vacation.id, version: versionOf(vacation), type: "sick", startDate: "2030-09-01", endDate: "2030-09-02" })).fieldErrors?.type);
    assert.equal((await env.db.absence.findUniqueOrThrow({ where: { id: sick.id } })).type, "sick");
    assert.equal((await env.db.absence.findUniqueOrThrow({ where: { id: vacation.id } })).type, "vacation");
    await login(["employees.edit", "employees.sensitive"]);
    await redirectOf(() => absenceSave({ id: sick.id, version: versionOf(sick), type: "sick", startDate: "2030-07-01", endDate: "2030-07-03" }));
    assert.equal((await env.db.absence.findUniqueOrThrow({ where: { id: sick.id } })).endDate.toISOString().slice(0, 10), "2030-07-03");
  });

  it("Qualifikation ändern: Version, Zeitraum, Person bleibt dieselbe, Audit qualificationUpdate", async () => {
    await login(["employees.edit"]);
    await actions.saveQualification({}, form({ employeeId: emp.id, name: "Staplerschein", expiresAt: "2029-01-01" }));
    const q = await env.db.qualification.findFirstOrThrow();
    const edit = (fields: Record<string, string>) => actions.saveQualification({}, form({ employeeId: emp.id, id: q.id, version: versionOf(q), name: "Staplerschein", ...fields }));
    assert.equal(await redirectOf(() => edit({ expiresAt: "2031-01-01", note: "verlängert" })), `/employees/${emp.id}`);
    const changed = await env.db.qualification.findUniqueOrThrow({ where: { id: q.id } });
    assert.deepEqual([changed.expiresAt?.toISOString().slice(0, 10), changed.note], ["2031-01-01", "verlängert"]);
    assert.ok((await edit({ note: "alt" })).error, "veraltete Version");
    assert.ok((await actions.saveQualification({}, form({ employeeId: emp.id, id: q.id, version: versionOf(changed), name: "X", issuedAt: "2024-01-01", expiresAt: "2023-01-01" }))).fieldErrors?.expiresAt);
    const other = await env.db.employee.create({ data: { firstName: "Max", lastName: "Andere", active: true } });
    assert.ok((await actions.saveQualification({}, form({ employeeId: other.id, id: q.id, version: versionOf(changed), name: "X" }))).fieldErrors?.employeeId);
    assert.equal((await entries("employee.qualificationUpdate")).length, 1);
    assert.equal((await entries("employee.qualificationUpdate"))[0].target, "Erika Muster: Staplerschein");
  });
});

/** Der angemeldete Benutzer als Betrachter (Sitzung des Tests). */
async function currentViewer() {
  const { requireSession } = await import("@/server/auth/session");
  return requireSession();
}
