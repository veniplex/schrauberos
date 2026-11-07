import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Auswahl-Suchen (Richtlinie D7): Der Anzeigename des Kunden ist in Termin-, Fahrzeug- und Reifenkontext sichtbar;
 * Kontaktdaten, Adresse und Notizen nur mit `customers.view`.
 */
let env: TestEnv;
let vehicles: typeof import("./vehicles/search/route");
let customers: typeof import("./customers/search/route");

before(async () => {
  env = await createTestEnv();
  vehicles = await import("./vehicles/search/route");
  customers = await import("./customers/search/route");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  env.signOut();
  const customer = await env.db.customer.create({
    data: { firstName: "Erika", lastName: "Mustermann", email: "erika@example.org", phone: "0123 456", street: "Hauptstr. 1", zip: "10115", city: "Berlin", notes: "zahlt schlecht", customerNumber: "K-7" },
  });
  await env.db.vehicle.create({ data: { plate: "B AB 123", plateNorm: "BAB123", make: "VW", model: "Golf", customerId: customer.id } });
});

const as = async (permissions: string[]) => {
  await env.signIn(await env.user({ username: `u${Math.random()}`, roles: [await env.role({ permissions })] }));
};
const get = async (handler: (r: never) => Promise<Response>, q: string) => {
  const response = await handler({ nextUrl: new URL(`http://localhost/x?q=${encodeURIComponent(q)}`) } as never);
  return { status: response.status, body: (await response.json()) as { results: Array<Record<string, unknown>> } };
};

describe("Fahrzeugsuche", () => {
  it("liefert den Kunden nur als Anzeigename – auch bei einem Recht ohne customers.view", async () => {
    await as(["appointments.view", "appointments.create"]);
    const { status, body } = await get(vehicles.GET, "BAB");
    assert.equal(status, 200);
    assert.equal(body.results.length, 1);
    assert.deepEqual(Object.keys(body.results[0]).sort(), ["customer", "description", "id", "label", "plate", "sublabel"]);
    assert.equal(body.results[0].customer, "Erika Mustermann");
    assert.equal(JSON.stringify(body).includes("erika@example.org"), false);
    assert.equal(JSON.stringify(body).includes("Berlin"), false);
  });

  it("ohne passendes Recht: 403, ohne Sitzung: 401", async () => {
    await as(["invoices.view"]);
    assert.equal((await get(vehicles.GET, "BAB")).status, 403);
    env.signOut();
    assert.equal((await get(vehicles.GET, "BAB")).status, 401);
  });
});

describe("Kundensuche", () => {
  it("mit customers.view auch Wohnort durchsuchen und anzeigen", async () => {
    await as(["customers.view"]);
    const { body } = await get(customers.GET, "Berlin");
    assert.equal(body.results.length, 1);
    assert.match(String(body.results[0].sublabel), /Berlin/);
  });

  it("ohne customers.view (nur invoices.edit): Wohnort weder Suchtreffer noch Anzeige, Kontaktdaten nie", async () => {
    await as(["invoices.edit"]);
    assert.equal((await get(customers.GET, "Berlin")).body.results.length, 0);
    const { body } = await get(customers.GET, "Muster");
    assert.equal(body.results.length, 1);
    assert.equal(JSON.stringify(body).includes("Berlin"), false);
    assert.equal(JSON.stringify(body).includes("erika@example.org"), false);
    assert.match(String(body.results[0].sublabel), /K-7/);
  });
});
