import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Datenschutz bei Kunden (P4b-5): Einschränkung blendet überall aus, Auskunft enthält alles, Anonymisierung nur nach bestätigter und abgelaufener Frist – mit Rechten, Audit und Hooks.
 */
let env: TestEnv;
let actions: typeof import("./actions");
let queries: typeof import("./queries");
let exportRoute: typeof import("@/app/api/exchange/[kind]/route");
let jsonRoute: typeof import("@/app/api/customers/[id]/disclosure/route");
let searchRoute: typeof import("@/app/api/customers/search/route");

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  queries = await import("./queries");
  exportRoute = await import("@/app/api/exchange/[kind]/route");
  jsonRoute = await import("@/app/api/customers/[id]/disclosure/route");
  searchRoute = await import("@/app/api/customers/search/route");
});
after(() => env.cleanup());

let seq = 0;
const login = async (permissions: string[], admin = false) => {
  const role = await env.role({ key: `p-${++seq}`, permissions, isAdmin: admin });
  env.signOut();
  return env.signIn(await env.user({ username: `priv${seq}`, name: `Person ${seq}`, roles: [role] }));
};
const ALL_PRIVACY = ["customers.view", "customers.edit", "customers.disclose", "customers.privacy", "vehicles.view", "appointments.view", "tires.view", "invoices.view"];

beforeEach(async () => {
  for (const table of ["auditLog", "docVersion", "docPage", "appointment", "tire", "tireSet", "vehicleOwnership", "vehicle"] as const) await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } });
  await env.db.invoice.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.privacySettings.deleteMany();
  await env.db.featureSetting.deleteMany();
  env.browser.reset();
  env.signOut();
});

const noon = (day: string) => new Date(`${day}T12:00:00Z`);
async function customerWithData() {
  const customer = await env.db.customer.create({
    data: { customerNumber: "K-100", firstName: "Erika", lastName: "Beispiel", email: "erika@example.com", phone: "0171 123", street: "Hauptstr. 1", zip: "12345", city: "Musterstadt", notes: "Mag Kaffee; =cmd|' /C calc'!A0", nameKey: "erika beispiel", cityKey: "musterstadt", phoneKey: "0171123" },
  });
  const vehicle = await env.db.vehicle.create({
    data: { plate: "B-AB 1", plateNorm: "BAB1", make: "VW", model: "Golf", year: 2015, vin: "WVWZZZ1KZAW000001", notes: "Kratzer links, Kundin sehr nett", customerId: customer.id, ownerships: { create: [{ customerId: customer.id, note: "Kauf privat" }] } },
  });
  const set = await env.db.tireSet.create({ data: { vehicleId: vehicle.id, season: "winter", brand: "Conti", width: 205, aspect: 55, rim: 16, notes: "bei Kundin eingelagert", storageLocation: "Halle A" } });
  await env.db.tire.create({ data: { tireSetId: set.id, position: "FL", notes: "Nagel im Reifen" } });
  const appointment = await env.db.appointment.create({ data: { title: "Meier Inspektion", startsAt: noon("2026-05-04"), endsAt: noon("2026-05-05"), notes: "Rückruf unter 0171 123", customerId: customer.id, vehicleId: vehicle.id } });
  await env.db.invoice.create({
    data: { direction: "outgoing", number: "2020-0001", outgoingKey: "2020-0001", partyName: "Erika Beispiel", issueDate: noon("2020-06-15"), grossCents: 11900, netCents: 10000, vatCents: 1900, customerId: customer.id, notes: "Barzahlung" },
  });
  return { customer, vehicle, set, appointment };
}

describe("Verarbeitung einschränken", () => {
  it("braucht customers.privacy; blendet den Kunden überall aus, wo er zur Auswahl steht; im Detail bleibt er; Audit ohne Notiz", async () => {
    const { customer } = await customerWithData();
    await login(["customers.view", "customers.edit"]);
    assert.equal(await redirectOf(() => actions.restrictCustomer(form({ id: customer.id }))), "/forbidden");

    await login([...ALL_PRIVACY, "invoices.edit", "vehicles.edit", "appointments.create", "appointments.edit"]);
    assert.equal(await redirectOf(() => actions.restrictCustomer(form({ id: customer.id, note: "Anfrage per Brief vom 3.5." }))), `/customers/${customer.id}`);
    const row = await env.db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.ok(row.processingRestrictedAt);
    assert.equal(row.restrictionNote, "Anfrage per Brief vom 3.5.");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "customer.restrict" } });
    assert.equal(entry.target, "Erika Beispiel");
    assert.equal(JSON.stringify(entry).includes("Brief"), false, "die Notiz steht nicht im Audit-Log");
    // doppelt einschränken ist ein Konflikt
    await actions.restrictCustomer(form({ id: customer.id }));
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.restrict" } }), 1);

    // Auswahl-Suche, Schnellsuche, Standardbedingung
    const res = await searchRoute.GET(new NextRequest("http://localhost/api/customers/search?q=beispiel"));
    assert.deepEqual((await res.json()).results, []);
    const { searchProviders } = await import("./search");
    assert.deepEqual(await searchProviders[0].search("beispiel", { limit: 10 } as never), []);
    assert.equal(await env.db.customer.count({ where: queries.searchableCustomerWhere }), 0);
    // im Detail sichtbar
    const detail = await queries.getCustomerDetail((await (await import("@/server/auth/session")).requireSession()), customer.id);
    assert.ok(detail?.processingRestrictedAt);
    // aufheben
    await redirectOf(() => actions.unrestrictCustomer(form({ id: customer.id })));
    assert.equal(await env.db.customer.count({ where: queries.searchableCustomerWhere }), 1);
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id: customer.id } })).restrictionNote, null);
  });

  it("die API kennt eingeschränkte Kunden nicht (Liste, Einzelabruf, Ändern); sie lassen sich nicht neu verknüpfen, bestehende Verknüpfungen bleiben", async () => {
    const { customer, vehicle, appointment } = await customerWithData();
    await env.db.customer.update({ where: { id: customer.id }, data: { processingRestrictedAt: new Date() } });
    const other = await env.db.customer.create({ data: { lastName: "Anderer", nameKey: "anderer" } });

    const { apiRequest, makeToken } = await import("@/test/api-helpers");
    const { grantablePermissions } = await import("@/lib/api/scope");
    const router = await import("@/server/api/router");
    const { token } = await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 });
    const call = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
      const response = await router.handleApiRequest(apiRequest(method, path, { token, body, headers }));
      const text = await response.text();
      return { status: response.status, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const list = await call("GET", "/customers?archived=all");
    assert.deepEqual((list.json.data as Array<{ id: string }>).map((c) => c.id), [other.id]);
    assert.equal((await call("GET", `/customers/${customer.id}`)).status, 404);
    assert.equal((await call("PATCH", `/customers/${customer.id}`, { notes: "x" }, { "if-match": '"1"' })).status, 404);
    assert.equal((await call("POST", `/customers/${customer.id}/archive`)).status, 404);

    // neue Verknüpfungen: Termin-Kunde, Halterwechsel auf ihn, Rechnung an ihn
    await login([...ALL_PRIVACY, "invoices.edit", "vehicles.edit", "appointments.create", "appointments.edit"]);
    const vehicleOfOther = await env.db.vehicle.create({ data: { plate: "B-XY 2", plateNorm: "BXY2", customerId: other.id } });
    const transfer = await call("POST", `/vehicles/${vehicleOfOther.id}/transfer`, { customerId: customer.id, date: "2026-06-01" });
    assert.equal(transfer.status, 422, "Halterwechsel auf einen eingeschränkten Kunden");
    const invoice = await call("POST", "/invoices", { direction: "outgoing", number: "N-1", partyName: "X", issueDate: "2026-06-01", grossCents: 100, customerId: customer.id });
    assert.equal(invoice.status, 422, "Rechnung an einen eingeschränkten Kunden");
    const slot = await call("POST", "/appointments", { title: "Neu", date: "2030-01-07", time: "09:00", duration: 60, customerId: customer.id });
    assert.equal(slot.status, 422, "Termin mit eingeschränktem Kunden");
    // bestehende Verknüpfungen bleiben bearbeitbar
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).customerId, customer.id);
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).customerId, customer.id);
  });

  it("die Suche nach dem Halter findet Fahrzeuge eingeschränkter Kunden nicht; der Export lässt sie aus", async () => {
    const { customer } = await customerWithData();
    const { vehicleTextWhere } = await import("@/modules/workshop/vehicles/queries");
    const find = () => env.db.vehicle.count({ where: { OR: vehicleTextWhere("beispiel") } });
    assert.equal(await find(), 1);
    await env.db.customer.update({ where: { id: customer.id }, data: { processingRestrictedAt: new Date() } });
    assert.equal(await find(), 0);

    await login(["customers.view", "customers.export"]);
    const csv = await (await exportRoute.GET(new NextRequest("http://localhost/api/exchange/customers", { headers: { "x-requested-with": "schrauberos", host: "localhost" } }), { params: Promise.resolve({ kind: "customers" }) })).text();
    assert.equal(csv.includes("Beispiel"), false);
  });
});

describe("Kundennummern", () => {
  it("doppelte Nummer: Warnung mit Verweis, mit Bestätigung gespeichert; Schreibweise und Leerraum zählen nicht; der Kunde selbst ist keine Dublette", async () => {
    await login(["customers.edit"]);
    await redirectOf(() => actions.saveCustomer({}, form({ lastName: "Eins", customerNumber: "K-7" })));
    const first = await env.db.customer.findFirstOrThrow();
    const dup = await actions.saveCustomer({}, form({ lastName: "Zwei", customerNumber: " k-7 " }));
    assert.ok(dup.fieldErrors?.customerNumber);
    assert.equal(dup.data?.duplicateId, first.id);
    assert.equal(await env.db.customer.count(), 1);
    assert.ok(await redirectOf(() => actions.saveCustomer({}, form({ lastName: "Zwei", customerNumber: " k-7 ", allowDuplicate: "1" }))));
    assert.equal(await env.db.customer.count(), 2);
    const { versionOf } = await import("@/lib/concurrency");
    await redirectOf(() => actions.saveCustomer({}, form({ lastName: "Drei", customerNumber: "K-9" })));
    const third = await env.db.customer.findFirstOrThrow({ where: { lastName: "Drei" } });
    assert.ok(await redirectOf(() => actions.saveCustomer({}, form({ id: third.id, version: versionOf(third), lastName: "Drei", customerNumber: "K-9", city: "Ort" }))), "die eigene Nummer beim Ändern ist keine Dublette");
    assert.ok((await actions.saveCustomer({}, form({ id: third.id, version: versionOf(await env.db.customer.findUniqueOrThrow({ where: { id: third.id } })), lastName: "Drei", customerNumber: "K-7" }))).fieldErrors?.customerNumber, "Ändern auf eine vorhandene Nummer warnt");
  });
});

describe("Aufbewahrungsfristen und Anonymisierung", () => {
  it("Fristen: nur Administratoren (settings.manage), Standard unbestätigt, eine Änderung nimmt die Bestätigung zurück, Audit", async () => {
    await login(["customers.privacy"]);
    assert.equal(await redirectOf(() => actions.confirmRetention(form({ confirmed: "1" }))), "/forbidden");
    await login([], true);
    assert.ok((await actions.savePrivacySettings({}, form({ retentionInvoiceYears: 0, retentionBooksYears: 10 }))).fieldErrors?.retentionInvoiceYears);
    assert.ok((await actions.savePrivacySettings({}, form({ retentionInvoiceYears: 8, retentionBooksYears: 31 }))).fieldErrors?.retentionBooksYears);
    await actions.confirmRetention(form({ confirmed: "1" }));
    const confirmed = await env.db.privacySettings.findUniqueOrThrow({ where: { id: "default" } });
    assert.ok(confirmed.retentionConfirmedAt);
    assert.ok(confirmed.retentionConfirmedByName);
    assert.equal(confirmed.retentionInvoiceYears, 8, "Standardwerte");
    assert.equal((await actions.savePrivacySettings({}, form({ retentionInvoiceYears: 10, retentionBooksYears: 10 }))).ok, true);
    assert.equal((await env.db.privacySettings.findUniqueOrThrow({ where: { id: "default" } })).retentionConfirmedAt, null, "Änderung nimmt die Bestätigung zurück");
    assert.deepEqual([(await env.db.auditLog.findMany({ where: { action: "settings.privacy" } })).length, (await env.db.auditLog.findMany({ where: { action: "settings.privacyConfirm" } })).length], [1, 1]);
  });

  it("gesperrt ohne Bestätigung; gesperrt, solange die Frist läuft; danach frei – Name, Kontakt, Notizen gelöscht, Fahrzeuge/Termine/Reifen bereinigt, Rechnungen behalten Empfänger und Verknüpfung", async () => {
    const { customer, vehicle, set, appointment } = await customerWithData();
    await login(ALL_PRIVACY, false);
    const anonymize = () => actions.anonymizeCustomer(form({ id: customer.id }));

    // unbestätigt
    await anonymize();
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id: customer.id } })).anonymizedAt, null);
    const flash = (await import("@/server/operations/flash")).decodeFlash(env.browser.writes.filter((w) => w.name === "so_flash").at(-1)?.value);
    assert.equal(flash?.key, "privacy.errors.anonymizeUnconfirmed");

    // bestätigt, aber die Frist der Rechnung von 2020 läuft (2020 + 8 = 2028-12-31); „heute“ ist vor dem Fristende nur, wenn es vor 2029 ist – deshalb Frist auf 30 Jahre
    await env.db.privacySettings.create({ data: { id: "default", retentionInvoiceYears: 30, retentionBooksYears: 30, retentionConfirmedAt: new Date(), retentionConfirmedByName: "Admin" } });
    await anonymize();
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id: customer.id } })).anonymizedAt, null);
    const running = (await import("@/server/operations/flash")).decodeFlash(env.browser.writes.filter((w) => w.name === "so_flash").at(-1)?.value);
    assert.equal(running?.key, "privacy.errors.anonymizeRunning");
    assert.equal(running?.params?.date, "2050-12-31");

    // Frist abgelaufen (Rechnung von 2020, Frist 1 Jahr)
    await env.db.privacySettings.update({ where: { id: "default" }, data: { retentionInvoiceYears: 1, retentionBooksYears: 1 } });
    assert.equal(await redirectOf(() => anonymize()), `/customers/${customer.id}`);

    const wiped = await env.db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.ok(wiped.anonymizedAt);
    assert.ok(wiped.archivedAt);
    assert.deepEqual(
      [wiped.firstName, wiped.company, wiped.email, wiped.phone, wiped.street, wiped.zip, wiped.city, wiped.notes, wiped.customerNumber, wiped.nameKey, wiped.cityKey, wiped.phoneKey, wiped.lastName],
      [null, null, null, null, null, null, null, null, null, "", "", "", "Anonymisiert"],
    );
    // Fahrzeuge: kein Halter, keine Notiz; Kennzeichen bleibt; Halterhistorie ohne Notiz und geschlossen
    const v = await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id }, include: { ownerships: true } });
    assert.deepEqual([v.customerId, v.notes, v.plate], [null, null, "B-AB 1"]);
    assert.deepEqual([v.ownerships.length, v.ownerships[0].note, v.ownerships[0].toDate !== null], [1, null, true]);
    // Termine: kein Kunde, keine Notiz, neutraler Titel; Zeit und Fahrzeug bleiben
    const a = await env.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.deepEqual([a.customerId, a.notes, a.title, a.vehicleId], [null, null, "(anonymisiert)", vehicle.id]);
    // Reifen: Notizen weg, Daten bleiben
    assert.equal((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).notes, null);
    assert.equal((await env.db.tire.findFirstOrThrow()).notes, null);
    assert.equal((await env.db.tireSet.findUniqueOrThrow({ where: { id: set.id } })).storageLocation, "Halle A");
    // Rechnung: Empfänger und Verknüpfung bleiben
    const invoice = await env.db.invoice.findFirstOrThrow();
    assert.deepEqual([invoice.partyName, invoice.customerId, invoice.grossCents], ["Erika Beispiel", customer.id, 11900]);
    // Audit ohne Namen; zweites Mal gesperrt
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "customer.anonymize" } });
    assert.equal(JSON.stringify(entry).includes("Beispiel"), false);
    assert.equal(entry.entityId, customer.id);
    await anonymize();
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.anonymize" } }), 1);
  });

  it("ohne das Recht customers.privacy wird nichts anonymisiert; ohne Rechnungen und mit Bestätigung sofort möglich", async () => {
    const customer = await env.db.customer.create({ data: { lastName: "Ohne Rechnung", nameKey: "ohne rechnung" } });
    await login(["customers.view", "customers.edit"]);
    assert.equal(await redirectOf(() => actions.anonymizeCustomer(form({ id: customer.id }))), "/forbidden");
    await env.db.privacySettings.create({ data: { id: "default", retentionConfirmedAt: new Date(), retentionConfirmedByName: "Admin" } });
    await login(["customers.privacy"]);
    await redirectOf(() => actions.anonymizeCustomer(form({ id: customer.id })));
    assert.ok((await env.db.customer.findUniqueOrThrow({ where: { id: customer.id } })).anonymizedAt);
  });

  it("ausgeschaltete Funktionen werden nicht bereinigt (Hooks laufen nur für aktive Funktionen)", async () => {
    const { customer, appointment } = await customerWithData();
    await env.db.privacySettings.create({ data: { id: "default", retentionInvoiceYears: 1, retentionBooksYears: 1, retentionConfirmedAt: new Date(), retentionConfirmedByName: "Admin" } });
    await env.db.featureSetting.create({ data: { key: "workshop.appointments", enabled: false } });
    await login(["customers.privacy"]);
    await redirectOf(() => actions.anonymizeCustomer(form({ id: customer.id })));
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).notes, "Rückruf unter 0171 123");
  });
});

describe("Auskunft", () => {
  const HEADERS = { "x-requested-with": "schrauberos", host: "localhost" };
  const csvOf = async (customerId: string) => {
    const response = await exportRoute.GET(new NextRequest(`http://localhost/api/exchange/customer-disclosure?customer=${customerId}`, { headers: HEADERS }), { params: Promise.resolve({ kind: "customer-disclosure" }) });
    return { status: response.status, text: (await response.text()).replace(/^﻿/, "") };
  };

  it("CSV: braucht customers.disclose und customers.view; enthält Stammdaten, Fahrzeuge, Halterhistorie, Termine, Reifen, Rechnungen und Freitexte; schützt vor Formeln; Audit", async () => {
    const { customer } = await customerWithData();
    await env.db.docPage.create({ data: { area: "handbook", title: "Kundenhinweise", slug: "kundenhinweise", content: "Frau Erika Beispiel mag keinen Anruf vor 9 Uhr." } });
    await login(["customers.view", "customers.export"]);
    assert.equal((await csvOf(customer.id)).status, 403);
    await login(["customers.disclose"]);
    assert.equal((await csvOf(customer.id)).status, 403, "ohne customers.view");

    await login(["customers.view", "customers.disclose"]);
    const { status, text } = await csvOf(customer.id);
    assert.equal(status, 200);
    for (const expected of [
      "Stammdaten", "Erika", "Beispiel", "erika@example.com", "Hauptstr. 1", "Mag Kaffee", // Stammdaten und Notizen
      "B-AB 1", "WVWZZZ1KZAW000001", "Kratzer links, Kundin sehr nett", // Fahrzeug mit Notiz
      "Halterhistorie", "Kauf privat", // Historie
      "Meier Inspektion", "Rückruf unter 0171 123", // Termin mit Notiz
      "Nagel im Reifen", "bei Kundin eingelagert", // Reifen
      "2020-0001", "119.00", "Barzahlung", // Rechnung
      "Fundstellen in der Dokumentation", "Kundenhinweise", // Dokumentation (nur Titel)
    ]) assert.ok(text.includes(expected), `fehlt: ${expected}`);
    assert.equal(text.includes("keinen Anruf"), false, "aus der Dokumentation nur Titel, nie Inhalt");
    // Formel-Schutz: die Notiz beginnt nicht mit =, enthält aber danach eine; eine Zelle mit = am Anfang wird entschärft
    await env.db.customer.update({ where: { id: customer.id }, data: { notes: "=HYPERLINK(\"http://böse\")" } });
    const guarded = await csvOf(customer.id);
    assert.ok(guarded.text.includes("'=HYPERLINK"), "Formel wird entschärft");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "customer.disclose" } });
    assert.match(entry.target ?? "", new RegExp(`^\\d+ Zeilen · ${customer.id}$`));
  });

  it("JSON: dieselben Daten als Datei zum Herunterladen, nur mit den Rechten, Audit; unbekannter Kunde 404", async () => {
    const { customer } = await customerWithData();
    const call = (id: string) => jsonRoute.GET(new NextRequest(`http://localhost/api/customers/${id}/disclosure`), { params: Promise.resolve({ id }) });
    env.signOut();
    assert.equal((await call(customer.id)).status, 401);
    await login(["customers.view", "customers.edit"]);
    assert.equal((await call(customer.id)).status, 403);
    await login(["customers.view", "customers.disclose"]);
    const response = await call(customer.id);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="auskunft-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const body = (await response.json()) as { customerId: string; sections: Array<{ id: string; title: string; records: Array<Record<string, { label: string; value: unknown }>> }> };
    assert.equal(body.customerId, customer.id);
    const ids = body.sections.map((s) => s.id);
    for (const id of ["customer", "vehicles", "ownerships", "appointments", "tireSets", "invoices"]) assert.ok(ids.includes(id), id);
    const stamm = body.sections.find((s) => s.id === "customer")!.records[0];
    assert.deepEqual([stamm.lastName.value, stamm.notes.label, stamm.email.value], ["Beispiel", "Notizen", "erika@example.com"]);
    assert.equal((await call("gibt-es-nicht")).status, 404);
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.disclose" } }), 1);
  });

  it("ausgeschaltete Funktionen liefern keine Daten (Termine aus): Abschnitt fehlt", async () => {
    const { customer } = await customerWithData();
    await env.db.featureSetting.create({ data: { key: "workshop.appointments", enabled: false } });
    await login(["customers.view", "customers.disclose"]);
    const { text } = await csvOf(customer.id);
    assert.equal(text.includes("Meier Inspektion"), false);
    assert.ok(text.includes("B-AB 1"));
  });
});
