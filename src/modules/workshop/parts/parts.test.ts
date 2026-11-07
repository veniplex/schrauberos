import assert from "node:assert/strict";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import type { AppSession } from "@/server/auth/session";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Teile & Lager gegen eine echte temporäre SQLite: Wareneingang, Inventur, Buchung beim Abschluss eines Auftrags (gleiche Transaktion, atomar), Rückbuchung beim Wiederöffnen,
 * negativer Bestand, gleichzeitige Buchungen, Preise nur mit `parts.prices` (am SQL belegt), eindeutige Artikelnummer.
 */
let env: TestEnv;
let logged: PrismaClient;
let sql: string[] = [];
let ops: typeof import("./operations");
let orderOps: typeof import("@/modules/workshop/orders/operations");
let queries: typeof import("./queries");
let hooks: typeof import("@/server/operations/hooks");
let warehouse: AppSession;
let advisor: AppSession;
let mechanic: AppSession;
let admin: AppSession;
let vehicleId: string;

const WAREHOUSE = ["parts.view", "parts.edit", "parts.stock", "parts.prices"];
const ADVISOR = ["orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices", "parts.view", "parts.prices"];
const MECHANIC = ["orders.view", "orders.edit", "parts.view"];

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
  for (const key of ["workshop.orders", "workshop.parts"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  logged = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${env.dir}/test.db` }), log: [{ emit: "event", level: "query" }] });
  (logged as unknown as { $on(name: "query", cb: (event: { query: string }) => void): void }).$on("query", (event) => sql.push(event.query));
  (globalThis as unknown as { __db?: PrismaClient }).__db = logged;
  ops = await import("./operations");
  orderOps = await import("@/modules/workshop/orders/operations");
  queries = await import("./queries");
  hooks = await import("@/server/operations/hooks");
  warehouse = await sessionFor(WAREHOUSE);
  advisor = await sessionFor(ADVISOR);
  mechanic = await sessionFor(MECHANIC);
  admin = await sessionFor([], { admin: true });
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } })).id;
});
after(async () => {
  await logged.$disconnect();
  await env.cleanup();
});

beforeEach(async () => {
  hooks.setOperationHooksForTest(null);
  for (const table of ["stockMovement", "article", "orderEvent", "orderItem", "order", "counter", "auditLog"] as const) {
    await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  }
});

const article = async (extra: Record<string, unknown> = {}) => {
  const out = await ops.saveArticleOperation.execute(warehouse, { number: `art-${Math.random().toString(36).slice(2, 8)}`, name: "Ölfilter", unit: "Stk", ...extra });
  assert.ok(out.ok, JSON.stringify(!out.ok && out.failure));
  return out.data.id;
};
const stock = async (id: string) => (await env.db.article.findUniqueOrThrow({ where: { id } })).stockMilli;
const receive = (id: string, quantity: string, extra: Record<string, unknown> = {}, who: AppSession = warehouse) => ops.receiptOperation.execute(who, { articleId: id, quantity, ...extra });
const versionNow = async (id: string) => versionOf(await env.db.order.findUniqueOrThrow({ where: { id } }));

/** Auftrag in Arbeit mit Positionen; `parts`: [Artikel, Menge] werden zu Teile-Positionen mit Verweis. */
async function orderWith(parts: Array<[string, number]>, extraLines: unknown[] = []) {
  const created = await orderOps.createOrderOperation.execute(advisor, { vehicleId });
  assert.ok(created.ok);
  const id = created.data.id;
  await orderOps.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "in_progress" });
  const items = [
    ...parts.map(([articleId, qty]) => ({ description: "Teil", unit: "Stk", quantityMilli: qty * 1000, unitCents: 1000, taxBp: 1900, discountBp: 0, kind: "part", refType: "article", refId: articleId })),
    ...extraLines,
  ];
  const saved = await orderOps.saveItemsOperation.execute(advisor, { id, version: await versionNow(id), items: JSON.stringify(items) });
  assert.ok(saved.ok, JSON.stringify(!saved.ok && saved.failure));
  return id;
}
const close = async (id: string) => orderOps.closeOrderOperation.execute(advisor, { id, version: await versionNow(id) });
const reopen = async (id: string) => orderOps.reopenOrderOperation.execute(admin, { id, version: await versionNow(id) });

describe("Artikel", () => {
  it("anlegen: Nummer wird normalisiert und ist eindeutig; ändern mit Versionsprüfung; Audit nennt Nummer und Bezeichnung, nie Preise", async () => {
    const out = await ops.saveArticleOperation.execute(warehouse, { number: " oel 5w30 ", name: "Motoröl", unit: "l", purchase: "7,80", sale: "14,50", taxRate: "19", minStock: "20" });
    assert.ok(out.ok);
    const row = await env.db.article.findUniqueOrThrow({ where: { id: out.data.id } });
    assert.deepEqual([row.number, row.purchaseCents, row.saleCents, row.taxBp, row.minStockMilli, row.stockMilli], ["OEL 5W30", 780, 1450, 1900, 20_000, 0]);
    assert.ok(row.searchKey.includes("oel"));
    const dup = await ops.saveArticleOperation.execute(warehouse, { number: "OEL 5w30", name: "Zweites" });
    assert.ok(!dup.ok && dup.failure.fields?.number);
    const stale = versionOf(row);
    assert.ok((await ops.saveArticleOperation.execute(warehouse, { id: row.id, version: stale, number: "OEL 5W30", name: "Motoröl neu", unit: "l" })).ok);
    const conflict = await ops.saveArticleOperation.execute(warehouse, { id: row.id, version: stale, number: "OEL 5W30", name: "x", unit: "l" });
    assert.equal(!conflict.ok && conflict.failure.code, "conflict");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "parts.create" } });
    assert.equal(entry.target, "OEL 5W30 · Motoröl");
    assert.doesNotMatch(JSON.stringify(entry), /7,80|14,50|780|1450/);
  });

  it("Preise: leer löscht, fehlend lässt; ohne parts.prices ist jeder Preis verboten, Bearbeiten ohne Preisfelder lässt sie unberührt", async () => {
    const id = await article({ purchase: "5", sale: "9" });
    const base = { number: "x1", name: "Neu" };
    // fehlend → bleibt
    assert.ok((await ops.saveArticleOperation.execute(warehouse, { id, version: versionOf(await env.db.article.findUniqueOrThrow({ where: { id } })), ...base })).ok);
    assert.deepEqual((await env.db.article.findUniqueOrThrow({ where: { id } })).purchaseCents, 500);
    // leer → löscht
    assert.ok((await ops.saveArticleOperation.execute(warehouse, { id, version: versionOf(await env.db.article.findUniqueOrThrow({ where: { id } })), ...base, purchase: "" })).ok);
    assert.equal((await env.db.article.findUniqueOrThrow({ where: { id } })).purchaseCents, null);
    // ohne Recht: Preisfeld → forbidden; ohne Preisfelder → geht
    const editorOnly = await sessionFor(["parts.view", "parts.edit"]);
    const version = versionOf(await env.db.article.findUniqueOrThrow({ where: { id } }));
    const denied = await ops.saveArticleOperation.execute(editorOnly, { id, version, ...base, sale: "1" });
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
    assert.ok((await ops.saveArticleOperation.execute(editorOnly, { id, version, ...base, name: "Ohne Preise geändert" })).ok);
    assert.equal((await env.db.article.findUniqueOrThrow({ where: { id } })).saleCents, 900, "der Verkaufspreis blieb");
    assert.ok(!(await ops.saveArticleOperation.execute(warehouse, { ...base, number: "x2", purchase: "abc" })).ok);
  });

  it("Mechaniker legen keine Artikel an und buchen nichts; archivieren braucht parts.edit", async () => {
    assert.equal(!(await ops.saveArticleOperation.execute(mechanic, { number: "m1", name: "x" })).ok, true);
    const id = await article();
    assert.equal(!(await receive(id, "5", {}, mechanic)).ok, true);
    assert.equal(await stock(id), 0);
    const version = versionOf(await env.db.article.findUniqueOrThrow({ where: { id } }));
    assert.ok((await ops.setArchivedOperation.execute(warehouse, { id, version, archived: "1" })).ok);
    assert.ok((await env.db.article.findUniqueOrThrow({ where: { id } })).archivedAt);
    const again = await receive(id, "1");
    assert.ok(!again.ok && again.failure.fields?.articleId, "ein archivierter Artikel nimmt keinen Wareneingang an");
  });

  it("Mechaniker lesen Artikel ohne Preise – die Spalten werden nicht aus der Datenbank geholt; mit parts.prices schon", async () => {
    const id = await article({ purchase: "5", sale: "9" });
    sql = [];
    const asMechanic = await queries.getArticle(mechanic, id);
    assert.ok(asMechanic && !("purchaseCents" in asMechanic) && !("saleCents" in asMechanic));
    await queries.listArticles(mechanic, { q: "" }, { skip: 0, take: 10, orderBy: [{ number: "asc" }] });
    await queries.pickerArticles(mechanic, "ölfilter");
    const selectList = (statement: string) => /^\s*SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(statement)?.[1] ?? "";
    const reading = (column: string) => sql.filter((s) => /^\s*SELECT/i.test(s) && new RegExp("`" + column + "`").test(selectList(s))).length;
    assert.equal(reading("purchaseCents") + reading("saleCents"), 0, "keine Preisspalten in den Abfragen");
    assert.ok(reading("stockMilli") > 0);
    sql = [];
    const asWarehouse = await queries.getArticle(warehouse, id);
    assert.deepEqual([asWarehouse?.purchaseCents, asWarehouse?.saleCents], [500, 900]);
    assert.ok(reading("purchaseCents") > 0);
    const picked = await queries.pickerArticles(advisor, "ölfilter");
    assert.equal(picked[0].saleCents, 900);
    assert.equal((await queries.pickerArticles(mechanic, "ölfilter"))[0].saleCents, undefined);
  });
});

describe("Wareneingang und Inventur", () => {
  it("Wareneingang erhöht den Bestand, hält Stand danach, Lieferschein und Person fest; Menge muss positiv sein", async () => {
    const id = await article();
    assert.ok((await receive(id, "12,5", { reference: "LS-77", note: "Palette 2" })).ok);
    assert.equal(await stock(id), 12_500);
    const movement = await env.db.stockMovement.findFirstOrThrow({ where: { articleId: id } });
    assert.deepEqual([movement.kind, movement.quantityMilli, movement.stockAfterMilli, movement.reference], ["receipt", 12_500, 12_500, "LS-77"]);
    assert.ok(movement.byName.length > 0);
    assert.ok(!(await receive(id, "0")).ok);
    assert.ok(!(await receive(id, "-3")).ok);
    assert.ok(!(await receive(id, "abc")).ok);
    assert.equal(await env.db.stockMovement.count(), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: "parts.receipt" } }), 1);
  });

  it("gleichzeitige Wareneingänge gehen nicht verloren (atomarer Zuwachs) und die Stände danach sind lückenlos", async () => {
    const id = await article();
    await Promise.all(Array.from({ length: 10 }, () => receive(id, "1")));
    assert.equal(await stock(id), 10_000);
    const after = (await env.db.stockMovement.findMany({ where: { articleId: id } })).map((m) => m.stockAfterMilli).sort((a, b) => a - b);
    assert.deepEqual(after, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => n * 1000));
  });

  it("Inventur: bucht nur die Differenz als Korrektur, lässt leere Zeilen und unveränderte Bestände in Ruhe und rechnet gegen den aktuellen Stand", async () => {
    const a = await article();
    const b = await article();
    const c = await article();
    await receive(a, "10");
    await receive(b, "5");
    await receive(c, "7");
    const out = await ops.countOperation.execute(warehouse, { counts: { [a]: "8", [b]: "5", [c]: "" }, note: "Jahresinventur" });
    assert.ok(out.ok);
    assert.deepEqual(out.ok && out.data, { corrected: 1, counted: 2 });
    assert.deepEqual([await stock(a), await stock(b), await stock(c)], [8000, 5000, 7000]);
    const correction = await env.db.stockMovement.findFirstOrThrow({ where: { articleId: a, kind: "correction" } });
    assert.deepEqual([correction.quantityMilli, correction.stockAfterMilli, correction.note], [-2000, 8000, "Jahresinventur"]);
    assert.match(correction.reference ?? "", /^Inventur \d{4}-\d{2}-\d{2}$/);
    assert.equal(await env.db.stockMovement.count({ where: { articleId: b, kind: "correction" } }), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: "parts.count" } }), 1);
    const bad = await ops.countOperation.execute(warehouse, { counts: { [a]: "x" } });
    assert.ok(!bad.ok && bad.failure.fields?.[`counts.${a}`]);
    const unknown = await ops.countOperation.execute(warehouse, { counts: { gibtsnicht: "3", [b]: "1" } });
    assert.ok(!unknown.ok);
    assert.equal(await stock(b), 5000, "ein Fehler bucht nichts (eine Transaktion)");
    assert.equal(!(await ops.countOperation.execute(mechanic, { counts: { [a]: "1" } })).ok, true);
  });
});

describe("Buchung beim Auftragsabschluss (Hooks, gleiche Transaktion)", () => {
  it("Abschluss bucht jede Teile-Position ab; dieselbe Ware in zwei Positionen zählt zusammen; Positionen ohne Verweis und Arbeit bleiben unberührt", async () => {
    const a = await article();
    const b = await article();
    await receive(a, "10");
    await receive(b, "10");
    const id = await orderWith(
      [[a, 2], [a, 1], [b, 4]],
      [{ description: "Arbeit", unit: "Std.", quantityMilli: 1000, unitCents: 8500, taxBp: 1900, discountBp: 0 }, { description: "Freies Teil", unit: "Stk", quantityMilli: 5000, unitCents: 100, taxBp: 1900, discountBp: 0, kind: "part" }],
    );
    assert.deepEqual([await stock(a), await stock(b)], [10_000, 10_000], "vor dem Abschluss ist nichts gebucht");
    assert.ok((await close(id)).ok);
    assert.deepEqual([await stock(a), await stock(b)], [7_000, 6_000]);
    const moves = await env.db.stockMovement.findMany({ where: { orderId: id }, orderBy: { quantityMilli: "asc" } });
    assert.deepEqual(moves.map((m) => [m.kind, m.quantityMilli]), [["order", -4000], ["order", -3000]]);
    assert.ok(moves.every((m) => m.orderNumber?.startsWith("A-")));
  });

  it("negativer Bestand ist erlaubt: der Abschluss gelingt, der Bestand wird negativ und ist als solcher sichtbar", async () => {
    const a = await article({ minStock: "2" });
    await receive(a, "1");
    const id = await orderWith([[a, 3]]);
    assert.ok((await close(id)).ok, "kein harter Fehler");
    assert.equal(await stock(a), -2000);
    const { stockCounts, lowStockArticles } = queries;
    assert.deepEqual(await stockCounts(), { all: 1, low: 1, negative: 1 });
    assert.equal((await lowStockArticles())[0].id, a);
  });

  it("schlägt eine Buchung fehl, bleibt der Auftrag offen und keine Bewegung entsteht (atomar)", async () => {
    const a = await article();
    const b = await article();
    await receive(a, "10");
    await receive(b, "10");
    const id = await orderWith([[a, 2], [b, 2]]);
    const real = (await import("@/modules/operation-hooks")).operationHooks;
    // der letzte Abonnent wirft nach der Lagerbuchung
    hooks.setOperationHooksForTest([...real, { operation: "orders.close", feature: "workshop.parts", run: () => { throw new Error("Rechnung nicht erreichbar"); } }]);
    await assert.rejects(() => close(id));
    hooks.setOperationHooksForTest(null);
    assert.deepEqual([await stock(a), await stock(b)], [10_000, 10_000]);
    assert.equal(await env.db.stockMovement.count({ where: { kind: "order" } }), 0);
    assert.equal((await env.db.order.findUniqueOrThrow({ where: { id } })).status, "in_progress");
    assert.ok((await close(id)).ok);
    assert.deepEqual([await stock(a), await stock(b)], [8_000, 8_000]);
  });

  it("Wieder öffnen bucht zurück; erneutes Abschließen bucht wieder ab; mehrfach Öffnen und Schließen bleibt richtig (nie doppelt)", async () => {
    const a = await article();
    await receive(a, "10");
    const id = await orderWith([[a, 3]]);
    await close(id);
    assert.equal(await stock(a), 7000);
    assert.ok((await reopen(id)).ok);
    assert.equal(await stock(a), 10_000);
    assert.deepEqual((await env.db.stockMovement.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } })).map((m) => [m.kind, m.quantityMilli]), [["order", -3000], ["reversal", 3000]]);
    // Positionen ändern und erneut schließen
    await orderOps.saveItemsOperation.execute(advisor, {
      id,
      version: await versionNow(id),
      items: JSON.stringify([{ description: "Teil", unit: "Stk", quantityMilli: 5000, unitCents: 1000, taxBp: 1900, discountBp: 0, kind: "part", refType: "article", refId: a }]),
    });
    await close(id);
    assert.equal(await stock(a), 5000);
    await reopen(id);
    await close(id);
    await reopen(id);
    assert.equal(await stock(a), 10_000, "nach jedem Wiederöffnen ist alles zurückgebucht");
    const net = (await env.db.stockMovement.findMany({ where: { orderId: id } })).reduce((sum, m) => sum + m.quantityMilli, 0);
    assert.equal(net, 0);
  });

  it("Wiederöffnen eines Auftrags ohne Lagerbuchungen ändert nichts; Stornieren bucht nichts", async () => {
    const a = await article();
    await receive(a, "4");
    const id = await orderWith([[a, 1]]);
    await orderOps.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "cancelled" });
    assert.equal(await stock(a), 4000);
    assert.equal(await env.db.stockMovement.count({ where: { kind: { in: ["order", "reversal"] } } }), 0);
  });

  it("Positionen mit unbekanntem Artikelverweis werden beim Speichern abgelehnt (Hook auf orders.saveItems)", async () => {
    const created = await orderOps.createOrderOperation.execute(advisor, { vehicleId });
    assert.ok(created.ok);
    const id = created.data.id;
    const bad = await orderOps.saveItemsOperation.execute(advisor, {
      id,
      version: await versionNow(id),
      items: JSON.stringify([{ description: "Teil", unit: "Stk", quantityMilli: 1000, unitCents: 1, taxBp: 1900, discountBp: 0, kind: "part", refType: "article", refId: "gibtsnicht" }]),
    });
    assert.ok(!bad.ok && bad.failure.fields?.["items.0.refId"]);
    assert.equal(await env.db.orderItem.count({ where: { orderId: id } }), 0);
  });

  it("ist die Funktion Teile & Lager aus, bucht der Abschluss nichts (Hooks laufen nur für aktive Funktionen)", async () => {
    const a = await article();
    await receive(a, "10");
    const id = await orderWith([[a, 2]]);
    await env.db.featureSetting.update({ where: { key: "workshop.parts" }, data: { enabled: false } });
    const { getSession } = await import("@/server/auth/session");
    const role = await env.role({ permissions: ADVISOR.filter((p) => !p.startsWith("parts.")) });
    env.signOut();
    await env.signIn(await env.user({ username: `off-${Math.random()}`, roles: [role] }));
    const offSession = (await getSession())!;
    try {
      assert.ok((await orderOps.closeOrderOperation.execute(offSession, { id, version: await versionNow(id) })).ok);
      assert.equal(await stock(a), 10_000);
    } finally {
      await env.db.featureSetting.update({ where: { key: "workshop.parts" }, data: { enabled: true } });
    }
  });
});

describe("Verbrauchte Teile (Abschnitt der Auftragsseite)", () => {
  it("zeigt je Teile-Position Artikel, Bestand und ob gebucht; Warnung vor dem Abschluss, wenn der Bestand nicht reicht", async () => {
    const a = await article();
    await receive(a, "1");
    const id = await orderWith([[a, 3]]);
    const lines = (await (await import("@/modules/workshop/orders/queries")).orderLines(id))!.items;
    let rows = await queries.consumedParts(id, lines);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].article?.stockMilli, rows[0].bookedMilli], [1000, 0]);
    await close(id);
    rows = await queries.consumedParts(id, lines);
    assert.deepEqual([rows[0].article?.stockMilli, rows[0].bookedMilli], [-2000, 3000]);
    assert.deepEqual(await queries.consumedParts(id, []), []);
  });
});

describe("Rückbuchung nach Bilanz (Fix-Runde 12b: M1, N3)", () => {
  const savePartLines = async (id: string, lines: Array<[string, number]>) =>
    orderOps.saveItemsOperation.execute(advisor, {
      id,
      version: await versionNow(id),
      items: JSON.stringify(lines.map(([articleId, qty]) => ({ description: "Teil", unit: "Stk", quantityMilli: qty * 1000, unitCents: 1000, taxBp: 1900, discountBp: 0, kind: "part", refType: "article", refId: articleId }))),
    });
  /** Wiederöffnen bei ausgeschalteter Funktion Teile & Lager (die Hooks laufen dann nicht) */
  const reopenWhilePartsOff = async (id: string) => {
    await env.db.featureSetting.update({ where: { key: "workshop.parts" }, data: { enabled: false } });
    try {
      const adminOff = await sessionFor([], { admin: true });
      assert.ok(!adminOff.features.has("workshop.parts"));
      assert.ok((await orderOps.reopenOrderOperation.execute(adminOff, { id, version: await versionNow(id) })).ok);
    } finally {
      await env.db.featureSetting.update({ where: { key: "workshop.parts" }, data: { enabled: true } });
    }
  };

  it("negative Menge (Gutschriftsposition): Abschluss bucht Zugang, Wiederöffnen bucht ihn zurück – der Bestand wächst nicht bei jedem Zyklus", async () => {
    const a = await article();
    await receive(a, "10");
    const id = await orderWith([]);
    assert.ok((await savePartLines(id, [[a, -2]])).ok);
    assert.ok((await close(id)).ok);
    assert.equal(await stock(a), 12_000);
    assert.ok((await reopen(id)).ok);
    assert.equal(await stock(a), 10_000, "Wiederöffnen stellt den Zustand vor dem Abschluss her");
    assert.ok((await close(id)).ok);
    assert.equal(await stock(a), 12_000, "nicht 14 000: nie doppelt");
    await reopen(id);
    await close(id);
    await reopen(id);
    assert.equal(await stock(a), 10_000);
    assert.equal((await env.db.stockMovement.findMany({ where: { orderId: id } })).reduce((sum, m) => sum + m.quantityMilli, 0), 0);
  });

  it("gemischte Vorzeichen derselben Ware in einem Auftrag: Saldo je Artikel, in beide Richtungen, auch bei geänderten Positionen", async () => {
    const a = await article();
    const b = await article();
    await receive(a, "10");
    await receive(b, "10");
    const id = await orderWith([]);
    assert.ok((await savePartLines(id, [[a, 5], [a, -2], [b, -1], [b, 1]])).ok);
    assert.ok((await close(id)).ok);
    assert.deepEqual([await stock(a), await stock(b)], [7000, 10_000], "a: −3, b: Summe 0 → keine Buchung");
    assert.equal(await env.db.stockMovement.count({ where: { orderId: id, articleId: b } }), 0);
    await reopen(id);
    assert.deepEqual([await stock(a), await stock(b)], [10_000, 10_000]);
    assert.ok((await savePartLines(id, [[a, -4]])).ok);
    await close(id);
    assert.equal(await stock(a), 14_000);
    await reopen(id);
    await close(id);
    assert.equal(await stock(a), 14_000);
    await reopen(id);
    assert.equal(await stock(a), 10_000);
  });

  it("Abschluss bucht nur die Differenz zur Bilanz: wurde beim Wiederöffnen nicht zurückgebucht (Funktion aus), gibt es keine Doppelbuchung; geänderte Menge: nur der Unterschied", async () => {
    const a = await article();
    await receive(a, "10");
    const id = await orderWith([[a, 3]]);
    assert.ok((await close(id)).ok);
    assert.equal(await stock(a), 7000);
    await reopenWhilePartsOff(id);
    assert.equal(await stock(a), 7000, "bei ausgeschalteter Funktion bucht das Wiederöffnen nichts zurück");
    assert.ok((await close(id)).ok);
    assert.equal(await stock(a), 7000, "Bilanz −3 000 entspricht schon dem Verbrauch: keine zweite Abbuchung");
    assert.equal(await env.db.stockMovement.count({ where: { orderId: id } }), 1);
    await reopenWhilePartsOff(id);
    assert.ok((await savePartLines(id, [[a, 5]])).ok);
    assert.ok((await close(id)).ok);
    assert.equal(await stock(a), 5000, "Differenz −2 000 gebucht");
    assert.ok((await reopen(id)).ok);
    assert.equal(await stock(a), 10_000);
  });

  it("Stornieren eines wieder geöffneten Auftrags mit offenen Buchungen (Funktion war aus) gibt sie frei; danach bucht nichts mehr", async () => {
    const a = await article();
    await receive(a, "10");
    const id = await orderWith([[a, 3]]);
    await close(id);
    await reopenWhilePartsOff(id);
    assert.equal(await stock(a), 7000);
    assert.ok((await orderOps.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "cancelled" })).ok);
    assert.equal(await stock(a), 10_000);
    await orderOps.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "accepted" });
    await orderOps.setStatusOperation.execute(advisor, { id, version: await versionNow(id), status: "cancelled" });
    assert.equal(await stock(a), 10_000);
  });
});

describe("Bestandsbewegung und Version des Artikels (N8)", () => {
  it("eine Buchung ändert die Version der Stammdaten nicht: ein vorher geladenes Bearbeiten-Formular meldet keinen Konflikt", async () => {
    const a = await article();
    const before = versionOf(await env.db.article.findUniqueOrThrow({ where: { id: a } }));
    await receive(a, "5");
    await ops.countOperation.execute(warehouse, { counts: { [a]: "3" } });
    const id = await orderWith([[a, 1]]);
    await close(id);
    const row = await env.db.article.findUniqueOrThrow({ where: { id: a } });
    assert.equal(versionOf(row), before, "Version unverändert");
    assert.equal(row.stockMilli, 2000);
    const saved = await ops.saveArticleOperation.execute(warehouse, { id: a, version: before, number: row.number, name: "Neuer Name", unit: "Stk" });
    assert.ok(saved.ok, "kein Konflikt durch Buchungen");
    assert.equal(await stock(a), 2000, "der Bestand bleibt");
    const stale = await ops.saveArticleOperation.execute(warehouse, { id: a, version: before, number: row.number, name: "Noch einer", unit: "Stk" });
    assert.equal(!stale.ok && stale.failure.code, "conflict", "eine echte zweite Bearbeitung mit der alten Version bleibt ein Konflikt");
  });
});
