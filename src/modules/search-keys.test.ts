import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Normalisierte Suchspalten (P2b-1): Kunden, Fahrzeuge und Rechnungspartner pflegen sie in der Operation; die Suche (Liste, Schnellsuche, API) findet Umlaute,
 * Groß-/Kleinschreibung und Trenner in Namen, Kennzeichen und Telefonnummern.
 */
let env: TestEnv;
let customerActions: typeof import("./workshop/customers/actions");
let vehicleActions: typeof import("./workshop/vehicles/actions");
let invoiceActions: typeof import("./office/invoices/actions");
let customerQueries: typeof import("./workshop/customers/queries");
let vehicleQueries: typeof import("./workshop/vehicles/queries");
let invoiceQueries: typeof import("./office/invoices/queries");

before(async () => {
  env = await createTestEnv();
  customerActions = await import("./workshop/customers/actions");
  vehicleActions = await import("./workshop/vehicles/actions");
  invoiceActions = await import("./office/invoices/actions");
  customerQueries = await import("./workshop/customers/queries");
  vehicleQueries = await import("./workshop/vehicles/queries");
  invoiceQueries = await import("./office/invoices/queries");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.invoice.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  const role = await env.role({
    key: `r-${Math.random()}`,
    permissions: ["customers.view", "customers.edit", "vehicles.view", "vehicles.edit", "invoices.view", "invoices.edit"],
  });
  await env.signIn(await env.user({ username: "tresen", roles: [role] }));
});

const customerHits = async (q: string) =>
  (await env.db.customer.findMany({ where: { OR: customerQueries.customerSearchFields.map((f) => f.where(q)) }, select: { lastName: true } })).map((c) => c.lastName);
const vehicleHits = async (q: string) =>
  (await env.db.vehicle.findMany({ where: { OR: vehicleQueries.vehicleTextWhere(q) }, select: { plate: true } })).map((v) => v.plate);
const invoiceHits = async (q: string) =>
  (await env.db.invoice.findMany({ where: { OR: invoiceQueries.invoiceTextWhere(q) }, select: { number: true } })).map((i) => i.number);

describe("Kunden", () => {
  beforeEach(async () => {
    await redirectOf(() => customerActions.saveCustomer({}, form({ firstName: "Hans-Peter", lastName: "Müller", city: "Köln", phone: "0171/123 456", email: "hp@example.org", customerNumber: "K-1001" })));
    await redirectOf(() => customerActions.saveCustomer({}, form({ company: "Straße & Söhne GmbH", city: "Düsseldorf", phone: "+49 211 99 88 77" })));
    await redirectOf(() => customerActions.saveCustomer({}, form({ lastName: "Meier", city: "Bonn", phone: "030 555010" })));
  });

  it("Umlaute, Großschreibung und Schreibweise ohne Punkte finden denselben Kunden", async () => {
    for (const q of ["MÜLLER", "müller", "mueller", "MUELLER", "Muller"]) assert.deepEqual(await customerHits(q), ["Müller"], q);
  });

  it("Wörter in beliebiger Reihenfolge, Bindestrich und Leerzeichen gleich", async () => {
    for (const q of ["hans peter", "peter hans", "Hans-Peter Müller", "müller, hans"]) assert.deepEqual(await customerHits(q), ["Müller"], q);
  });

  it("ß/ss und Ort mit Umlaut", async () => {
    assert.deepEqual(await customerHits("strasse"), ["Straße & Söhne GmbH"]);
    assert.deepEqual(await customerHits("STRAßE soehne"), ["Straße & Söhne GmbH"]);
    assert.deepEqual(await customerHits("koeln"), ["Müller"]);
    assert.deepEqual(await customerHits("duesseldorf"), ["Straße & Söhne GmbH"]);
  });

  it("Telefonnummer: Trenner und Landesvorwahl egal, erst ab drei Ziffern", async () => {
    assert.deepEqual(await customerHits("0171 123456"), ["Müller"]);
    assert.deepEqual(await customerHits("+49 171 123 456"), ["Müller"]);
    assert.deepEqual(await customerHits("0211-998877"), ["Straße & Söhne GmbH"]);
    assert.deepEqual(await customerHits("12"), [], "zwei Ziffern sind keine Telefonnummer");
  });

  it("Kundennummer und E-Mail wie bisher", async () => {
    assert.deepEqual(await customerHits("K-1001"), ["Müller"]);
    assert.deepEqual(await customerHits("hp@example"), ["Müller"]);
  });

  it("Platzhalter und reine Trenner finden nichts statt alles", async () => {
    assert.deepEqual(await customerHits("%%"), []);
    assert.deepEqual(await customerHits("__"), []);
    assert.deepEqual(await customerHits("- ."), []);
  });

  it("Ändern pflegt die Spalten mit (alter Name nicht mehr, neuer Name gefunden)", async () => {
    const c = await env.db.customer.findFirstOrThrow({ where: { lastName: "Meier" } });
    await redirectOf(() => customerActions.saveCustomer({}, form({ id: c.id, version: String(c.updatedAt.getTime()), lastName: "Böhm", city: "Bonn", phone: "030 555010" })));
    assert.deepEqual(await customerHits("meier"), []);
    assert.deepEqual(await customerHits("boehm"), ["Böhm"]);
  });
});

describe("Fahrzeuge", () => {
  beforeEach(async () => {
    const owner = await redirectOf(() => customerActions.saveCustomer({}, form({ firstName: "Anna", lastName: "Böhm" })));
    const customer = await env.db.customer.findFirstOrThrow({ where: { lastName: "Böhm" } });
    assert.ok(owner);
    await redirectOf(() => vehicleActions.saveVehicle({}, form({ plate: "B-AB 1234", make: "Citroën", model: "C3 Aircross", customerId: customer.id })));
    await redirectOf(() => vehicleActions.saveVehicle({}, form({ plate: "HVL-JK 77", make: "Opel", model: "Astra K" })));
  });

  it("Kennzeichen mit Leerzeichen/Bindestrich und beliebiger Schreibung", async () => {
    for (const q of ["b ab 1234", "BAB1234", "b-ab1234", "ab 12"]) assert.deepEqual(await vehicleHits(q), ["B-AB 1234"], q);
  });

  it("Marke und Modell ohne Akzent und Großschreibung; Halter über seinen Namen", async () => {
    assert.deepEqual(await vehicleHits("CITROEN"), ["B-AB 1234"]);
    assert.deepEqual(await vehicleHits("c3 aircross"), ["B-AB 1234"]);
    assert.deepEqual(await vehicleHits("boehm"), ["B-AB 1234"]);
    assert.deepEqual(await vehicleHits("Astra"), ["HVL-JK 77"]);
  });
});

describe("Rechnungspartner", () => {
  it("Umlaute und Schreibung beim Geschäftspartner", async () => {
    const base = { direction: "incoming", issueDate: "2026-03-14", gross: "119,00", net: "100,00", vat: "19,00" };
    await redirectOf(() => invoiceActions.saveInvoice({}, form({ ...base, number: "RE-1", partyName: "Autoteile Müller" })));
    await redirectOf(() => invoiceActions.saveInvoice({}, form({ ...base, number: "RE-2", partyName: "Büro-Bedarf Schmitt" })));
    assert.deepEqual(await invoiceHits("MUELLER"), ["RE-1"]);
    assert.deepEqual(await invoiceHits("autoteile müller"), ["RE-1"]);
    assert.deepEqual(await invoiceHits("buero bedarf"), ["RE-2"]);
    assert.deepEqual(await invoiceHits("RE-2"), ["RE-2"]);
  });
});
