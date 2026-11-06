import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { isCalendarDay } from "@/lib/dates";
import { grantablePermissions } from "@/lib/api/scope";
import type { AppSession } from "@/server/auth/session";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Kalendertage (ZP2-Q-1 / ZP2-S-F07): `JJJJ-MM-TT` muss ein **echter** Tag sein – in API-Körpern, API-Filtern und in den Operationen hinter den
 * Formularen. Vorher: `2026-13-45` → 500 (Invalid Date an Prisma), `2026-02-30` → 201 mit stillem Rollen auf den 2. März, Filter `2026-02-31` → 200 ohne Filter.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
let ops: typeof import("@/server/operations");
let token: string;
let admin: AppSession;

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
  ops = await import("@/server/operations");
  state.apiLimits.failuresGlobal = 1_000_000;
  const adminRole = await env.role({ key: "admin", isAdmin: true, isSystem: true });
  await env.signIn(await env.user({ username: "chef", roles: [adminRole] }));
  const { getSession } = await import("@/server/auth/session");
  admin = (await getSession())!;
  env.signOut();
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  token = (await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 })).token;
});

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, body, headers }));
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
};

/** Tage, die es nicht gibt – jeder muss abgelehnt werden. */
const BAD_DAYS = ["2026-13-45", "2026-02-30", "2026-04-31", "2026-00-10", "2026-06-00", "2026-01-32", "2027-02-29", "0000-01-01", "2026-1-01", "26-01-01", "2026-01-01x", " 2026-01-01"];
/** Tage, die es gibt – auch Schalttag und Monatsenden. */
const GOOD_DAYS = ["2028-02-29", "2026-12-31", "2026-04-30", "2026-01-01"];

describe("isCalendarDay", () => {
  it("lehnt Monat 13, Tag 32, 30. Februar, 29. Februar im Nichtschaltjahr und Formfehler ab", () => {
    for (const day of BAD_DAYS) assert.equal(isCalendarDay(day), false, day);
    for (const day of GOOD_DAYS) assert.equal(isCalendarDay(day), true, day);
    assert.equal(isCalendarDay("1900-02-29"), false, "1900 war kein Schaltjahr");
    assert.equal(isCalendarDay("2000-02-29"), true);
  });
});

/** Je Zeile: Name, Anlegen mit Pfad/Körper (ohne Datum), das Datumsfeld und optional ein Vorlauf, der Verweise anlegt. */
type Case = { name: string; path: string; field: string; body: (refs: Refs) => Json };
type Refs = { employeeId: string; fleetVehicleId: string; vehicleId: string };

let refs: Refs;
const makeRefs = async (): Promise<Refs> => {
  const employee = await env.db.employee.create({ data: { firstName: "Test", lastName: "Person" } });
  const fleet = await env.db.fleetVehicle.create({ data: { plate: "B-KD 1" } });
  const vehicle = await env.db.vehicle.create({ data: { plate: `B-KV ${Math.floor(Math.random() * 9000)}`, plateNorm: `BKV${Math.random()}` } });
  return { employeeId: employee.id, fleetVehicleId: fleet.id, vehicleId: vehicle.id };
};

const CASES: Case[] = [
  { name: "Rechnung: Rechnungsdatum", path: "/invoices", field: "issueDate", body: () => ({ direction: "outgoing", number: `RE-${Math.random()}`, partyName: "X", netCents: 100, vatCents: 19, grossCents: 119 }) },
  { name: "Rechnung: Fälligkeit", path: "/invoices", field: "dueDate", body: () => ({ direction: "outgoing", number: `RE-${Math.random()}`, partyName: "X", issueDate: "2026-01-01", grossCents: 119 }) },
  { name: "Mitarbeiter: Eintritt", path: "/employees", field: "hireDate", body: () => ({ firstName: "A", lastName: "B" }) },
  { name: "Mitarbeiter: Austritt", path: "/employees", field: "leaveDate", body: () => ({ firstName: "A", lastName: "B" }) },
  { name: "Abwesenheit: Beginn", path: "/employee-absences", field: "startDate", body: (r) => ({ employeeId: r.employeeId, type: "vacation", endDate: "2026-06-30" }) },
  { name: "Abwesenheit: Ende", path: "/employee-absences", field: "endDate", body: (r) => ({ employeeId: r.employeeId, type: "vacation", startDate: "2026-06-01" }) },
  { name: "Qualifikation: ausgestellt", path: "/employee-qualifications", field: "issuedAt", body: (r) => ({ employeeId: r.employeeId, name: "Ersthelfer" }) },
  { name: "Qualifikation: gültig bis", path: "/employee-qualifications", field: "expiresAt", body: (r) => ({ employeeId: r.employeeId, name: "Ersthelfer" }) },
  { name: "Dienstfahrzeug: HU", path: "/fleet-vehicles", field: "huDue", body: () => ({ plate: `B-FZ ${Math.floor(Math.random() * 9000)}` }) },
  { name: "Dienstfahrzeug: Versicherung bis", path: "/fleet-vehicles", field: "insuranceUntil", body: () => ({ plate: `B-FZ ${Math.floor(Math.random() * 9000)}` }) },
  { name: "Kilometerstand: Datum", path: "/fleet-mileage", field: "date", body: (r) => ({ fleetVehicleId: r.fleetVehicleId, km: 10 }) },
  { name: "Fahrzeugkosten: Datum", path: "/fleet-costs", field: "date", body: (r) => ({ fleetVehicleId: r.fleetVehicleId, category: "fuel", amountCents: 100 }) },
  { name: "Führerscheinkontrolle: Datum", path: "/fleet-license-checks", field: "checkedAt", body: (r) => ({ employeeId: r.employeeId, method: "Sicht" }) },
  { name: "Termin: Datum", path: "/appointments", field: "date", body: () => ({ title: "T", time: "09:00", durationMinutes: 30 }) },
  { name: "Reifensatz: eingelagert", path: "/tire-sets", field: "storedAt", body: (r) => ({ vehicleId: r.vehicleId, season: "winter" }) },
  { name: "Netzwerkgerät: Kaufdatum", path: "/network-devices", field: "purchaseDate", body: () => ({ name: `sw-${Math.random()}`, type: "switch" }) },
  { name: "Netzwerkgerät: Garantie bis", path: "/network-devices", field: "warrantyUntil", body: () => ({ name: `sw-${Math.random()}`, type: "switch" }) },
];

describe("API-Körper: ungültige Kalendertage sind 422 (nie 500), nichts wird angelegt, gültige Tage gehen durch", () => {
  before(async () => {
    refs = await makeRefs();
  });

  for (const c of CASES) {
    it(c.name, async () => {
      for (const day of BAD_DAYS) {
        const res = await api("POST", c.path, { ...c.body(refs), [c.field]: day });
        assert.equal(res.status, 422, `${c.field}=${JSON.stringify(day)} → ${res.status}`);
        assert.ok(res.json.fields?.[c.field], `${c.field}=${JSON.stringify(day)}: Feldfehler fehlt (${JSON.stringify(res.json)})`);
      }
      // dieselben Tage als Teil-Änderung (PATCH), wenn die Ressource eines hat, werden unten getrennt geprüft
      const ok = await api("POST", c.path, { ...c.body(refs), [c.field]: "2028-02-29" });
      assert.ok(ok.status === 201 || ok.status === 422, `Schalttag: ${ok.status} ${JSON.stringify(ok.json)}`);
      if (ok.status === 422) assert.ok(!ok.json.fields?.[c.field], `der Schalttag 2028-02-29 ist kein Fehler von ${c.field}: ${JSON.stringify(ok.json.fields)}`);
    });
  }

  it("PATCH und Aktionen: Rechnung ändern, Rechnung bezahlen, Fahrzeug übertragen", async () => {
    const invoice = await api("POST", "/invoices", { direction: "outgoing", number: "RE-DAY-1", partyName: "X", issueDate: "2026-01-01", grossCents: 100 });
    assert.equal(invoice.status, 201);
    const match = { "if-match": `"${invoice.json.data.version}"` };
    for (const day of BAD_DAYS) {
      const patch = await api("PATCH", `/invoices/${invoice.json.data.id}`, { issueDate: day }, match);
      assert.equal(patch.status, 422, `PATCH issueDate=${day}: ${patch.status}`);
      const pay = await api("POST", `/invoices/${invoice.json.data.id}/pay`, { paidAt: day });
      assert.equal(pay.status, 422, `pay paidAt=${day}: ${pay.status}`);
      const transfer = await api("POST", `/vehicles/${refs.vehicleId}/transfer`, { date: day });
      assert.equal(transfer.status, 422, `transfer date=${day}: ${transfer.status}`);
    }
    assert.equal((await env.db.invoice.findUniqueOrThrow({ where: { id: invoice.json.data.id } })).status, "open");
  });

  it("der Schalttag bleibt ein Schalttag (kein Rollen auf den 1. März)", async () => {
    const created = await api("POST", "/employees", { firstName: "Schalt", lastName: "Tag", hireDate: "2028-02-29" });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.hireDate, "2028-02-29");
  });
});

describe("API-Filter: ungültige Kalendertage sind 422 statt 500 oder stillem Weglassen des Filters", () => {
  const FILTERS = ["/appointments?from=", "/appointments?to=", "/invoices?issuedFrom=", "/invoices?issuedTo=", "/employee-absences?from=", "/employee-absences?to="];
  for (const filter of FILTERS) {
    it(filter, async () => {
      for (const day of BAD_DAYS.filter((d) => d !== " 2026-01-01")) {
        const res = await api("GET", `${filter}${encodeURIComponent(day)}`);
        assert.equal(res.status, 422, `${filter}${day} → ${res.status}`);
        assert.ok(res.json.fields, `${filter}${day}: Feldfehler fehlt`);
      }
      assert.equal((await api("GET", `${filter}2026-02-28`)).status, 200);
    });
  }
});

describe("Formular-Aktionen: dieselbe Prüfung in den Operationen (Zod-Eingabe der Oberfläche)", () => {
  // Rohe Eingaben genügen: die Datumsprüfung steht in der Eingabe-Prüfung, vor jedem Zugriff auf die Datenbank
  const OPERATIONS: Array<[string, string]> = [
    ["invoices.save", "issueDate"],
    ["invoices.save", "dueDate"],
    ["invoices.save", "paidAt"],
    ["invoices.markPaid", "paidAt"],
    ["employees.save", "hireDate"],
    ["employees.save", "leaveDate"],
    ["employees.saveAbsence", "startDate"],
    ["employees.saveAbsence", "endDate"],
    ["employees.saveQualification", "issuedAt"],
    ["employees.saveQualification", "expiresAt"],
    ["fleet.save", "huDue"],
    ["fleet.addMileage", "date"],
    ["fleet.addCost", "date"],
    ["fleet.saveLicenseCheck", "checkedAt"],
    ["vehicles.transfer", "date"],
    ["appointments.create", "date"],
    ["appointments.update", "date"],
    ["tires.create", "storedAt"],
    ["network.saveDevice", "purchaseDate"],
    ["network.saveDevice", "warrantyUntil"],
  ];

  for (const [name, field] of OPERATIONS) {
    it(`${name}: ${field}`, async () => {
      const operation = ops.listOperations().get(name);
      assert.ok(operation, `Operation ${name} nicht gefunden (registriert sich beim Laden der Funktions-API)`);
      for (const day of BAD_DAYS) {
        const outcome = await operation.execute(admin, { [field]: day });
        assert.equal(outcome.ok, false, `${field}=${JSON.stringify(day)}`);
        assert.equal(!outcome.ok && outcome.failure.code, "invalid");
        assert.ok(!outcome.ok && outcome.failure.fields?.[field], `${name}.${field}=${JSON.stringify(day)}: kein Feldfehler`);
      }
      // ein gültiger Tag erzeugt keinen Fehler an diesem Feld (andere Pflichtfelder fehlen ja)
      const good = await operation.execute(admin, { [field]: "2028-02-29" });
      assert.ok(good.ok || !good.failure.fields?.[field], `${name}.${field}: 2028-02-29 ist gültig`);
    });
  }
});

describe("Termin-Filter über die Sommerzeitumstellung (TZ=Europe/Berlin)", () => {
  const before0 = process.env.TZ;
  before(() => {
    process.env.TZ = "Europe/Berlin";
  });
  after(() => {
    if (before0 === undefined) delete process.env.TZ;
    else process.env.TZ = before0;
  });

  it("from/to meinen Ortstage – der 31.03.2030 hat 23 Stunden, die Nachbartage gehören nicht dazu", async () => {
    await env.db.appointment.deleteMany();
    const mk = (title: string, iso: string) => env.db.appointment.create({ data: { title, startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 30 * 60_000) } });
    await mk("Vortag spät", "2030-03-30T22:30:00Z"); // 23:30 Ortszeit am 30.03.
    await mk("Tag früh", "2030-03-30T23:30:00Z"); // 00:30 am 31.03.
    await mk("Tag nach der Umstellung", "2030-03-31T01:30:00Z"); // 03:30 MESZ
    await mk("Tag spät", "2030-03-31T21:30:00Z"); // 23:30 MESZ
    await mk("Folgetag früh", "2030-03-31T22:30:00Z"); // 00:30 am 01.04.
    const titles = async (query: string) => ((await api("GET", `/appointments?${query}&sort=startsAt`)).json.data as Json[]).map((a) => a.title);
    assert.deepEqual(await titles("from=2030-03-31&to=2030-03-31"), ["Tag früh", "Tag nach der Umstellung", "Tag spät"]);
    assert.deepEqual(await titles("from=2030-04-01"), ["Folgetag früh"]);
    assert.deepEqual(await titles("to=2030-03-30"), ["Vortag spät"]);
  });

  it("Termine in der Lücke der Umstellung (02:30 am 31.03.) lassen sich nicht anlegen, 422 am Feld time/date", async () => {
    const res = await api("POST", "/appointments", { title: "Lücke", date: "2030-03-31", time: "02:30", durationMinutes: 30 });
    assert.equal(res.status, 422);
    assert.ok(res.json.fields.date || res.json.fields.time, JSON.stringify(res.json));
    assert.equal((await api("POST", "/appointments", { title: "Davor", date: "2030-03-31", time: "01:30", durationMinutes: 30 })).status, 201);
  });
});
