import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ByteBudget, RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("erlaubt bis zur Grenze, weist danach mit der Wartezeit ab und gibt nach dem Fenster wieder frei", () => {
    let now = 1000;
    const limiter = new RateLimiter({ max: 3, windowMs: 10_000, now: () => now });
    assert.deepEqual([limiter.take("a"), limiter.take("a"), limiter.take("a")], [{ allowed: true }, { allowed: true }, { allowed: true }]);
    now += 4000;
    assert.deepEqual(limiter.take("a"), { allowed: false, retryAfterMs: 6000 });
    now += 6000; // alle drei (gleichzeitig vermerkt) fallen heraus
    assert.deepEqual([limiter.take("a"), limiter.take("a"), limiter.take("a")], [{ allowed: true }, { allowed: true }, { allowed: true }]);
    assert.equal(limiter.take("a").allowed, false);
  });

  it("jeder Schlüssel (Benutzer) hat sein eigenes Fenster; abgewiesene Anfragen verlängern nichts", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, now: () => now });
    assert.equal(limiter.take("u1").allowed, true);
    assert.equal(limiter.take("u2").allowed, true, "anderer Benutzer unbeeinflusst");
    for (let i = 0; i < 20; i++) {
      now += 10;
      assert.equal(limiter.take("u1").allowed, false);
    }
    now = 1000; // genau ein Fenster nach der ersten erlaubten Anfrage – trotz der abgewiesenen dazwischen
    assert.equal(limiter.take("u1").allowed, true);
  });

  it("der Speicher ist begrenzt: bei Überlauf fallen zuerst Schlüssel ohne Anfragen im Fenster, nie unbegrenztes Wachstum", () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 5, windowMs: 1000, maxKeys: 3, now: () => now });
    for (const key of ["a", "b", "c"]) limiter.take(key);
    now += 2000; // alle drei sind abgelaufen
    for (const key of ["d", "e", "f", "g"]) limiter.take(key);
    assert.ok((limiter as unknown as { hits: Map<string, unknown> }).hits.size <= 3);
    // mitten im Fenster: die ältesten Schlüssel gehen, der neue wird nicht ausgesperrt
    for (const key of ["h", "i", "j", "k"]) assert.equal(limiter.take(key).allowed, true);
    assert.ok((limiter as unknown as { hits: Map<string, unknown> }).hits.size <= 3);
  });
});

describe("ByteBudget", () => {
  it("begrenzt die Bytes je Schlüssel im gleitenden Fenster; die Wartezeit nennt, wann wieder Platz ist", () => {
    let now = 0;
    const budget = new ByteBudget({ maxBytes: 100, windowMs: 1000, now: () => now });
    assert.equal(budget.take("u", 60).allowed, true);
    now = 300;
    assert.equal(budget.take("u", 30).allowed, true);
    const refused = budget.take("u", 20);
    assert.deepEqual(refused, { allowed: false, retryAfterMs: 700 }, "wenn die ersten 60 Bytes herausfallen (t = 1000)");
    assert.equal(budget.take("andere", 100).allowed, true, "eigenes Fenster je Schlüssel");
    now = 1000;
    assert.equal(budget.take("u", 20).allowed, true);
    assert.equal(budget.take("u", 101).allowed, false, "eine einzelne Anfrage über der Grenze");
  });
});
