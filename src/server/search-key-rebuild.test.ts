import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { SEARCH_KEY_VERSION, phoneKey, searchKey } from "@/lib/search-key";
import { normalizePlate } from "@/lib/plate";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Nachziehen der Suchspalten (Z7): Version des Algorithmus im Code, gespeicherte Version je Tabelle, blockweise und wiederholbar, ohne `updatedAt` zu ändern. */
let env: TestEnv;
let rebuild: typeof import("@/server/search-key-rebuild");
let customers: typeof import("@/modules/workshop/customers/key-rebuild");
let vehicles: typeof import("@/modules/workshop/vehicles/key-rebuild");
let parts: typeof import("@/modules/workshop/parts/key-rebuild");
let invoices: typeof import("@/modules/office/invoices/key-rebuild");
let registry: typeof import("@/server/jobs/registry");

before(async () => {
  env = await createTestEnv();
  rebuild = await import("@/server/search-key-rebuild");
  customers = await import("@/modules/workshop/customers/key-rebuild");
  vehicles = await import("@/modules/workshop/vehicles/key-rebuild");
  parts = await import("@/modules/workshop/parts/key-rebuild");
  invoices = await import("@/modules/office/invoices/key-rebuild");
  registry = await import("@/server/jobs/registry");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.appSetting.deleteMany();
  await env.db.invoice.deleteMany();
  await env.db.article.deleteMany();
  await env.db.tireSet.deleteMany();
  await env.db.vehicleOwnership.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.customer.deleteMany();
});

async function staleCustomers(n: number) {
  for (let i = 0; i < n; i++) {
    await env.db.customer.create({ data: { lastName: `Müller${i}`, firstName: "Jörg", city: "Köln", phone: "+49 171 12345", nameKey: "alt", cityKey: "alt", phoneKey: "alt" } });
  }
}

describe("Suchspalten nachziehen", () => {
  it("der Code steht auf Version 1; ohne gespeicherte Version gilt Version 1 – eine frische oder aktuelle Installation hat nichts zu tun", async () => {
    assert.equal(SEARCH_KEY_VERSION, 1);
    assert.equal(await rebuild.storedKeyVersion("customers"), 1);
    assert.equal(await rebuild.searchKeysStale("customers"), false);
    await staleCustomers(2);
    const result = await rebuild.rebuildSearchKeys({ id: "customers", step: customers.rebuildCustomerKeys });
    assert.deepEqual(result, { done: true, scanned: 0, changed: 0 });
    assert.equal((await env.db.customer.findFirstOrThrow()).nameKey, "alt", "bei gleicher Version bleibt alles, wie es ist");
  });

  it("eine höhere Version im Code rechnet die Spalten aller Zeilen neu, lässt updatedAt unverändert und hebt die gespeicherte Version an", async () => {
    await staleCustomers(5);
    const before = await env.db.customer.findMany({ orderBy: { id: "asc" } });
    assert.equal(await rebuild.searchKeysStale("customers", 2), true);
    const result = await rebuild.rebuildSearchKeys({ id: "customers", step: customers.rebuildCustomerKeys, version: 2, batch: 2 });
    assert.deepEqual(result, { done: true, scanned: 5, changed: 5 });
    const after = await env.db.customer.findMany({ orderBy: { id: "asc" } });
    for (const [i, row] of after.entries()) {
      assert.equal(row.nameKey, searchKey("Jörg", `Müller${before[i]!.lastName.slice(6)}`), "Namensschlüssel neu");
      assert.equal(row.cityKey, searchKey("Köln"));
      assert.equal(row.phoneKey, phoneKey("+49 171 12345"));
      assert.equal(row.updatedAt.getTime(), before[i]!.updatedAt.getTime(), "kein Konflikt für offene Bearbeiten-Formulare");
    }
    assert.equal(await rebuild.storedKeyVersion("customers"), 2);
    assert.equal(await env.db.appSetting.count({ where: { key: rebuild.searchKeyCursorSetting("customers") } }), 0, "Cursor verworfen");
    // idempotent: noch einmal nichts zu tun
    assert.deepEqual(await rebuild.rebuildSearchKeys({ id: "customers", step: customers.rebuildCustomerKeys, version: 2 }), { done: true, scanned: 0, changed: 0 });
  });

  it("ein abgebrochener Lauf macht beim Cursor weiter (Zeitbudget/Abbruch), der Rest folgt beim nächsten Lauf", async () => {
    await staleCustomers(7);
    let t = 0;
    const clock = () => t;
    // genau ein Block pro Lauf: die Uhr springt nach dem ersten Schritt über das Budget
    const slowStep: import("@/server/search-key-rebuild").KeyRebuildStep = async (cursor, limit) => {
      const r = await customers.rebuildCustomerKeys(cursor, limit);
      t += 1000;
      return r;
    };
    const first = await rebuild.rebuildSearchKeys({ id: "customers", step: slowStep, version: 2, batch: 3, budgetMs: 500, now: clock });
    assert.deepEqual([first.done, first.scanned, first.changed], [false, 3, 3]);
    assert.equal(await rebuild.storedKeyVersion("customers"), 1, "noch nicht fertig: Version unverändert");
    assert.ok(await env.db.appSetting.findUnique({ where: { key: rebuild.searchKeyCursorSetting("customers") } }), "Cursor gemerkt");
    assert.equal(await env.db.customer.count({ where: { nameKey: "alt" } }), 4);

    const second = await rebuild.rebuildSearchKeys({ id: "customers", step: slowStep, version: 2, batch: 3, budgetMs: 500, now: clock });
    assert.deepEqual([second.done, second.scanned], [false, 3]);
    const third = await rebuild.rebuildSearchKeys({ id: "customers", step: customers.rebuildCustomerKeys, version: 2, batch: 3 });
    assert.deepEqual([third.done, third.scanned, third.changed], [true, 1, 1]);
    assert.equal(await env.db.customer.count({ where: { nameKey: "alt" } }), 0);
    assert.equal(await rebuild.storedKeyVersion("customers"), 2);
  });

  it("Fahrzeuge, Artikel und Rechnungen: jede Tabelle hat ihren Schritt und ihre eigene Version", async () => {
    await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "alt", make: "VW", model: "Käfer", vin: "ABC", searchKey: "alt" } });
    await env.db.article.create({ data: { number: "A-1", name: "Bremsscheibe", supplier: "Müller & Söhne", unit: "Stk", searchKey: "alt" } });
    await env.db.invoice.create({ data: { direction: "incoming", number: "R-1", partyName: "Müller & Söhne", partyKey: "alt", issueDate: new Date(), grossCents: 100 } });
    const v = await rebuild.rebuildSearchKeys({ id: "vehicles", step: vehicles.rebuildVehicleKeys, version: 2 });
    const a = await rebuild.rebuildSearchKeys({ id: "articles", step: parts.rebuildArticleKeys, version: 2 });
    const i = await rebuild.rebuildSearchKeys({ id: "invoices", step: invoices.rebuildInvoiceKeys, version: 2 });
    assert.deepEqual([v.changed, a.changed, i.changed], [1, 1, 1]);
    const vehicle = await env.db.vehicle.findFirstOrThrow();
    assert.deepEqual([vehicle.plateNorm, vehicle.searchKey], [normalizePlate("B-AB 1234"), searchKey("VW", "Käfer", "ABC")]);
    assert.equal((await env.db.article.findFirstOrThrow()).searchKey, searchKey("A-1", "Bremsscheibe", "Müller & Söhne"));
    assert.equal((await env.db.invoice.findFirstOrThrow()).partyKey, searchKey("Müller & Söhne"));
    assert.deepEqual(await Promise.all(["vehicles", "articles", "invoices", "customers"].map((id) => rebuild.storedKeyVersion(id))), [2, 2, 2, 1]);
  });

  it("die Jobs sind bei den Funktionen angemeldet und laufen nur bei veralteter Version (shouldRun)", async () => {
    const mine = registry.allJobs().filter((j) => j.id.endsWith(".search-keys"));
    assert.deepEqual(mine.map((j) => `${j.id}:${j.feature}`).sort(), ["customers.search-keys:workshop.customers", "invoices.search-keys:office.invoices", "parts.search-keys:workshop.parts", "vehicles.search-keys:workshop.vehicles"]);
    for (const job of mine) assert.equal(await job.shouldRun?.({ now: new Date() }), false, `${job.id}: Version aktuell, kein Lauf`);
    await env.db.appSetting.create({ data: { key: rebuild.searchKeyVersionSetting("customers"), value: "0" } });
    assert.equal(await rebuild.storedKeyVersion("customers"), 1, "ungültige Werte gelten als Version 1");
  });
});
