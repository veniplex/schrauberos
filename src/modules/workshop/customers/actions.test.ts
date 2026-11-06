import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Kunden im Aktions-Rahmen: Audit beim Anlegen/Ändern, Konflikt, Löschen nur ohne Fahrzeuge, Halter-Historie und Rechnungen. */
let env: TestEnv;
let actions: typeof import("./actions");
let decodeFlash: typeof import("@/server/operations/flash").decodeFlash;

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  ({ decodeFlash } = await import("@/server/operations/flash"));
});
after(() => env.cleanup());

const lastFlash = () => {
  const write = env.browser.writes.filter((w) => w.name === "so_flash").at(-1);
  return write ? decodeFlash(write.value) : null;
};

beforeEach(async () => {
  await env.db.invoice.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  const role = await env.role({ key: `r-${Math.random()}`, permissions: ["customers.view", "customers.edit", "customers.delete"] });
  await env.signIn(await env.user({ username: "tresen", roles: [role] }));
});

describe("saveCustomer", () => {
  it("legt einen Kunden an und protokolliert ihn", async () => {
    const target = await redirectOf(() => actions.saveCustomer({}, form({ firstName: "Anna", lastName: "Müller", email: "anna@example.org" })));
    const c = await env.db.customer.findFirstOrThrow();
    assert.equal(target, `/customers/${c.id}`);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "customer.create" } });
    assert.equal(entry.target, "Anna Müller");
    assert.equal(entry.entityId, c.id);
  });

  it("Firmenkunden: Firmenname dient als Nachname; ohne Name oder Firma gibt es einen Feldfehler", async () => {
    await redirectOf(() => actions.saveCustomer({}, form({ company: "Auto GmbH" })));
    assert.equal((await env.db.customer.findFirstOrThrow()).lastName, "Auto GmbH");
    assert.ok((await actions.saveCustomer({}, form({ phone: "123" }))).fieldErrors?.lastName);
    assert.ok((await actions.saveCustomer({}, form({ lastName: "X", email: "kaputt" }))).fieldErrors?.email);
  });

  it("ändern mit Version: zweite Speicherung mit alter Version meldet Konflikt, nichts geht verloren", async () => {
    await redirectOf(() => actions.saveCustomer({}, form({ lastName: "Alt" })));
    const c = await env.db.customer.findFirstOrThrow();
    const { versionOf } = await import("@/lib/concurrency");
    const version = versionOf(c);
    assert.ok(await redirectOf(() => actions.saveCustomer({}, form({ id: c.id, version, lastName: "Neu" }))));
    const stale = await actions.saveCustomer({}, form({ id: c.id, version, lastName: "Überschrieben" }));
    assert.ok(stale.error);
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id: c.id } })).lastName, "Neu");
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.update" } }), 1);
  });
});

describe("deleteCustomer", () => {
  it("löscht einen Kunden ohne Verknüpfungen, protokolliert und meldet es", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Weg" } });
    assert.equal(await redirectOf(() => actions.deleteCustomer(form({ id: c.id }))), "/customers");
    assert.equal(await env.db.customer.count(), 0);
    assert.equal((await env.db.auditLog.findFirstOrThrow({ where: { action: "customer.delete" } })).target, "Weg");
    assert.equal(lastFlash()?.key, "common.deleted");
  });

  it("löscht keinen Kunden mit Fahrzeug, Halter-Historie oder Rechnung", async () => {
    const withVehicle = await env.db.customer.create({ data: { lastName: "Halter" } });
    await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", customerId: withVehicle.id } });
    const history = await env.db.customer.create({ data: { lastName: "Früher" } });
    const old = await env.db.vehicle.create({ data: { plate: "B-AB 2", plateNorm: "BAB2" } });
    await env.db.vehicleOwnership.create({ data: { vehicleId: old.id, customerId: history.id, toDate: new Date() } });
    const billed = await env.db.customer.create({ data: { lastName: "Rechnung" } });
    await env.db.invoice.create({ data: { direction: "outgoing", number: "1", outgoingKey: "1", partyName: "Rechnung", customerId: billed.id, issueDate: new Date(), grossCents: 100 } });

    for (const c of [withVehicle, history, billed]) {
      assert.equal(await redirectOf(() => actions.deleteCustomer(form({ id: c.id }))), null, "bleibt auf der Seite");
      assert.equal(lastFlash()?.key, "customers.errors.inUse");
      assert.equal(await env.db.customer.count({ where: { id: c.id } }), 1);
    }
    assert.equal(await env.db.auditLog.count({ where: { action: "customer.delete" } }), 0);
  });

  it("das Schema schützt zusätzlich (Restrict): auch direkt in der Datenbank ist das Löschen nicht möglich", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Halter" } });
    await env.db.vehicle.create({ data: { plate: "B-AB 3", plateNorm: "BAB3", customerId: c.id } });
    await assert.rejects(() => env.db.customer.delete({ where: { id: c.id } }));
    const h = await env.db.customer.create({ data: { lastName: "Historie" } });
    const v = await env.db.vehicle.create({ data: { plate: "B-AB 4", plateNorm: "BAB4" } });
    await env.db.vehicleOwnership.create({ data: { vehicleId: v.id, customerId: h.id } });
    await assert.rejects(() => env.db.customer.delete({ where: { id: h.id } }));
  });

  it("ohne Recht customers.delete wird nichts gelöscht", async () => {
    const c = await env.db.customer.create({ data: { lastName: "Bleibt" } });
    await env.signIn(await env.user({ username: "nur-bearbeiten", roles: [await env.role({ permissions: ["customers.edit"] })] }));
    assert.equal(await redirectOf(() => actions.deleteCustomer(form({ id: c.id }))), "/forbidden");
    assert.equal(await env.db.customer.count({ where: { id: c.id } }), 1);
  });
});
