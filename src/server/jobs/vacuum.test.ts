import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Freien Platz zurückgeben (Z7): `auto_vacuum = INCREMENTAL` der neuen Datenbank + begrenzter, wiederholbarer Aufräumschritt. */
let env: TestEnv;
let vacuum: typeof import("./vacuum");
before(async () => {
  env = await createTestEnv();
  vacuum = await import("./vacuum");
});
after(() => env.cleanup());

const size = () => statSync(path.join(env.dir, "test.db")).size;
const fill = async (n: number) => {
  await env.db.auditLog.createMany({ data: Array.from({ length: n }, (_, i) => ({ actorName: "t", action: "test.fill", target: `x${i}-${"y".repeat(1500)}` })) });
};

describe("Datenbank: freien Platz zurückgeben", () => {
  it("die Testdatenbank (wie jede neue) ist inkrementell; die Anwendung sieht Betriebsart und freie Seiten", async () => {
    const space = await vacuum.databaseSpace(env.db);
    assert.equal(space.mode, 2);
    assert.equal(space.pageSize, 4096);
  });

  it("Löschen gibt Seiten nur auf die Freiliste; der Lauf gibt sie in Schritten zurück, begrenzt je Lauf, und die Datei schrumpft", async () => {
    await env.db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    const empty = size();
    await fill(4000);
    await env.db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    const grown = size();
    assert.ok(grown > empty + 4_000_000, `Datei gewachsen (${empty} → ${grown})`);
    await env.db.auditLog.deleteMany();
    await env.db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    assert.equal(size(), grown, "gelöscht, aber die Datei ist noch so groß");
    const before = await vacuum.databaseSpace(env.db);
    assert.ok(before.freePages > 900, `freie Seiten ${before.freePages}`);

    // begrenzt: höchstens maxPages je Lauf, der Rest bleibt für den nächsten Lauf
    const first = await vacuum.runIncrementalVacuum({ client: env.db, maxPages: 300, stepPages: 100 });
    assert.equal(first.released, 300);
    assert.equal(first.remaining, before.freePages - 300);
    assert.match(vacuum.describeVacuum(first) ?? "", /300 Seiten.*verbleiben/);

    const second = await vacuum.runIncrementalVacuum({ client: env.db });
    assert.equal(second.remaining, 0);
    assert.equal(second.released, before.freePages - 300);
    await env.db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    assert.ok(size() < empty + 200_000, `Datei geschrumpft (${grown} → ${size()})`);

    // wiederholbar und billig, wenn nichts zu tun ist
    const idle = await vacuum.runIncrementalVacuum({ client: env.db });
    assert.deepEqual([idle.released, idle.remaining], [0, 0]);
    assert.equal(vacuum.describeVacuum(idle), undefined, "nichts zu melden");
  });

  it("Zeitbudget und Abbruch beenden den Lauf früh, ohne Fehler; die Daten bleiben unberührt", async () => {
    await fill(1500);
    const kept = await env.db.auditLog.count();
    await env.db.auditLog.deleteMany({ where: { id: { in: (await env.db.auditLog.findMany({ take: 1000, select: { id: true } })).map((r) => r.id) } } });
    const controller = new AbortController();
    controller.abort();
    const aborted = await vacuum.runIncrementalVacuum({ client: env.db, signal: controller.signal });
    assert.equal(aborted.released, 0);
    const timeUp = await vacuum.runIncrementalVacuum({ client: env.db, budgetMs: 0 });
    assert.equal(timeUp.released, 0);
    assert.equal(await env.db.auditLog.count(), kept - 1000);
  });

  it("eine Datenbank mit anderer Betriebsart wird übersprungen und nicht angefasst", async () => {
    const fake = { $queryRawUnsafe: async (sql: string) => (sql.includes("auto_vacuum") ? [{ auto_vacuum: 0 }] : sql.includes("freelist") ? [{ freelist_count: 50 }] : [{ page_size: 4096 }]) };
    const result = await vacuum.runIncrementalVacuum({ client: fake as never });
    assert.deepEqual(result, { released: 0, remaining: 50, bytes: 0, skipped: "mode" });
    assert.match(vacuum.describeVacuum(result) ?? "", /übersprungen/);
  });
});
