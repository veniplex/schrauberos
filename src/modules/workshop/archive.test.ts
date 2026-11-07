import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { archivedWhere, archiveParam, nonZero, parseArchiveFilter } from "@/lib/archive-filter";
import { customerSearchKeys } from "@/modules/workshop/customers/domain";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Archiv und Löschschutz (P4b-2): Kunden und Fahrzeuge werden archiviert statt gelöscht, verschwinden aus Auswahl und Suche, sind per Filter auffindbar und wieder aktivierbar. */
let env: TestEnv;
let customerActions: typeof import("./customers/actions");
let vehicleActions: typeof import("./vehicles/actions");
let vehicleSearch: typeof import("@/app/api/vehicles/search/route");
let customerSearch: typeof import("@/app/api/customers/search/route");
let vehicleQueries: typeof import("./vehicles/queries");

before(async () => {
  env = await createTestEnv();
  customerActions = await import("./customers/actions");
  vehicleActions = await import("./vehicles/actions");
  vehicleSearch = await import("@/app/api/vehicles/search/route");
  customerSearch = await import("@/app/api/customers/search/route");
  vehicleQueries = await import("./vehicles/queries");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.appointment.deleteMany();
  await env.db.tireSet.deleteMany();
  await env.db.vehicleOwnership.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  const role = await env.role({
    key: `r-${Math.random()}`,
    permissions: ["customers.view", "customers.edit", "customers.delete", "vehicles.view", "vehicles.edit", "vehicles.delete", "appointments.view", "appointments.create", "tires.view"],
  });
  await env.signIn(await env.user({ username: "werkstatt", roles: [role] }));
});

const customer = (lastName: string, extra: Record<string, unknown> = {}) => env.db.customer.create({ data: { lastName, ...customerSearchKeys({ lastName }), ...extra } });
const vehicle = (plate: string, extra: Record<string, unknown> = {}) => env.db.vehicle.create({ data: { plate, plateNorm: plate.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ...extra } });
const get = async (handler: (r: never) => Promise<Response>, q: string) => {
  const response = await handler({ nextUrl: new URL(`http://localhost/x?q=${encodeURIComponent(q)}`) } as never);
  return (await response.json()) as { results: Array<{ id: string }> };
};

describe("Archivfilter (rein)", () => {
  it("Standard sind die aktiven; 1/only/archived/true die archivierten; all alle", () => {
    assert.equal(parseArchiveFilter(undefined), "active");
    assert.equal(parseArchiveFilter(""), "active");
    assert.equal(parseArchiveFilter("quatsch"), "active");
    for (const value of ["1", "only", "archived", "true"]) assert.equal(parseArchiveFilter(value), "archived");
    assert.equal(parseArchiveFilter("all"), "all");
    assert.deepEqual(archivedWhere("active"), { archivedAt: null });
    assert.deepEqual(archivedWhere("archived"), { archivedAt: { not: null } });
    assert.deepEqual(archivedWhere("all"), {});
    assert.deepEqual([archiveParam("active"), archiveParam("archived"), archiveParam("all")], [{}, { archived: "1" }, { archived: "all" }]);
    assert.deepEqual(nonZero([{ kind: "a", count: 0 }, { kind: "b", count: 2 }]), [{ kind: "b", count: 2 }]);
  });
});

describe("Kunden archivieren", () => {
  it("archiviert statt zu löschen: Fahrzeuge und Rechnungen bleiben, Audit, Wiederaktivieren; doppelt ist ein Fehler", async () => {
    const c = await customer("Halter");
    await vehicle("B-AB 1", { customerId: c.id });
    assert.equal(await redirectOf(() => customerActions.deleteCustomer(form({ id: c.id }))), null, "mit Fahrzeug nicht löschbar");
    assert.equal(await redirectOf(() => customerActions.archiveCustomer(form({ id: c.id }))), `/customers/${c.id}`);
    const archived = await env.db.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(archived.archivedAt);
    assert.equal(await env.db.vehicle.count({ where: { customerId: c.id } }), 1, "das Fahrzeug bleibt am Kunden");
    assert.equal(await redirectOf(() => customerActions.archiveCustomer(form({ id: c.id }))), null, "doppelt: Meldung statt Weiterleitung");
    assert.equal(await redirectOf(() => customerActions.unarchiveCustomer(form({ id: c.id }))), `/customers/${c.id}`);
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id: c.id } })).archivedAt, null);
    assert.deepEqual((await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action), ["customer.archive", "customer.unarchive"]);
  });

  it("braucht customers.edit", async () => {
    const c = await customer("Bleibt");
    await env.signIn(await env.user({ username: "nur-lesen", roles: [await env.role({ permissions: ["customers.view"] })] }));
    assert.equal(await redirectOf(() => customerActions.archiveCustomer(form({ id: c.id }))), "/forbidden");
    assert.equal((await env.db.customer.findUniqueOrThrow({ where: { id: c.id } })).archivedAt, null);
  });

  it("archivierte Kunden fehlen in der Auswahl-Suche und der Schnellsuche, bleiben aber im Archiv-Filter", async () => {
    const live = await customer("Meier-Aktiv");
    const old = await customer("Meier-Alt", { archivedAt: new Date() });
    assert.deepEqual((await get(customerSearch.GET, "Meier")).results.map((r) => r.id), [live.id]);
    const providers = await import("./customers/search");
    const found = await providers.searchProviders[0].search("Meier", { limit: 10 } as never);
    assert.deepEqual(found.map((r) => r.id), [live.id]);
    const queries = await import("./customers/queries");
    const session = await (await import("@/server/auth/session")).getSession();
    const where = (filter: "active" | "archived" | "all") => queries.listCustomers(session!, { where: archivedWhere(filter), orderBy: [{ lastName: "asc" }] });
    assert.deepEqual((await where("active")).map((c) => c.id), [live.id]);
    assert.deepEqual((await where("archived")).map((c) => c.id), [old.id]);
    assert.equal((await where("all")).length, 2);
  });
});

describe("Fahrzeuge archivieren und löschen", () => {
  it("archivieren und wieder aktivieren; archivierte stehen nicht in Suche, Auswahl, Prüffrist-Baustein, wohl aber im Filter", async () => {
    const v = await vehicle("B-AB 7", { inspectionDue: "2020-01" });
    const live = await vehicle("B-AB 8", { inspectionDue: "2020-01" });
    assert.equal(await redirectOf(() => vehicleActions.archiveVehicle(form({ id: v.id }))), `/vehicles/${v.id}`);
    assert.ok((await env.db.vehicle.findUniqueOrThrow({ where: { id: v.id } })).archivedAt);
    assert.deepEqual((await get(vehicleSearch.GET, "BAB")).results.map((r) => r.id), [live.id]);
    const providers = await import("./vehicles/search");
    assert.deepEqual((await providers.searchProviders[0].search("BAB", { limit: 10 } as never)).map((r) => r.id), [live.id]);
    const can = () => true;
    const idsOf = async (archived?: "active" | "archived" | "all") =>
      (await env.db.vehicle.findMany({ where: vehicleQueries.vehicleListWhere({ q: "", noOwnerOnly: false, archived }, can, "2026-11") })).map((x) => x.id).sort();
    assert.deepEqual(await idsOf(), [live.id]);
    assert.deepEqual(await idsOf("archived"), [v.id]);
    assert.deepEqual(await idsOf("all"), [live.id, v.id].sort());
    assert.deepEqual((await env.db.vehicle.findMany({ where: vehicleQueries.attentionWhere("2026-11") })).map((x) => x.id), [live.id], "der Baustein „Prüffrist“ zeigt keine archivierten");
    assert.equal(await redirectOf(() => vehicleActions.unarchiveVehicle(form({ id: v.id }))), `/vehicles/${v.id}`);
    assert.equal((await get(vehicleSearch.GET, "BAB")).results.length, 2);
  });

  it("Löschen nur ohne Geschichte: Termin, Reifensatz oder Halterwechsel sperren; ein versehentlich angelegtes Fahrzeug samt erstem Halter geht", async () => {
    const owner = await customer("Halter");
    const other = await customer("Neu");
    const withAppointment = await vehicle("B-AB 20");
    await env.db.appointment.create({ data: { title: "T", startsAt: new Date("2030-01-01T08:00:00Z"), endsAt: new Date("2030-01-01T09:00:00Z"), vehicleId: withAppointment.id } });
    const withTires = await vehicle("B-AB 21");
    await env.db.tireSet.create({ data: { vehicleId: withTires.id, season: "winter" } });
    const transferred = await vehicle("B-AB 22", { customerId: owner.id, ownerships: { create: [{ customerId: owner.id }] } });
    await redirectOf(() => vehicleActions.transferVehicle({}, form({ vehicleId: transferred.id, newCustomerId: other.id, date: "2026-05-01" })));
    for (const v of [withAppointment, withTires, transferred]) {
      assert.equal(await redirectOf(() => vehicleActions.deleteVehicle(form({ id: v.id }))), null, v.plate);
      assert.equal(await env.db.vehicle.count({ where: { id: v.id } }), 1, v.plate);
    }
    assert.equal(await env.db.vehicleOwnership.count({ where: { vehicleId: transferred.id } }), 2, "die Halter-Historie bleibt");
    assert.equal(await env.db.auditLog.count({ where: { action: "vehicle.delete" } }), 0);

    const mistake = await vehicle("B-AB 23", { customerId: owner.id, ownerships: { create: [{ customerId: owner.id }] } });
    assert.equal(await redirectOf(() => vehicleActions.deleteVehicle(form({ id: mistake.id }))), "/vehicles");
    assert.equal(await env.db.vehicle.count({ where: { id: mistake.id } }), 0);
    assert.equal(await env.db.vehicleOwnership.count({ where: { vehicleId: mistake.id } }), 0);
  });

  it("das Schema löscht die Halter-Historie nicht mit (Restrict): direkt in der Datenbank scheitert das Löschen eines Fahrzeugs mit Historie", async () => {
    const owner = await customer("Halter");
    const v = await vehicle("B-AB 30", { customerId: owner.id, ownerships: { create: [{ customerId: owner.id }] } });
    await assert.rejects(() => env.db.vehicle.delete({ where: { id: v.id } }));
    assert.equal(await env.db.vehicleOwnership.count({ where: { vehicleId: v.id } }), 1);
  });
});

describe("Kennzeichen-Dublette: Altfahrzeug archivieren", () => {
  const save = (fields: Record<string, string>) => vehicleActions.saveVehicle({}, form(fields));

  it("ein archiviertes Fahrzeug zählt nicht als Dublette", async () => {
    await vehicle("B-AB 40", { archivedAt: new Date() });
    assert.ok(await redirectOf(() => save({ plate: "B-AB 40" })));
    assert.equal(await env.db.vehicle.count({ where: { plateNorm: "BAB40" } }), 2);
  });

  it("archiveDuplicate archiviert das vorhandene Fahrzeug und speichert das neue – in einer Transaktion, mit Audit für beide", async () => {
    const owner = await customer("Alt-Halter");
    const old = await vehicle("B-AB 41", { customerId: owner.id });
    const warning = await save({ plate: "B-AB 41" });
    assert.equal(warning.data?.duplicateId, old.id);
    assert.ok(await redirectOf(() => save({ plate: "B-AB 41", archiveDuplicate: "1" })));
    const all = await env.db.vehicle.findMany({ where: { plateNorm: "BAB41" }, orderBy: { createdAt: "asc" } });
    assert.equal(all.length, 2);
    assert.ok(all[0].archivedAt, "das Altfahrzeug ist archiviert");
    assert.equal(all[0].id, old.id);
    assert.equal(all[1].archivedAt, null, "das neue ist aktiv");
    const actions = (await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    assert.deepEqual(actions.sort(), ["vehicle.archive", "vehicle.create"]);
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "vehicle.create" } })).target ?? "", /Altfahrzeug archiviert/);
    assert.ok((await save({ plate: "B-AB 41" })).data?.duplicateId, "jetzt gibt es wieder genau ein aktives Fahrzeug mit dem Kennzeichen: die Warnung kommt wieder");
  });

  it("archiveDuplicate ohne vorhandenes Fahrzeug ändert nichts; ohne vehicles.edit geht nichts", async () => {
    assert.ok(await redirectOf(() => save({ plate: "B-AB 42", archiveDuplicate: "1" })));
    assert.equal(await env.db.vehicle.count({ where: { archivedAt: { not: null } } }), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: "vehicle.archive" } }), 0);
    const old = await vehicle("B-AB 43");
    await env.signIn(await env.user({ username: "nur-sehen", roles: [await env.role({ permissions: ["vehicles.view"] })] }));
    assert.equal(await redirectOf(() => save({ plate: "B-AB 43", archiveDuplicate: "1" })), "/forbidden");
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: old.id } })).archivedAt, null);
  });
});

describe("CSV-Export mit Archiv-Filter", () => {
  it("Standard nur aktive; archived=1 nur archivierte; archived=all alle – bei Kunden und Fahrzeugen", async () => {
    await customer("Aktiv");
    await customer("Archiv", { archivedAt: new Date() });
    await vehicle("B-AB 50");
    await vehicle("B-AB 51", { archivedAt: new Date() });
    const session = (await (await import("@/server/auth/session")).getSession())!;
    const count = async (def: { open(c: never): Promise<unknown> }, query: string) => ((await def.open({ session, query: new URLSearchParams(query), format: {}, t: (k: string) => k } as never)) as { count: number }).count;
    const customers = (await import("./customers/exchange")).customersExport;
    const vehicles = (await import("./vehicles/exchange")).vehiclesExport;
    assert.deepEqual([await count(customers, ""), await count(customers, "archived=1"), await count(customers, "archived=all")], [1, 1, 2]);
    assert.deepEqual([await count(vehicles, ""), await count(vehicles, "archived=1"), await count(vehicles, "archived=all")], [1, 1, 2]);
  });
});
