import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitBytes } from "./bytes";

describe("Größenangaben", () => {
  it("wählt die Einheit, sodass der Wert unter 1024 bleibt", () => {
    assert.deepEqual(splitBytes(0), { value: 0, unit: "B" });
    assert.deepEqual(splitBytes(1023), { value: 1023, unit: "B" });
    assert.deepEqual(splitBytes(1024), { value: 1, unit: "KB" });
    assert.deepEqual(splitBytes(1536), { value: 1.5, unit: "KB" });
    assert.deepEqual(splitBytes(5 * 1024 ** 3), { value: 5, unit: "GB" });
    assert.deepEqual(splitBytes(3 * 1024 ** 4), { value: 3, unit: "TB" });
    assert.equal(splitBytes(5000 * 1024 ** 4).unit, "TB", "größer als TB bleibt TB");
  });
  it("negative Werte werden zu 0", () => {
    assert.deepEqual(splitBytes(-5), { value: 0, unit: "B" });
  });
});
