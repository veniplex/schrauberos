import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { makePng } from "@/test/png";
import type { AppSession } from "@/server/auth/session";
import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Werkstattaufträge gegen eine echte temporäre SQLite: Zähler (lückenlos, gleichzeitig), Statuskette, atomarer Abschluss mit Hooks (schlägt einer fehl: nichts gebucht, Auftrag offen),
 * Wiederöffnen, Kilometerstand, Konflikt, Freigabe-Protokoll, Terminstatus per Hook, Preise für Mechaniker.
 */
let env: TestEnv;
let logged: PrismaClient;
let sql: string[] = [];
let ops: typeof import("./operations");
let hooks: typeof import("@/server/operations/hooks");
let queries: typeof import("./queries");
let advisor: AppSession;
let mechanic: AppSession;
let admin: AppSession;
let vehicleId: string;
let ownerId: string;

const ADVISOR = ["orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices", "appointments.view"];
const MECHANIC = ["orders.view", "orders.edit"];

async function sessionFor(permissions: readonly string[], options: { admin?: boolean } = {}): Promise<AppSession> {
  const role = await env.role({ isAdmin: options.admin, permissions });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2)}`, roles: [role] });
  await env.signIn(user);
  const { getSession } = await import("@/server/auth/session");
  const session = (await getSession())!;
  env.signOut();
  return session;
}

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "workshop.orders", enabled: true, updatedByName: "test" } });
  // Zweiter Client auf dieselbe Datei, der jede Anweisung mitschreibt; die Anwendung (`@/server/db`) benutzt ihn
  logged = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${env.dir}/test.db` }), log: [{ emit: "event", level: "query" }] });
  (logged as unknown as { $on(name: "query", cb: (event: { query: string }) => void): void }).$on("query", (event) => sql.push(event.query));
  (globalThis as unknown as { __db?: PrismaClient }).__db = logged;
  ops = await import("./operations");
  hooks = await import("@/server/operations/hooks");
  queries = await import("./queries");
  advisor = await sessionFor(ADVISOR);
  mechanic = await sessionFor(MECHANIC);
  admin = await sessionFor([], { admin: true });
  const owner = await env.db.customer.create({ data: { lastName: "Muster", nameKey: "muster" } });
  ownerId = owner.id;
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1", customerId: owner.id, mileageKm: 100_000 } })).id;
});
after(async () => {
  await logged.$disconnect();
  await env.cleanup();
});

beforeEach(async () => {
  hooks.setOperationHooksForTest(null);
  await env.db.orderEvent.deleteMany();
  await env.db.orderApproval.deleteMany();
  await env.db.orderFinding.deleteMany();
  await env.db.orderItem.deleteMany();
  await env.db.order.deleteMany();
  await env.db.counter.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.appointment.deleteMany();
  await env.db.vehicle.update({ where: { id: vehicleId }, data: { mileageKm: 100_000 } });
});

const create = (extra: Record<string, unknown> = {}, who: AppSession = advisor) => ops.createOrderOperation.execute(who, { vehicleId, ...extra });
async function created(extra: Record<string, unknown> = {}) {
  const outcome = await create(extra);
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failure));
  return outcome.data;
}
const versionNow = async (id: string) => versionOf(await env.db.order.findUniqueOrThrow({ where: { id } }));
const step = async (id: string, status: string, who: AppSession = advisor) => ops.setStatusOperation.execute(who, { id, version: await versionNow(id), status });
const close = async (id: string, who: AppSession = advisor) => ops.closeOrderOperation.execute(who, { id, version: await versionNow(id) });

describe("Auftragsnummer (Zähler)", () => {
  it("zählt fortlaufend im Muster A-JJJJ-NNNN und protokolliert", async () => {
    const year = (await import("@/lib/zone")).dayKey(new Date()).slice(0, 4);
    const a = await created();
    const b = await created();
    assert.equal(a.number, `A-${year}-0001`);
    assert.equal(b.number, `A-${year}-0002`);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "orders.create" }, orderBy: { createdAt: "asc" } });
    assert.match(entry.target ?? "", /A-\d{4}-0001 · B AB 1/);
  });

  it("scheitert der Auftrag nach der Nummernvergabe, rollt der Zähler mit zurück: keine Lücke", async () => {
    await created();
    hooks.setOperationHooksForTest([{ operation: "orders.create", feature: "workshop.orders", run: () => { throw new Error("Hook scheitert"); } }]);
    await assert.rejects(() => create());
    hooks.setOperationHooksForTest(null);
    assert.equal((await env.db.counter.findFirstOrThrow({ where: { key: "orders" } })).value, 1, "der Zähler steht wieder auf dem letzten vergebenen Wert");
    const next = await created();
    assert.match(next.number, /-0002$/);
  });

  it("gleichzeitige Anlegen ergeben eindeutige, lückenlose Nummern", async () => {
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => create()));
    const numbers = outcomes.map((o) => (o.ok ? o.data.number : "x")).sort();
    assert.equal(new Set(numbers).size, 8);
    assert.deepEqual(numbers.map((n) => Number(n.slice(-4))), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("Anlegen", () => {
  it("braucht orders.create; Mechaniker legen keinen Auftrag an", async () => {
    const denied = await create({}, mechanic);
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
    assert.equal(await env.db.order.count(), 0);
  });

  it("leitet den Kunden aus dem Halter ab; ein anderer Kunde ist ein Widerspruch", async () => {
    const { id } = await created();
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id } })).customerId, ownerId);
    const other = await env.db.customer.create({ data: { lastName: "Andere", nameKey: "andere" } });
    const bad = await create({ customerId: other.id });
    assert.ok(!bad.ok && bad.failure.fields?.customerId);
  });

  it("Fahrzeug ohne Halter ergibt einen Auftrag ohne Kunden; ein Kunde lässt sich direkt wählen, ein eingeschränkter nicht", async () => {
    const free = await env.db.vehicle.create({ data: { plate: "B XX 9", plateNorm: "BXX9" } });
    const plain = await ops.createOrderOperation.execute(advisor, { vehicleId: free.id });
    assert.ok(plain.ok);
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id: plain.data.id } })).customerId, null);
    const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", nameKey: "gesperrt", processingRestrictedAt: new Date() } });
    const refused = await ops.createOrderOperation.execute(advisor, { vehicleId: free.id, customerId: restricted.id });
    assert.ok(!refused.ok && refused.failure.fields?.customerId);
    const fine = await env.db.customer.create({ data: { lastName: "Frei", nameKey: "frei" } });
    const chosen = await ops.createOrderOperation.execute(advisor, { vehicleId: free.id, customerId: fine.id });
    assert.ok(chosen.ok);
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id: chosen.data.id } })).customerId, fine.id);
  });

  it("archivierte Fahrzeuge und Kunden mit eingeschränkter Verarbeitung nehmen keinen neuen Auftrag an", async () => {
    const archived = await env.db.vehicle.create({ data: { plate: "B ZZ 1", plateNorm: "BZZ1", archivedAt: new Date() } });
    const refused = await ops.createOrderOperation.execute(advisor, { vehicleId: archived.id });
    assert.ok(!refused.ok && refused.failure.fields?.vehicleId);
    const restricted = await env.db.customer.create({ data: { lastName: "Halter", nameKey: "halter", processingRestrictedAt: new Date() } });
    const ofRestricted = await env.db.vehicle.create({ data: { plate: "B ZZ 2", plateNorm: "BZZ2", customerId: restricted.id } });
    const second = await ops.createOrderOperation.execute(advisor, { vehicleId: ofRestricted.id });
    assert.ok(!second.ok && second.failure.fields?.vehicleId);
  });

  it("Auftrag aus Termin: ein Termin hat höchstens einen (nicht stornierten) Auftrag; Fahrzeug muss passen", async () => {
    const appointment = await env.db.appointment.create({ data: { title: "Inspektion", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId } });
    const first = await created({ appointmentId: appointment.id });
    const again = await create({ appointmentId: appointment.id });
    assert.equal(!again.ok && again.failure.code, "duplicate");
    await step(first.id, "cancelled");
    assert.ok((await create({ appointmentId: appointment.id })).ok, "nach dem Stornieren darf ein neuer Auftrag folgen");
    const otherCar = await env.db.vehicle.create({ data: { plate: "B OT 1", plateNorm: "BOT1" } });
    const wrong = await ops.createOrderOperation.execute(advisor, { vehicleId: otherCar.id, appointmentId: appointment.id });
    assert.ok(!wrong.ok && wrong.failure.fields?.appointmentId);
  });
});

describe("Kilometerstand bei Annahme", () => {
  it("höher: schreibt ins Fahrzeug (in derselben Transaktion)", async () => {
    const { id, mileage } = await created({ mileageKm: 101_500 });
    assert.equal(mileage, "write");
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileageKm, 101_500);
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id } })).mileageKm, 101_500);
  });

  it("niedriger: Hinweis statt Fehler – Fahrzeug bleibt, der Auftrag behält den erfassten Wert", async () => {
    const { id, mileage } = await created({ mileageKm: 90_000 });
    assert.equal(mileage, "keep");
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileageKm, 100_000);
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id } })).mileageKm, 90_000);
  });

  it("gleich oder ohne Angabe: keine Änderung; Fahrzeug ohne Stand übernimmt jeden Wert", async () => {
    assert.equal((await created({ mileageKm: 100_000 })).mileage, "none");
    assert.equal((await created()).mileage, "none");
    const blank = await env.db.vehicle.create({ data: { plate: "B KM 1", plateNorm: "BKM1" } });
    const outcome = await ops.createOrderOperation.execute(advisor, { vehicleId: blank.id, mileageKm: 5 });
    assert.ok(outcome.ok && outcome.data.mileage === "write");
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: blank.id } })).mileageKm, 5);
  });

  it("scheitert das Anlegen, bleibt der Kilometerstand im Fahrzeug unverändert", async () => {
    hooks.setOperationHooksForTest([{ operation: "orders.create", feature: "workshop.orders", run: () => { throw new Error("nein"); } }]);
    await assert.rejects(() => create({ mileageKm: 150_000 }));
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileageKm, 100_000);
  });
});

describe("Statuskette", () => {
  it("Angenommen → In Arbeit → Fertig → Abgeholt; jeder Schritt steht im Verlauf", async () => {
    const { id } = await created();
    assert.ok((await step(id, "in_progress")).ok);
    assert.ok((await step(id, "ready")).ok);
    assert.ok((await close(id)).ok);
    const order = await env.db.order.findUniqueOrThrow({ where: { id }, include: { events: { orderBy: { at: "asc" } } } });
    assert.equal(order.status, "picked_up");
    assert.ok(order.closedAt);
    assert.deepEqual(order.events.map((e) => `${e.kind}:${e.status ?? ""}`), ["created:", "status:in_progress", "status:ready", "status:picked_up"]);
  });

  it("unzulässige Schritte werden abgelehnt (nicht überspringen, Abgeholt nur über Abschließen, abgeschlossen ist fest)", async () => {
    const { id } = await created();
    assert.equal(!(await step(id, "accepted")).ok, true, "derselbe Stand ist ein Konflikt");
    assert.ok(!(await ops.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "picked_up" })).ok, "Abgeholt gibt es nur über Abschließen");
    assert.ok(!(await close(id)).ok, "ein nur angenommener Auftrag lässt sich nicht abschließen");
    await step(id, "in_progress");
    await close(id);
    const afterClose = await step(id, "in_progress");
    assert.equal(!afterClose.ok && afterClose.failure.key, "orders.errors.statusStep");
    assert.ok(!(await ops.saveItemsOperation.execute(advisor, { id, version: await versionNow(id), items: "[]" })).ok, "Positionen eines abgeschlossenen Auftrags sind fest");
    assert.ok(!(await ops.addFindingOperation.execute(advisor, { id, text: "x" })).ok);
  });

  it("stornieren und wieder aufnehmen", async () => {
    const { id } = await created();
    assert.ok((await step(id, "cancelled")).ok);
    assert.ok(!(await step(id, "ready")).ok);
    assert.ok((await step(id, "accepted")).ok);
  });

  it("Konkurrenz: veraltete Version → conflict, nichts wird überschrieben; von zwei gleichzeitigen Schritten gewinnt einer", async () => {
    const { id } = await created();
    const stale = await versionNow(id);
    assert.ok((await step(id, "in_progress")).ok);
    const lost = await ops.setStatusOperation.execute(advisor, { id, version: stale, status: "ready" });
    assert.equal(!lost.ok && lost.failure.code, "conflict");
    const version = await versionNow(id);
    const race = await Promise.all([ops.setStatusOperation.execute(advisor, { id, version, status: "ready" }), ops.setStatusOperation.execute(advisor, { id, version, status: "accepted" })]);
    assert.equal(race.filter((r) => r.ok).length, 1);
  });

  it("Mechaniker setzen den Status, schließen aber nicht ab", async () => {
    const { id } = await created();
    assert.ok((await step(id, "in_progress", mechanic)).ok);
    assert.equal(!(await close(id, mechanic)).ok && true, true);
    const denied = await close(id, mechanic);
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
  });
});

describe("Abschluss ist atomar über Hooks", () => {
  const spy = (calls: string[]): OperationHookDef[] => [
    { operation: "orders.close", feature: "workshop.orders", run: ({ result }) => void calls.push(`close:${(result as { number: string }).number}`) },
    { operation: "orders.reopen", feature: "workshop.orders", run: ({ result }) => void calls.push(`reopen:${(result as { status: string }).status}`) },
  ];

  it("die Abonnenten laufen beim Abschluss und beim Wiederöffnen und bekommen die Positionen ohne Preise", async () => {
    const { id, number } = await created();
    await step(id, "in_progress");
    await ops.saveItemsOperation.execute(advisor, {
      id,
      version: await versionNow(id),
      items: JSON.stringify([{ description: "Ölfilter", unit: "Stk", quantityMilli: 1000, unitCents: 1250, taxBp: 1900, discountBp: 0, kind: "part", refType: "article", refId: "abc" }]),
    });
    const seen: unknown[] = [];
    hooks.setOperationHooksForTest([{ operation: "orders.close", feature: "workshop.orders", run: ({ result }) => void seen.push(result) }]);
    assert.ok((await close(id)).ok);
    const change = seen[0] as { number: string; items: Array<Record<string, unknown>> };
    assert.equal(change.number, number);
    assert.deepEqual(Object.keys(change.items[0]).sort(), ["description", "id", "kind", "quantityMilli", "refId", "refType", "unit"], "keine Preise im Ergebnis");
    const calls: string[] = [];
    hooks.setOperationHooksForTest(spy(calls));
    const reopened = await ops.reopenOrderOperation.execute(admin, { id, version: await versionNow(id) });
    assert.ok(reopened.ok);
    assert.deepEqual(calls, ["reopen:ready"]);
  });

  it("wirft ein Abonnent, bleibt der Auftrag offen: kein Status, kein Verlaufseintrag, kein Audit", async () => {
    const { id } = await created();
    await step(id, "in_progress");
    await env.db.auditLog.deleteMany();
    hooks.setOperationHooksForTest([{ operation: "orders.close", feature: "workshop.orders", run: () => { throw new Error("Lager nicht erreichbar"); } }]);
    await assert.rejects(() => close(id));
    hooks.setOperationHooksForTest(null);
    const order = await env.db.order.findUniqueOrThrow({ where: { id }, include: { events: true } });
    assert.equal(order.status, "in_progress");
    assert.equal(order.closedAt, null);
    assert.equal(order.events.filter((e) => e.status === "picked_up").length, 0);
    assert.equal(await env.db.auditLog.count({ where: { action: "orders.close" } }), 0);
    assert.ok((await close(id)).ok, "danach lässt er sich abschließen");
  });

  it("Wieder öffnen braucht das eigene Recht (Berater haben es nicht), setzt auf Fertig zurück und steht im Audit", async () => {
    const { id } = await created();
    await step(id, "in_progress");
    await close(id);
    const denied = await ops.reopenOrderOperation.execute(advisor, { id, version: await versionNow(id) });
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
    assert.ok((await ops.reopenOrderOperation.execute(admin, { id, version: await versionNow(id) })).ok);
    const order = await env.db.order.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([order.status, order.closedAt], ["ready", null]);
    assert.equal(await env.db.auditLog.count({ where: { action: "orders.reopen" } }), 1);
    assert.ok(!(await ops.reopenOrderOperation.execute(admin, { id, version: await versionNow(id) })).ok, "nur ein abgeschlossener Auftrag");
    assert.ok((await step(id, "in_progress")).ok, "danach wieder änderbar");
  });
});

describe("Terminstatus folgt dem Auftrag (Hook der Terminfunktion)", () => {
  it("In Arbeit → Termin in Arbeit; Abschluss → erledigt; Wiederöffnen → wieder in Arbeit; Stornieren sagt den Termin nicht ab", async () => {
    const appointment = await env.db.appointment.create({ data: { title: "Inspektion", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId, status: "confirmed" } });
    const { id } = await created({ appointmentId: appointment.id });
    const status = async () => (await env.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status;
    assert.equal(await status(), "confirmed");
    await step(id, "in_progress");
    assert.equal(await status(), "in_progress");
    await close(id);
    assert.equal(await status(), "done");
    await ops.reopenOrderOperation.execute(admin, { id, version: await versionNow(id) });
    assert.equal(await status(), "in_progress");
    await step(id, "cancelled");
    assert.equal(await status(), "in_progress", "ein stornierter Auftrag sagt den Termin nicht ab");
  });

  it("scheitert der Auftragsschritt, bleibt der Termin unverändert (eine Transaktion)", async () => {
    const appointment = await env.db.appointment.create({ data: { title: "HU", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId, status: "scheduled" } });
    const { id } = await created({ appointmentId: appointment.id });
    const real = (await import("@/modules/operation-hooks")).operationHooks;
    hooks.setOperationHooksForTest([...real, { operation: "orders.setStatus", feature: "workshop.orders", run: () => { throw new Error("spät gescheitert"); } }]);
    await assert.rejects(() => step(id, "in_progress"));
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, "scheduled");
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id } })).status, "accepted");
  });
});

describe("Positionen und Preise", () => {
  const line = (extra: Record<string, unknown> = {}) => ({ description: "Arbeit", unit: "Std.", quantityMilli: 1500, unitCents: 8500, taxBp: 1900, discountBp: 0, ...extra });

  it("ersetzt die Positionen, prüft Art und Verweis und braucht orders.prices zusätzlich zu orders.edit", async () => {
    const { id } = await created();
    const save = async (items: unknown[], who: AppSession = advisor) => ops.saveItemsOperation.execute(who, { id, version: await versionNow(id), items: JSON.stringify(items) });
    assert.ok((await save([line(), line({ description: "Filter", kind: "part", refType: "article", refId: "x" })])).ok);
    const rows = await env.db.orderItem.findMany({ where: { orderId: id }, orderBy: { position: "asc" } });
    assert.deepEqual(rows.map((r) => [r.position, r.kind, r.refType]), [[0, "labor", null], [1, "part", "article"]]);
    const badKind = await save([line({ kind: "magie" })]);
    assert.ok(!badKind.ok && badKind.failure.fields?.["items.0.kind"]);
    const halfRef = await save([line({ refType: "article" })]);
    assert.ok(!halfRef.ok && halfRef.failure.fields?.["items.0.refId"]);
    assert.equal((await env.db.orderItem.count({ where: { orderId: id } })), 2, "ein abgelehntes Speichern ändert nichts");
    const mechanicTry = await save([line()], mechanic);
    assert.equal(!mechanicTry.ok && mechanicTry.failure.code, "forbidden");
    const onlyPrices = await sessionFor(["orders.view", "orders.prices"]);
    assert.equal(!(await save([line()], onlyPrices)).ok, true, "orders.prices allein genügt nicht");
  });

  it("Mechaniker lesen Positionen ohne Preise – die Preisspalten werden gar nicht erst aus der Datenbank geholt", async () => {
    const { id } = await created();
    await ops.saveItemsOperation.execute(advisor, { id, version: await versionNow(id), items: JSON.stringify([line()]) });
    sql = [];
    const detail = await queries.getOrderDetail(mechanic, id);
    assert.ok(detail);
    assert.equal(detail.totals, null);
    assert.deepEqual(Object.keys(detail.items[0]).filter((k) => ["unitCents", "taxBp", "discountBp"].includes(k)), []);
    assert.ok(detail.approvals.every((a) => !("amountCents" in a)));
    const selectList = (statement: string) => /^\s*SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(statement)?.[1] ?? "";
    const reading = (table: string, column: string) =>
      sql.filter((statement) => /^\s*SELECT/i.test(statement) && new RegExp("`" + table + "`\\.`" + column + "`").test(selectList(statement))).length;
    assert.equal(reading("OrderItem", "unitCents") + reading("OrderItem", "taxBp") + reading("OrderItem", "discountBp") + reading("OrderApproval", "amountCents"), 0, "Preisspalten werden für Betrachter ohne orders.prices nicht gelesen");
    assert.ok(reading("OrderItem", "quantityMilli") > 0, "Gegenprobe: die Menge wird gelesen");
    sql = [];
    const priced = await queries.getOrderDetail(advisor, id);
    assert.ok(priced?.totals && priced.totals.grossCents > 0);
    assert.ok(reading("OrderItem", "unitCents") > 0, "mit dem Recht werden die Preise gelesen");
    assert.equal(priced.items[0].unitCents, 8500);
  });

  it("die Liste zeigt Summen nur mit orders.prices", async () => {
    const { id } = await created();
    await ops.saveItemsOperation.execute(advisor, { id, version: await versionNow(id), items: JSON.stringify([line()]) });
    const page = { skip: 0, take: 10, orderBy: [{ acceptedAt: "desc" as const }] };
    const withPrices = await queries.listOrders(advisor, { q: "", status: "all" }, page);
    const without = await queries.listOrders(mechanic, { q: "", status: "all" }, page);
    assert.equal(withPrices.rows[0].totals?.netCents, 12750);
    assert.equal(without.rows[0].totals, null);
  });

  it("Suche findet Nummer, Kennzeichen und Halter; ein eingeschränkter Halter nicht", async () => {
    const { number } = await created({ request: "Bremsen quietschen" });
    const find = async (q: string) => (await queries.listOrders(advisor, { q, status: "all" }, { skip: 0, take: 10, orderBy: [{ acceptedAt: "desc" }] })).total;
    assert.equal(await find(number), 1);
    assert.equal(await find("bab 1"), 1);
    assert.equal(await find("Muster"), 1);
    assert.equal(await find("Bremsen"), 1);
    assert.equal(await find("gibtesnicht"), 0);
    await env.db.customer.update({ where: { id: ownerId }, data: { processingRestrictedAt: new Date() } });
    assert.equal(await find("Muster"), 0, "eingeschränkte Kunden sind nicht über ihren Namen zu finden");
    await env.db.customer.update({ where: { id: ownerId }, data: { processingRestrictedAt: null } });
  });
});

describe("Befunde und Kundenfreigabe", () => {
  it("Befunde: anlegen und entfernen am offenen Auftrag, mit Verfasser", async () => {
    const { id } = await created();
    const added = await ops.addFindingOperation.execute(mechanic, { id, text: "Bremsscheiben verschlissen" });
    assert.ok(added.ok);
    const finding = await env.db.orderFinding.findFirstOrThrow();
    assert.equal(finding.authorName.length > 0, true);
    assert.ok((await ops.removeFindingOperation.execute(mechanic, { id, findingId: finding.id })).ok);
    assert.equal(await env.db.orderFinding.count(), 0);
  });

  it("telefonische Freigabe: Betrag, Begründung, Person und Erfasser; braucht orders.prices; unveränderlich (keine Operation zum Ändern)", async () => {
    const { id } = await created();
    const phone = { id, amount: "240,00", reason: "Kondensator ersetzen", method: "phone", approverName: "Erika Muster" };
    const denied = await ops.approveOperation.execute(mechanic, phone);
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
    assert.equal(await env.db.orderApproval.count(), 0);
    const ok = await ops.approveOperation.execute(advisor, phone);
    assert.ok(ok.ok);
    const approval = await env.db.orderApproval.findFirstOrThrow();
    assert.deepEqual([approval.amountCents, approval.method, approval.approverName, approval.signaturePath], [24000, "phone", "Erika Muster", null]);
    assert.ok(approval.recordedByName.length > 0);
    assert.equal(await env.db.orderEvent.count({ where: { orderId: id, kind: "approval" } }), 1);
    const names = [...(await import("@/server/operations")).listOperations().keys()].filter((n) => n.startsWith("orders."));
    assert.ok(!names.some((n) => /updateApproval|removeApproval|deleteApproval/.test(n)), "das Protokoll hat keine Änderungs- oder Löschoperation");
  });

  it("Unterschrift: gezeichnet wird als PNG-Datei abgelegt (nie in der Datenbank), getippt mit Bestätigung braucht keine Datei; Ungültiges lehnt ab", async () => {
    const { id } = await created();
    const png = makePng(60, 20).toString("base64");
    const base = { id, amount: "50", reason: "Zusätzliche Reparatur", approverName: "Hans" };
    const drawn = await ops.approveOperation.execute(advisor, { ...base, method: "signature", signature: `data:image/png;base64,${png}` });
    assert.ok(drawn.ok);
    const stored = await env.db.orderApproval.findFirstOrThrow({ where: { method: "signature" } });
    assert.match(stored.signaturePath ?? "", /^auftraege\/freigaben\/freigabe-.*\.png$/);
    const { fileExists } = await import("@/server/files");
    assert.equal(fileExists(stored.signaturePath!), true);
    const typed = await ops.approveOperation.execute(advisor, { ...base, approverName: "Hans Beispiel", method: "signature", signature: "typed:Hans Beispiel" });
    assert.ok(typed.ok);
    assert.equal((await env.db.orderApproval.findFirstOrThrow({ where: { method: "typed" } })).signaturePath, null);
    const missing = await ops.approveOperation.execute(advisor, { ...base, method: "signature" });
    assert.ok(!missing.ok && missing.failure.fields?.signature);
    const notPng = await ops.approveOperation.execute(advisor, { ...base, method: "signature", signature: "data:image/png;base64,AAAA" });
    assert.ok(!notPng.ok);
    // nur die Magic Bytes mit Müll dahinter ist kein PNG
    const junk = Buffer.concat([makePng(60, 20).subarray(0, 8), Buffer.from("<script>alert(1)</script>GIF89a")]).toString("base64");
    const fake = await ops.approveOperation.execute(advisor, { ...base, method: "signature", signature: `data:image/png;base64,${junk}` });
    assert.ok(!fake.ok && fake.failure.fields?.signature);
    assert.equal(await env.db.orderApproval.count(), 2);
  });

  it("scheitert die Transaktion nach dem Ablegen der Unterschrift, wird die Datei wieder entfernt", async () => {
    const { id } = await created();
    const png = makePng(61, 20).toString("base64");
    hooks.setOperationHooksForTest([{ operation: "orders.approve", feature: "workshop.orders", run: () => { throw new Error("nein"); } }]);
    await assert.rejects(() => ops.approveOperation.execute(advisor, { id, amount: "10", reason: "r", approverName: "A", method: "signature", signature: `data:image/png;base64,${png}` }));
    hooks.setOperationHooksForTest(null);
    assert.equal(await env.db.orderApproval.count(), 0);
    const { readdirSync, existsSync } = await import("node:fs");
    const dir = `${env.dir}/files/auftraege/freigaben`;
    // nur die Datei des vorherigen Tests (falls vorhanden) bleibt – die dieses Tests nicht
    const before = existsSync(dir) ? readdirSync(dir).length : 0;
    assert.ok(before <= 1, `es dürfen keine verwaisten Dateien bleiben (${before})`);
  });

  it("Betrag muss positiv und lesbar sein", async () => {
    const { id } = await created();
    const base = { id, reason: "x", method: "phone", approverName: "A" };
    assert.ok(!(await ops.approveOperation.execute(advisor, { ...base, amount: "0" })).ok);
    assert.ok(!(await ops.approveOperation.execute(advisor, { ...base, amount: "abc" })).ok);
    assert.ok((await ops.approveOperation.execute(advisor, { ...base, amount: "12,5" })).ok);
  });
});

describe("Datenschutz", () => {
  it("Auskunft nennt Aufträge, Befunde und Freigaben des Kunden; die Anonymisierung entfernt Freitext und Namen, Nummer und Beträge bleiben", async () => {
    const { id } = await created({ request: "Quietschen vorn rechts" });
    await ops.addFindingOperation.execute(advisor, { id, text: "Belag verschlissen" });
    await ops.approveOperation.execute(advisor, { id, amount: "100", reason: "Belag", method: "phone", approverName: "Erika Muster" });

    const { privacyProviders } = await import("./privacy");
    const sections = await privacyProviders[0].collect({ id: ownerId, terms: [] });
    const record = sections[0].records[0];
    const value = (key: string) => record.find((f) => f.key === key)?.value;
    assert.equal(value("request"), "Quietschen vorn rechts");
    assert.equal(value("findings"), "Belag verschlissen");
    assert.match(String(value("approvals")), /100\.00 EUR, Erika Muster/);

    const { hooks: orderHooks } = await import("./hooks");
    const hook = orderHooks.find((h) => h.operation === "customers.anonymize")!;
    await env.db.$transaction(async (tx) => hook.run({ operation: "customers.anonymize", input: { id: ownerId }, result: {}, principal: admin, tx }));
    const order = await env.db.order.findUniqueOrThrow({ where: { id }, include: { findings: true, approvals: true, events: true } });
    assert.equal(order.request, null);
    assert.equal(order.findings[0].text, "(anonymisiert)");
    assert.equal(order.approvals[0].approverName, "(anonymisiert)");
    assert.equal(order.approvals[0].amountCents, 10000, "der Betrag bleibt (Belegfristen)");
    assert.ok(order.events.filter((e) => e.kind === "approval").every((e) => e.note === null));
    assert.match(order.number, /^A-/);
  });
});

describe("Freigabe: Unterschrift und getippter Name (Fix-Runde 12b: M3, M4)", () => {
  const base = { amount: "50", reason: "Zusätzliche Reparatur" };

  it("getippter Name muss zur freigebenden Person passen (Leerraum, Groß/Klein, Unicode-Normalform egal), sonst Feldfehler; der getippte Name steht im Protokoll", async () => {
    const { id } = await created();
    const mismatch = await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "Hans Beispiel", signature: "typed:Peter Anders" });
    assert.ok(!mismatch.ok);
    assert.equal(!mismatch.ok && mismatch.failure.fields?.signature?.key, "orders.errors.approvalNameMismatch");
    assert.equal(await env.db.orderApproval.count(), 0);
    assert.equal(await env.db.orderEvent.count({ where: { kind: "approval" } }), 0);
    // „Müller“ einmal zusammengesetzt (NFC), einmal mit kombiniertem Umlaut (NFD); Mehrfach-Leerraum und Großschreibung
    const typed = await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "  hans   MÜLLER ", signature: `typed:Hans  Müller` });
    assert.ok(typed.ok, JSON.stringify(!typed.ok && typed.failure));
    const row = await env.db.orderApproval.findFirstOrThrow();
    assert.deepEqual([row.method, row.signedName, row.approverName, row.signaturePath, row.signatureHash], ["typed", "Hans Müller", "hans   MÜLLER", null, null]);
    // nur Teilübereinstimmung zählt nicht
    assert.ok(!(await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "Hans", signature: "typed:Hans Beispiel" })).ok);
  });

  it("dasselbe Unterschrift-Bild gilt nie für eine zweite Freigabe; die Datei der abgelehnten wird nicht behalten; eine neue Zeichnung geht", async () => {
    const { id } = await created();
    const { readdirSync, existsSync } = await import("node:fs");
    const dir = `${env.dir}/files/auftraege/freigaben`;
    const count = () => (existsSync(dir) ? readdirSync(dir).length : 0);
    const png = (w: number) => `data:image/png;base64,${makePng(w, 24).toString("base64")}`;
    const first = await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "Hans", signature: png(70) });
    assert.ok(first.ok);
    const stored = await env.db.orderApproval.findFirstOrThrow({ where: { method: "signature" } });
    assert.match(stored.signatureHash ?? "", /^[0-9a-f]{64}$/);
    const files = count();
    const again = await ops.approveOperation.execute(advisor, { id, ...base, amount: "75", reason: "Zweite", method: "signature", approverName: "Hans", signature: png(70) });
    assert.ok(!again.ok);
    assert.equal(!again.ok && again.failure.fields?.signature?.key, "orders.errors.signatureReused");
    assert.equal(await env.db.orderApproval.count(), 1);
    assert.equal(count(), files, "die abgelehnte Freigabe hinterlässt keine Datei");
    // auch an einem anderen Auftrag: das Bild gehört zur ersten Freigabe
    const other = await created();
    assert.ok(!(await ops.approveOperation.execute(advisor, { id: other.id, ...base, method: "signature", approverName: "Hans", signature: png(70) })).ok);
    assert.ok((await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "Hans", signature: png(71) })).ok);
  });

  it("das Audit-Log der Freigabe nennt nur die Auftragsnummer, nie den Namen der freigebenden Person", async () => {
    const { id, number } = await created();
    await ops.approveOperation.execute(advisor, { id, ...base, method: "phone", approverName: "Erika Muster" });
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "orders.approve" } });
    assert.equal(entry.target, number);
    assert.doesNotMatch(JSON.stringify(entry), /Erika|Muster/);
  });

  it("Auskunft nennt den getippten Namen und die gespeicherte Unterschrift-Bilddatei; die Anonymisierung nimmt den getippten Namen mit", async () => {
    const { id } = await created();
    await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "Hans Beispiel", signature: "typed:hans beispiel" });
    await ops.approveOperation.execute(advisor, { id, ...base, method: "signature", approverName: "Erika", signature: `data:image/png;base64,${makePng(80, 24).toString("base64")}` });
    const { privacyProviders } = await import("./privacy");
    const record = (await privacyProviders[0].collect({ id: ownerId, terms: [] }))[0].records[0];
    const approvals = String(record.find((f) => f.key === "approvals")?.value);
    assert.match(approvals, /getippter Name: hans beispiel/);
    assert.match(approvals, /Unterschrift als Bilddatei gespeichert/);
    const { hooks: orderHooks } = await import("./hooks");
    const hook = orderHooks.find((h) => h.operation === "customers.anonymize")!;
    await env.db.$transaction(async (tx) => hook.run({ operation: "customers.anonymize", input: { id: ownerId }, result: {}, principal: admin, tx }));
    const rows = await env.db.orderApproval.findMany();
    assert.ok(rows.every((r) => r.approverName === "(anonymisiert)" && r.signedName === null));
  });
});

describe("Aufträge: Fix-Runde 12b (N1, N2, N4, N5, N6)", () => {
  beforeEach(async () => {
    await env.db.outboxEvent.deleteMany();
  });

  it("N1: Fahrzeug und Kunde mit Aufträgen sind nicht löschbar – die Zählung nennt die Aufträge", async () => {
    const { vehicleDeletable } = await import("@/modules/workshop/vehicles/domain");
    const { customerHasLinks } = await import("@/modules/workshop/customers/domain");
    assert.equal(vehicleDeletable({ appointments: 0, tireSets: 0, orders: 1, transfers: 0 }), false);
    assert.equal(vehicleDeletable({ appointments: 0, tireSets: 0, orders: 0, transfers: 0 }), true);
    assert.equal(customerHasLinks({ vehicles: 0, ownerships: 0, invoices: 0, orders: 2 }), true);
    const lone = await env.db.vehicle.create({ data: { plate: "B LO 1", plateNorm: "BLO1" } });
    assert.ok((await create({ vehicleId: lone.id })).ok);
    const { deleteVehicleOperation } = await import("@/modules/workshop/vehicles/operations");
    const refused = await deleteVehicleOperation.execute(admin, { id: lone.id });
    assert.ok(!refused.ok);
    assert.equal(!refused.ok && refused.failure.code, "inUse");
    assert.equal(!refused.ok && refused.failure.key, "vehicles.errors.inUse");
    assert.equal((!refused.ok && refused.failure.params?.orders) || 0, 1);
    assert.ok(await env.db.vehicle.findUnique({ where: { id: lone.id } }));
    // Kunde nur direkt am Auftrag (Fahrzeug ohne Halter)
    const direct = await env.db.customer.create({ data: { lastName: "Laufkunde", nameKey: "laufkunde" } });
    assert.ok((await create({ vehicleId: lone.id, customerId: direct.id })).ok);
    const { deleteCustomerOperation } = await import("@/modules/workshop/customers/operations");
    const customerRefused = await deleteCustomerOperation.execute(admin, { id: direct.id });
    assert.equal(!customerRefused.ok && customerRefused.failure.code, "inUse");
    assert.equal((!customerRefused.ok && customerRefused.failure.params?.orders) || 0, 1);
  });

  it("N2: ein stornierter Auftrag lässt sich nicht wieder aufnehmen, wenn der Termin inzwischen einen anderen aktiven Auftrag hat", async () => {
    const appointment = await env.db.appointment.create({ data: { title: "HU", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId } });
    const first = await create({ appointmentId: appointment.id });
    assert.ok(first.ok);
    assert.ok((await ops.setStatusOperation.execute(advisor, { id: first.data.id, version: await versionNow(first.data.id), status: "cancelled" })).ok);
    const second = await create({ appointmentId: appointment.id });
    assert.ok(second.ok, "nach dem Storno ist der Termin wieder frei");
    const resume = await ops.setStatusOperation.execute(advisor, { id: first.data.id, version: await versionNow(first.data.id), status: "accepted" });
    assert.ok(!resume.ok);
    assert.equal(!resume.ok && resume.failure.code, "duplicate");
    assert.equal(!resume.ok && resume.failure.key, "orders.errors.appointmentTaken");
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id: first.data.id } })).status, "cancelled");
    // ist der zweite Auftrag selbst storniert, geht die Wiederaufnahme
    await ops.setStatusOperation.execute(advisor, { id: second.data.id, version: await versionNow(second.data.id), status: "cancelled" });
    assert.ok((await ops.setStatusOperation.execute(advisor, { id: first.data.id, version: await versionNow(first.data.id), status: "accepted" })).ok);
  });

  it("N4: ein Termin lässt sich nur mit aktiver Terminfunktion und dem Recht appointments.view verknüpfen (sonst verrieten die Meldungen fremde Termine); der Kilometerstand steht im Audit", async () => {
    const appointment = await env.db.appointment.create({ data: { title: "HU", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId } });
    const blind = await sessionFor(["orders.view", "orders.create", "orders.edit"]);
    const refused = await create({ appointmentId: appointment.id }, blind);
    assert.ok(!refused.ok);
    assert.equal(!refused.ok && refused.failure.fields?.appointmentId?.key, "validation.invalid");
    assert.equal(await env.db.order.count(), 0);
    const unknown = await create({ appointmentId: "gibtsnicht" }, blind);
    assert.deepEqual(!unknown.ok && unknown.failure.fields?.appointmentId, !refused.ok ? refused.failure.fields?.appointmentId : undefined, "kein Unterschied zwischen vorhanden und unbekannt");
    const ok = await create({ appointmentId: appointment.id, mileageKm: 120_000 });
    assert.ok(ok.ok);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "orders.create" } });
    assert.match(entry.target ?? "", /120000 km → Fahrzeug/);
  });

  it("N5: createOrderInTx legt den Auftrag in der Transaktion des Aufrufers an (Zähler, Verlauf, Audit, Ereignis) und rollt mit ihr zurück", async () => {
    const { createOrderInTx } = await import("./public");
    const { db } = await import("@/server/db");
    const { writeOutboxEvent } = await import("@/server/outbox");
    const emitFor = (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => async (type: string, payload?: Record<string, unknown>, entityId?: string | null): Promise<void> => {
      await writeOutboxEvent(tx, { type, payload, entityId: entityId ?? null, actorId: advisor.user.id });
    };

    // Erfolg: alles gemeinsam mit dem Schreiben des Aufrufers
    const made = await db.$transaction(async (tx) => {
      const order = await createOrderInTx({ principal: advisor, tx, emit: emitFor(tx) }, { vehicleId, request: "Aus Angebot", mileageKm: 101_000 });
      await tx.auditLog.create({ data: { action: "orders.update", actorName: "Aufrufer", target: "Angebot angenommen" } });
      return order;
    });
    assert.match(made.number, /^A-\d{4}-0001$/);
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id: made.id } })).request, "Aus Angebot");
    assert.equal(await env.db.orderEvent.count({ where: { orderId: made.id, kind: "created" } }), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: "orders.create", entityId: made.id } }), 1);
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileageKm, 101_000);
    assert.equal(await env.db.outboxEvent.count({ where: { type: "order.created" } }), 1);

    // Fehler des Aufrufers danach: Auftrag, Nummer, Verlauf, Audit, Ereignis und Kilometerstand sind weg – die Nummer wird wieder vergeben (lückenlos)
    await assert.rejects(() =>
      db.$transaction(async (tx) => {
        await createOrderInTx({ principal: advisor, tx, emit: emitFor(tx) }, { vehicleId, mileageKm: 150_000 });
        throw new Error("Angebot nicht annehmbar");
      }),
    );
    assert.equal(await env.db.order.count(), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: "orders.create" } }), 1);
    assert.equal(await env.db.outboxEvent.count({ where: { type: "order.created" } }), 1);
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).mileageKm, 101_000);
    const next = await db.$transaction(async (tx) => createOrderInTx({ principal: advisor, tx, emit: emitFor(tx) }, { vehicleId }));
    assert.match(next.number, /^A-\d{4}-0002$/);

    // Recht und Eingabe werden wie in der Operation geprüft
    const { OperationError } = await import("@/server/operations");
    await assert.rejects(() => db.$transaction(async (tx) => createOrderInTx({ principal: mechanic, tx, emit: emitFor(tx) }, { vehicleId })), (error: unknown) => error instanceof OperationError && error.failure.code === "forbidden");
    await assert.rejects(() => db.$transaction(async (tx) => createOrderInTx({ principal: advisor, tx, emit: emitFor(tx) }, { vehicleId: "gibtsnicht" })), (error: unknown) => error instanceof OperationError && error.failure.code === "invalid");
    await assert.rejects(() => db.$transaction(async (tx) => createOrderInTx({ principal: advisor, tx, emit: emitFor(tx) }, { vehicleId: "" })), (error: unknown) => error instanceof OperationError && error.failure.code === "invalid");
  });

  it("N5: die Hooks auf orders.create laufen auch über createOrderInTx", async () => {
    const { createOrderInTx } = await import("./public");
    const { db } = await import("@/server/db");
    let seen = "";
    hooks.setOperationHooksForTest([{ operation: "orders.create", feature: "workshop.orders", run: ({ result }) => void (seen = (result as { number: string }).number) }]);
    const made = await db.$transaction(async (tx) => createOrderInTx({ principal: advisor, tx, emit: async () => undefined }, { vehicleId }));
    assert.equal(seen, made.number);
  });

  it("N6: Befund entfernen protokolliert Verfasser und Zeitpunkt, nicht den Text", async () => {
    const { id, number } = await created();
    await ops.addFindingOperation.execute(mechanic, { id, text: "Geheimer Befundtext" });
    const finding = await env.db.orderFinding.findFirstOrThrow();
    await ops.removeFindingOperation.execute(mechanic, { id, findingId: finding.id });
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "orders.findingRemove" } });
    assert.ok((entry.target ?? "").startsWith(`${number} · ${finding.authorName},`));
    assert.doesNotMatch(entry.target ?? "", /Geheimer/);
  });

  it("M2 (Oberfläche): bestehende Aufträge eines Kunden mit eingeschränkter Verarbeitung bleiben bearbeitbar (nur neue Verknüpfungen sind gesperrt, wie bei Termin, Fahrzeug und Rechnung)", async () => {
    const { id } = await created();
    await env.db.customer.update({ where: { id: ownerId }, data: { processingRestrictedAt: new Date() } });
    try {
      assert.ok(!(await create()).ok, "neuer Auftrag für das Fahrzeug des Kunden: gesperrt");
      assert.ok((await ops.addFindingOperation.execute(advisor, { id, text: "weiter dokumentieren" })).ok);
      assert.ok((await ops.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "in_progress" })).ok);
      assert.ok((await ops.closeOrderOperation.execute(advisor, { id, version: await versionNow(id) })).ok);
    } finally {
      await env.db.customer.update({ where: { id: ownerId }, data: { processingRestrictedAt: null } });
    }
  });
});
