import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { grantablePermissions } from "@/lib/api/scope";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Die Ressourcen der Funktionen über die API: dieselben Prüfungen und Audit-Einträge wie in der Oberfläche (gleiche Operationen), Eigenheiten je Ressource
 * (Halterwechsel, Doppelbelegung, DOT-Prüfung, Cent-Beträge, keine sensiblen Mitarbeiterdaten, Kilometerstand, IP im Subnetz …).
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("./router");
let state: typeof import("./state");
let token: string;

before(async () => {
  env = await createTestEnv();
  router = await import("./router");
  state = await import("./state");
  state.apiLimits.failuresGlobal = 1_000_000;
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  for (const table of ["apiIdempotencyKey", "apiToken", "auditLog", "appointment", "tireSet", "invoice", "absence", "qualification", "fleetLicenseCheck", "fleetVehicle", "employee", "vehicleOwnership", "vehicle", "customer", "netConnection", "netIp", "netSubnet", "netVlan", "netDevice", "netLocation", "bay", "appointmentType"] as const) {
    await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  }
  token = (await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 })).token;
});

type Init = { body?: unknown; headers?: Record<string, string> };
const api = async (method: string, path: string, init: Init = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, ...init }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json };
};
const ifMatch = (item: Json) => ({ "if-match": `"${item.version}"` });

describe("Fahrzeuge", () => {
  it("anlegen mit Halter (Halter-Historie), Kennzeichen eindeutig, ändern, Halterwechsel, löschen", async () => {
    const owner = await env.db.customer.create({ data: { lastName: "Halter" } });
    const other = await env.db.customer.create({ data: { lastName: "Neu" } });
    const created = await api("POST", "/vehicles", { body: { plate: "b-ab 1234", make: "VW", customerId: owner.id } });
    assert.equal(created.status, 201);
    const vehicle = created.json.data as Json;
    assert.equal(vehicle.plate, "B-AB 1234");
    assert.equal(vehicle.customerId, owner.id);
    assert.equal(await env.db.vehicleOwnership.count({ where: { vehicleId: vehicle.id } }), 1);

    const dup = await api("POST", "/vehicles", { body: { plate: "B AB 1234" } });
    assert.equal(dup.status, 422);
    assert.ok(dup.json.fields.plate);
    assert.equal((await api("POST", "/vehicles", { body: { plate: "X-Y 1", vin: "KAPUTT" } })).status, 422);
    assert.equal((await api("POST", "/vehicles", { body: { plate: "X-Y 2", customerId: "gibtsnicht" } })).json.fields.customerId.code, "validation.invalid");

    const patched = await api("PATCH", `/vehicles/${vehicle.id}`, { body: { model: "Golf", notes: null }, headers: ifMatch(vehicle) });
    assert.equal(patched.status, 200);
    assert.deepEqual([patched.json.data.make, patched.json.data.model, patched.json.data.customerId], ["VW", "Golf", owner.id]);
    // der Halter ist beim Ändern kein Feld
    assert.equal((await api("PATCH", `/vehicles/${vehicle.id}`, { body: { customerId: other.id }, headers: ifMatch(patched.json.data) })).status, 422);

    const transferred = await api("POST", `/vehicles/${vehicle.id}/transfer`, { body: { customerId: other.id, date: "2026-03-01", note: "Verkauf" } });
    assert.equal(transferred.status, 200);
    assert.equal(transferred.json.data.customerId, other.id);
    assert.equal(await env.db.vehicleOwnership.count({ where: { vehicleId: vehicle.id } }), 2);
    assert.equal((await api("POST", `/vehicles/${vehicle.id}/transfer`, { body: { customerId: other.id, date: "2026-03-02" } })).json.fields.customerId.code, "vehicles.errors.sameOwner");
    assert.equal((await api("POST", `/vehicles/${vehicle.id}/transfer`, { body: { date: "kein-datum" } })).status, 422);

    assert.equal((await api("DELETE", `/vehicles/${vehicle.id}`)).status, 204);
    assert.deepEqual((await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action).filter((a) => a.startsWith("vehicle")), ["vehicle.create", "vehicle.update", "vehicle.transfer", "vehicle.delete"]);
  });
});

describe("Termine", () => {
  it("Doppelbelegung des Arbeitsplatzes wird abgelehnt (dieselbe Prüfung wie im Formular), Zeiten, Filter und Nachschlagelisten", async () => {
    const bay = await env.db.bay.create({ data: { name: "Bühne 1" } });
    const type = await env.db.appointmentType.create({ data: { name: "Inspektion" } });
    const body = { title: "Inspektion", date: "2026-05-04", time: "09:00", durationMinutes: 60, bayId: bay.id, typeId: type.id };
    const first = await api("POST", "/appointments", { body });
    assert.equal(first.status, 201);
    const appt = first.json.data as Json;
    assert.deepEqual([appt.date, appt.time, appt.durationMinutes, appt.status], ["2026-05-04", "09:00", 60, "scheduled"]);

    const clash = await api("POST", "/appointments", { body: { ...body, title: "Zweiter", time: "09:30" } });
    assert.equal(clash.status, 422);
    assert.equal(clash.json.fields.bayId.code, "appointments.errors.bayBusy");
    // direkt anschließend ist frei; abgesagte Termine geben den Arbeitsplatz frei
    assert.equal((await api("POST", "/appointments", { body: { ...body, title: "Danach", time: "10:00" } })).status, 201);
    assert.equal((await api("PATCH", `/appointments/${appt.id}`, { body: { status: "cancelled" }, headers: ifMatch(appt) })).status, 200);
    assert.equal((await api("POST", "/appointments", { body: { ...body, title: "Frei", time: "09:00" } })).status, 201);

    const invalid = await api("POST", "/appointments", { body: { ...body, durationMinutes: 1 } });
    assert.equal(invalid.status, 422);
    assert.ok(invalid.json.fields.durationMinutes);
    assert.equal((await api("POST", "/appointments", { body: { ...body, date: "2026-02-31" } })).status, 422);

    const day = await api("GET", "/appointments?from=2026-05-04&to=2026-05-04&sort=startsAt");
    assert.equal(day.json.page.total, 3);
    assert.equal((await api("GET", "/appointments?from=2026-05-05")).json.page.total, 0);
    assert.equal((await api("GET", `/appointments?bayId=${bay.id}&status=cancelled`)).json.page.total, 1);

    const moved = await api("GET", `/appointments/${appt.id}`);
    const patched = await api("PATCH", `/appointments/${appt.id}`, { body: { time: "14:00", status: "confirmed" }, headers: ifMatch(moved.json.data) });
    assert.equal(patched.json.data.time, "14:00");
    assert.equal(patched.json.data.durationMinutes, 60);

    // Arbeitsplätze und Terminarten: nur lesbar
    assert.deepEqual((await api("GET", "/appointment-bays")).json.data.map((b: Json) => b.name), ["Bühne 1"]);
    assert.equal((await api("GET", "/appointment-types")).json.data[0].name, "Inspektion");
    assert.equal((await api("POST", "/appointment-bays", { body: { name: "X" } })).status, 405);
    assert.equal((await api("DELETE", `/appointment-types/${type.id}`)).status, 405);
  });
});

describe("Reifensätze", () => {
  it("DOT und Profiltiefe werden wie im Formular geprüft; Einzelreifen kommen sortiert; Status-Aktion", async () => {
    const vehicle = await env.db.vehicle.create({ data: { plate: "B-RS 1", plateNorm: "BRS1" } });
    const bad = await api("POST", "/tire-sets", { body: { vehicleId: vehicle.id, season: "winter", tires: { FL: { dot: "9999" }, FR: { treadDepthMm: 3.5 } } } });
    assert.equal(bad.status, 422);
    assert.equal(bad.json.fields["tires.FL.dot"].code, "tires.errors.dot");

    const created = await api("POST", "/tire-sets", {
      body: { vehicleId: vehicle.id, season: "winter", brand: "Conti", width: 205, aspect: 55, rim: 16, tires: { FL: { dot: "2321", treadDepthMm: 7.5 }, RR: { dot: "2321", treadDepthMm: 3.5, condition: "fair" } } },
    });
    assert.equal(created.status, 201);
    const set = created.json.data as Json;
    assert.deepEqual(set.tires.map((t: Json) => t.position), ["FL", "FR", "RL", "RR"]);
    assert.equal(set.tires[0].treadDepthMm, 7.5);
    assert.equal(set.tires[0].producedYear, 2021);
    assert.equal(set.status, "stored");
    assert.equal((await api("POST", "/tire-sets", { body: { vehicleId: "gibtsnicht", season: "winter" } })).status, 422);

    // mit Ersatzrad
    const withSpare = await api("PATCH", `/tire-sets/${set.id}`, { body: { spare: true, brand: "Pirelli" }, headers: ifMatch(set) });
    assert.equal(withSpare.status, 200);
    assert.equal(withSpare.json.data.tires.length, 5);
    assert.equal(withSpare.json.data.tires[0].treadDepthMm, 7.5, "bestehende Werte bleiben beim Teil-Update");

    const mounted = await api("POST", `/tire-sets/${set.id}/status`, { body: { status: "mounted" } });
    assert.equal(mounted.json.data.status, "mounted");
    assert.equal((await api("POST", `/tire-sets/${set.id}/status`, { body: { status: "kaputt" } })).status, 422);
    assert.equal((await api("GET", `/tire-sets?vehicleId=${vehicle.id}&status=mounted`)).json.page.total, 1);
    assert.equal((await api("DELETE", `/tire-sets/${set.id}`)).status, 204);
    assert.equal(await env.db.tire.count(), 0);
  });
});

describe("Rechnungsarchiv", () => {
  it("Beträge als Cent, Summenprüfung, eindeutige Ausgangsnummer, Beleg bleibt erhalten, bezahlen und wieder öffnen", async () => {
    const body = { direction: "outgoing", number: "RE-2026-001", partyName: "Kunde GmbH", issueDate: "2026-04-01", dueDate: "2026-04-15", netCents: 10000, vatCents: 1900, grossCents: 11900 };
    const created = await api("POST", "/invoices", { body });
    assert.equal(created.status, 201);
    const invoice = created.json.data as Json;
    assert.deepEqual([invoice.grossCents, invoice.status, invoice.hasFile, invoice.issueDate, invoice.dueDate], [11900, "open", false, "2026-04-01", "2026-04-15"]);

    const mismatch = await api("POST", "/invoices", { body: { ...body, number: "RE-2", grossCents: 12000 } });
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.json.fields.grossCents.code, "invoices.errors.sumMismatch");
    const taken = await api("POST", "/invoices", { body: { ...body, partyName: "Anderer" } });
    assert.equal(taken.status, 422);
    assert.equal(taken.json.fields.number.code, "invoices.errors.numberTaken");
    assert.equal((await api("POST", "/invoices", { body: { ...body, number: "RE-3", grossCents: 0, netCents: null, vatCents: null } })).json.fields.grossCents.code, "invoices.errors.amount");
    assert.equal((await api("POST", "/invoices", { body: { ...body, number: "RE-4", grossCents: 11900.5 } })).status, 422);

    // ein vorhandener Beleg übersteht das Ändern
    const { storeFile } = await import("@/server/files");
    const stored = await storeFile("rechnungen/test", "beleg.pdf", new Uint8Array([1, 2, 3]));
    await env.db.invoiceFile.create({ data: { invoiceId: invoice.id, name: "beleg.pdf", mime: "application/pdf", size: 3, path: stored } });
    const patched = await api("PATCH", `/invoices/${invoice.id}`, { body: { category: "Service", dueDate: null }, headers: ifMatch(invoice) });
    assert.equal(patched.status, 200);
    assert.deepEqual([patched.json.data.category, patched.json.data.dueDate, patched.json.data.grossCents, patched.json.data.hasFile], ["Service", null, 11900, true]);
    assert.equal(await env.db.invoiceFile.count(), 1);

    const paid = await api("POST", `/invoices/${invoice.id}/pay`, { body: { paidAt: "2026-04-10" } });
    assert.deepEqual([paid.json.data.status, paid.json.data.paidAt], ["paid", "2026-04-10"]);
    assert.equal((await api("POST", `/invoices/${invoice.id}/reopen`)).json.data.status, "open");
    assert.equal((await api("GET", "/invoices?direction=outgoing&status=open&q=kunde")).json.page.total, 1);
    assert.equal((await api("GET", "/invoices?issuedFrom=2026-05-01")).json.page.total, 0);
    assert.equal((await api("POST", "/invoices/gibtsnicht/pay")).status, 404);
    assert.ok(await env.db.auditLog.findFirst({ where: { action: "invoice.pay" } }));
  });
});

describe("Mitarbeiter (ohne sensible Daten)", () => {
  it("Notfallkontakt und Benutzerverknüpfung gibt es nicht; die Verknüpfung bleibt beim Ändern erhalten", async () => {
    const user = await env.user({ username: "verknuepft" });
    const linked = await env.db.employee.create({ data: { firstName: "Eva", lastName: "Mayer", userId: user.id, emergencyName: "Geheim", emergencyPhone: "0123" } });

    const read = await api("GET", `/employees/${linked.id}`);
    assert.equal(read.status, 200);
    assert.ok(!JSON.stringify(read.json).includes("Geheim"));
    assert.ok(!("emergencyName" in read.json.data) && !("userId" in read.json.data));
    const list = await api("GET", "/employees");
    assert.ok(!JSON.stringify(list.json).includes("0123"));

    for (const field of ["emergencyName", "emergencyPhone", "emergencyRelation", "userId"]) {
      assert.equal((await api("POST", "/employees", { body: { firstName: "A", lastName: "B", [field]: "x" } })).status, 422, field);
      assert.equal((await api("PATCH", `/employees/${linked.id}`, { body: { [field]: "x" }, headers: ifMatch(read.json.data) })).status, 422, field);
    }
    const patched = await api("PATCH", `/employees/${linked.id}`, { body: { jobTitle: "Meisterin" }, headers: ifMatch(read.json.data) });
    assert.equal(patched.status, 200);
    const row = await env.db.employee.findUniqueOrThrow({ where: { id: linked.id } });
    assert.deepEqual([row.jobTitle, row.userId, row.emergencyName, row.emergencyPhone], ["Meisterin", user.id, "Geheim", "0123"]);
    assert.equal(await env.db.auditLog.count({ where: { action: "employee.sensitiveUpdate" } }), 0);

    const created = await api("POST", "/employees", { body: { firstName: "Neu", lastName: "Kollege", department: "workshop", hireDate: "2026-01-02" } });
    assert.equal(created.status, 201);
    assert.deepEqual([created.json.data.active, created.json.data.hireDate], [true, "2026-01-02"]);
    assert.equal((await api("POST", "/employees", { body: { firstName: "Neu", lastName: "Kollege", email: "kaputt" } })).status, 422);
  });

  it("Krankheit existiert in der API nicht – nicht lesbar, nicht anlegbar, nicht löschbar, auch nicht mit sensible-Scope", async () => {
    const e = await env.db.employee.create({ data: { firstName: "Kranke", lastName: "Person" } });
    const sick = await env.db.absence.create({ data: { employeeId: e.id, type: "sick", startDate: new Date("2026-02-02T12:00:00"), endDate: new Date("2026-02-03T12:00:00") } });
    const vac = await env.db.absence.create({ data: { employeeId: e.id, type: "vacation", startDate: new Date("2026-03-02T12:00:00"), endDate: new Date("2026-03-06T12:00:00") } });
    // ein Token mit dem gesperrten Recht in der Datenbank (z. B. von Hand eingetragen): wirkungslos
    const sneaky = await makeToken(env, { admin: true, scope: ["employees.view", "employees.edit", "employees.delete", "employees.sensitive"], rateLimitPerMinute: 6000 });
    const asSneaky = async (method: string, path: string, body?: unknown) => {
      const response = await router.handleApiRequest(apiRequest(method, path, { token: sneaky.token, body }));
      return { status: response.status, text: await response.text() };
    };

    assert.deepEqual((await api("GET", "/employee-absences")).json.data.map((a: Json) => a.id), [vac.id]);
    assert.equal((await api("GET", `/employee-absences/${sick.id}`)).status, 404);
    assert.equal((await api("DELETE", `/employee-absences/${sick.id}`)).status, 404);
    assert.equal((await api("POST", "/employee-absences", { body: { employeeId: e.id, type: "sick", startDate: "2026-04-01", endDate: "2026-04-02" } })).status, 422);
    assert.equal((await asSneaky("GET", `/employees/${e.id}`)).status, 200);
    assert.equal((await asSneaky("GET", "/employee-absences")).text.includes(sick.id), false);
    assert.equal((await asSneaky("GET", `/employee-absences/${sick.id}`)).status, 404);
    assert.equal((await asSneaky("POST", "/employee-absences", { employeeId: e.id, type: "sick", startDate: "2026-04-01", endDate: "2026-04-02" })).status, 422);
    assert.equal(await env.db.absence.count({ where: { type: "sick" } }), 1);

    const ok = await api("POST", "/employee-absences", { body: { employeeId: e.id, type: "training", startDate: "2026-04-01", endDate: "2026-04-02", note: "Kurs" } });
    assert.equal(ok.status, 201);
    assert.equal((await api("DELETE", `/employee-absences/${ok.json.data.id}`)).status, 204);

    const q = await api("POST", "/employee-qualifications", { body: { employeeId: e.id, name: "Ersthelfer", expiresAt: "2027-01-01" } });
    assert.equal(q.status, 201);
    assert.equal((await api("GET", `/employee-qualifications?employeeId=${e.id}`)).json.page.total, 1);
    assert.equal((await api("POST", "/employee-qualifications", { body: { employeeId: e.id, name: "X", issuedAt: "2027-01-02", expiresAt: "2027-01-01" } })).json.fields.expiresAt.code, "employees.errors.expiresBeforeIssued");
  });
});

describe("Fuhrpark", () => {
  it("Fahrzeug mit Leasingrate in Cent, Kilometerstand nicht unter dem letzten, Kosten, Führerscheinkontrolle", async () => {
    const created = await api("POST", "/fleet-vehicles", { body: { plate: "B-FL 1", leasingRateCents: 45900, huDue: "2027-01-31", fuelType: "diesel" } });
    assert.equal(created.status, 201);
    const car = created.json.data as Json;
    assert.deepEqual([car.leasingRateCents, car.huDue, car.status], [45900, "2027-01-31", "active"]);
    const patched = await api("PATCH", `/fleet-vehicles/${car.id}`, { body: { location: "Hof" }, headers: ifMatch(car) });
    assert.deepEqual([patched.json.data.location, patched.json.data.leasingRateCents], ["Hof", 45900]);
    assert.equal((await api("POST", "/fleet-vehicles", { body: { plate: "B-FL 2", leasingRateCents: -1 } })).status, 422);

    assert.equal((await api("POST", "/fleet-mileage", { body: { fleetVehicleId: car.id, date: "2026-01-01", km: 10000 } })).status, 201);
    const lower = await api("POST", "/fleet-mileage", { body: { fleetVehicleId: car.id, date: "2026-02-01", km: 9000 } });
    assert.equal(lower.status, 422);
    assert.equal(lower.json.fields.km.code, "fleet.errors.kmLower");
    assert.equal((await api("GET", `/fleet-mileage?fleetVehicleId=${car.id}`)).json.page.total, 1);

    const cost = await api("POST", "/fleet-costs", { body: { fleetVehicleId: car.id, date: "2026-02-01", category: "fuel", amountCents: 6543, km: 10100 } });
    assert.equal(cost.status, 201);
    assert.equal(cost.json.data.amountCents, 6543);
    assert.equal((await env.db.fleetCost.findFirstOrThrow()).amountCents, 6543);
    assert.equal((await api("POST", "/fleet-costs", { body: { fleetVehicleId: car.id, date: "2026-02-01", category: "fuel", amountCents: 0 } })).json.fields.amountCents.code, "fleet.errors.amount");

    const driver = await env.db.employee.create({ data: { firstName: "Fahrer", lastName: "Eins" } });
    const check = await api("POST", "/fleet-license-checks", { body: { employeeId: driver.id, checkedAt: "2026-01-15", method: "Sichtkontrolle" } });
    assert.equal(check.status, 201);
    assert.equal(check.json.data.nextDue, "2026-07-15");
    assert.match(check.json.data.checkedByName, /API Besitzer/);
    assert.equal((await api("DELETE", `/fleet-costs/${cost.json.data.id}`)).status, 204);
    assert.equal((await api("DELETE", `/fleet-vehicles/${car.id}`)).status, 204);
    assert.equal(await env.db.fleetMileage.count(), 0);
  });
});

describe("Netzwerk-Dokumentation", () => {
  it("Subnetz, IP im Subnetz und eindeutig, MAC normalisiert, VLAN-Nummer, Standort, Kabel mit belegtem Port", async () => {
    const vlan = await api("POST", "/network-vlans", { body: { number: 10, name: "Büro" } });
    assert.equal(vlan.status, 201);
    assert.equal(vlan.json.data.number, 10);
    const dupVlan = await api("POST", "/network-vlans", { body: { number: 10, name: "Doppelt" } });
    assert.equal(dupVlan.json.fields.number.code, "network.errors.vlanExists");
    assert.equal((await api("POST", "/network-vlans", { body: { number: 5000, name: "Zu hoch" } })).status, 422);

    const subnet = await api("POST", "/network-subnets", { body: { name: "Büro", cidr: "192.168.10.0/24", vlanId: vlan.json.data.id, gateway: "192.168.10.1" } });
    assert.equal(subnet.status, 201);
    assert.equal(subnet.json.data.cidr, "192.168.10.0/24");
    assert.equal((await api("POST", "/network-subnets", { body: { name: "Falsch", cidr: "10.1.0.0/16", gateway: "192.168.10.1" } })).json.fields.gateway.code, "network.errors.notInSubnet");

    const location = (await api("POST", "/network-locations", { body: { name: "Serverraum" } })).json.data as Json;
    const device = (await api("POST", "/network-devices", { body: { name: "sw1", type: "switch", locationId: location.id, portCount: 24 } })).json.data as Json;
    const device2 = (await api("POST", "/network-devices", { body: { name: "srv1", type: "server" } })).json.data as Json;
    assert.equal(device.monitorEnabled, false);

    const ip = await api("POST", "/network-ips", { body: { subnetId: subnet.json.data.id, address: "192.168.10.20", deviceId: device.id, mac: "aa-bb-cc-00-11-22" } });
    assert.equal(ip.status, 201);
    assert.equal(ip.json.data.mac, "AA:BB:CC:00:11:22");
    assert.equal((await api("POST", "/network-ips", { body: { subnetId: subnet.json.data.id, address: "192.168.99.5" } })).json.fields.address.code, "network.errors.notInSubnet");
    assert.equal((await api("POST", "/network-ips", { body: { subnetId: subnet.json.data.id, address: "192.168.10.20" } })).json.fields.address.code, "network.errors.ipTaken");
    const moved = await api("PATCH", `/network-ips/${ip.json.data.id}`, { body: { hostname: "sw1.lan" }, headers: ifMatch(ip.json.data) });
    assert.deepEqual([moved.json.data.hostname, moved.json.data.address], ["sw1.lan", "192.168.10.20"]);
    assert.equal((await api("PATCH", `/network-vlans/${vlan.json.data.id}`, { body: { name: "Büro neu" } })).json.data.name, "Büro neu");

    const cable = await api("POST", "/network-connections", { body: { fromDeviceId: device.id, fromPort: "1", toDeviceId: device2.id, toPort: "eth0" } });
    assert.equal(cable.status, 201);
    assert.equal((await api("POST", "/network-connections", { body: { fromDeviceId: device.id, fromPort: "1", toDeviceId: device2.id, toPort: "eth1" } })).json.fields.fromPort.code, "network.errors.portBusy");
    assert.equal((await api("POST", "/network-connections", { body: { fromDeviceId: device.id, toDeviceId: device.id } })).json.fields.toDeviceId.code, "network.errors.sameDevice");
    assert.equal((await api("GET", `/network-connections?deviceId=${device2.id}`)).json.page.total, 1);
    assert.equal((await api("GET", "/network-ips?q=sw1")).json.page.total, 1);

    assert.equal((await api("DELETE", `/network-locations/${location.id}`)).status, 204);
    assert.equal((await api("DELETE", `/network-devices/${device.id}`)).status, 204);
    assert.equal(await env.db.netConnection.count(), 0);
  });
});

describe("Kunden: Audit der API-Schreibzugriffe", () => {
  it("alle Schreibzugriffe tragen die Token-Kennung im Audit-Log und keine Klartext-Tokens", async () => {
    await api("POST", "/customers", { body: { lastName: "Audit" } });
    await api("POST", "/vehicles", { body: { plate: "B-AU 1" } });
    await api("POST", "/network-vlans", { body: { number: 20, name: "Audit" } });
    const entries = await env.db.auditLog.findMany();
    assert.equal(entries.length, 3);
    for (const entry of entries) assert.match(entry.actorName, /\[API: Token \d+\]$/);
    assert.ok(!JSON.stringify(entries).includes(token));
  });
});
