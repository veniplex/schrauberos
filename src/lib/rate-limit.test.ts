import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter } from "./rate-limit";

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
