import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Lückenlose Zähler: Zuwachs je Schlüssel und Jahr, Rollback gibt die Nummer zurück, parallele Transaktionen vergeben jede Nummer genau einmal. */
let env: TestEnv;
let counters: typeof import("./counters");
before(async () => {
  env = await createTestEnv();
  counters = await import("./counters");
});
after(() => env.cleanup());
beforeEach(() => env.db.counter.deleteMany());

describe("nextCounterValue", () => {
  it("beginnt bei 1 und zählt je Schlüssel und Jahr getrennt", async () => {
    assert.deepEqual([await counters.nextCounterValue(env.db, "orders", 2026), await counters.nextCounterValue(env.db, "orders", 2026), await counters.nextCounterValue(env.db, "orders", 2027)], [1, 2, 1]);
    assert.equal(await counters.nextCounterValue(env.db, "invoices", 2026), 1);
    assert.equal(await counters.nextCounterValue(env.db, "plain"), 1);
    assert.equal(await counters.nextCounterValue(env.db, "plain"), 2);
    assert.equal(await env.db.counter.count(), 4);
  });

  it("eine zurückgerollte Transaktion gibt die Nummer zurück (keine Lücke)", async () => {
    await counters.nextCounterValue(env.db, "orders", 2026);
    await assert.rejects(() =>
      env.db.$transaction(async (tx) => {
        assert.equal(await counters.nextCounterValue(tx, "orders", 2026), 2);
        throw new Error("abgebrochen");
      }),
    );
    assert.equal(await counters.nextCounterValue(env.db, "orders", 2026), 2);
  });

  it("parallele Transaktionen bekommen verschiedene, lückenlose Nummern", async () => {
    const values = await Promise.all(Array.from({ length: 12 }, () => env.db.$transaction((tx) => counters.nextCounterValue(tx, "orders", 2026))));
    assert.deepEqual([...values].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1));
  });
});
