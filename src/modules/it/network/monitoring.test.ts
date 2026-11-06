import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { demoProvider, demoState, hash01 } from "./monitoring";

describe("Demo-Status", () => {
  test("hash01 ist stabil und liegt in [0,1)", () => {
    assert.equal(hash01("abc"), hash01("abc"));
    for (const s of ["", "a", "gerät-1", "x".repeat(200)]) {
      const h = hash01(s);
      assert.ok(h >= 0 && h < 1, String(h));
    }
  });
  test("Zustand je Gerät ist deterministisch", () => {
    assert.equal(demoState("dev-1"), demoState("dev-1"));
  });
  test("Verteilung ist plausibel (überwiegend online, einzelne Ausfälle)", () => {
    const counts = { online: 0, degraded: 0, offline: 0 };
    for (let i = 0; i < 1000; i++) counts[demoState(`device-${i}`)]++;
    assert.ok(counts.online > 700 && counts.online < 860, JSON.stringify(counts));
    assert.ok(counts.offline > 40 && counts.offline < 160, JSON.stringify(counts));
  });
  test("nicht überwachte Geräte sind 'unknown', alle Werte als Demo markiert", async () => {
    const r = await demoProvider.check([
      { id: "a", monitorEnabled: false },
      { id: "b", monitorEnabled: true },
    ]);
    assert.equal(r.get("a")!.state, "unknown");
    assert.equal(r.get("b")!.demo, true);
    const b = r.get("b")!;
    assert.equal(b.state === "offline", b.latencyMs === null);
  });
});
