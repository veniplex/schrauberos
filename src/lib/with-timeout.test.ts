import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTimeout } from "./with-timeout";

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("withTimeout", () => {
  it("liefert das Ergebnis, wenn die Aufgabe rechtzeitig fertig ist", async () => {
    assert.equal(await withTimeout(later(5, "ja"), 200, "zu spät"), "ja");
  });

  it("liefert den Ersatzwert, wenn die Aufgabe zu lange braucht (und ihr spätes Ergebnis stört nicht)", async () => {
    assert.equal(await withTimeout(later(100, "ja"), 10, "zu spät"), "zu spät");
    await later(120, null);
  });

  it("ein Fehler vor Ablauf wird weitergereicht, ein Fehler danach verschluckt", async () => {
    await assert.rejects(withTimeout(Promise.reject(new Error("kaputt")), 200, "x"), /kaputt/);
    const slowFailure = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("spät")), 60));
    assert.equal(await withTimeout(slowFailure, 10, "Ersatz"), "Ersatz");
    await later(80, null); // kein unbehandelter Fehler: der Test bricht sonst ab
  });
});
