import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimed, versionDate, versionOf } from "./concurrency";

describe("Optimistische Sperre", () => {
  it("macht aus dem Änderungszeitpunkt eine Version und zurück", () => {
    const row = { updatedAt: new Date("2026-11-06T10:15:30.123Z") };
    assert.equal(versionDate(versionOf(row))?.getTime(), row.updatedAt.getTime());
  });

  it("lehnt fehlende und ungültige Versionen ab", () => {
    for (const bad of [undefined, null, "", "abc", "-5", "1e9", "99999999999999999999"]) assert.equal(versionDate(bad), null);
  });

  it("belegt die Zeile nur bei unveränderter Version", async () => {
    // Minimaler Ersatz für eine Tabelle: nur die erste Speicherung mit passender Version gewinnt
    let current = 1000;
    const table = async (stamp: Date, next: Date) => {
      assert.ok(next.getTime() > stamp.getTime());
      if (stamp.getTime() !== current) return { count: 0 };
      current += 1;
      return { count: 1 };
    };
    assert.equal(await claimed("1000", table), true);
    assert.equal(await claimed("1000", table), false); // zweite Person mit der alten Version
    assert.equal(await claimed("1001", table), true);
  });

  it("meldet Konflikt ohne gültige Version, ohne die Zeile anzufassen", async () => {
    let called = false;
    assert.equal(
      await claimed(undefined, async () => {
        called = true;
        return { count: 1 };
      }),
      false,
    );
    assert.equal(called, false);
  });
});
