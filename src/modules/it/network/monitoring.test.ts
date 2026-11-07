import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getStatusProvider, noMonitoring } from "./monitoring";

describe("Erreichbarkeit ohne Überwachung", () => {
  test("jedes Gerät hat den Status „unbekannt“, auch wenn die Überwachung vorgemerkt ist – es gibt keine erfundenen Werte", async () => {
    const result = await noMonitoring.check([
      { id: "a", monitorEnabled: false },
      { id: "b", monitorEnabled: true },
    ]);
    for (const id of ["a", "b"]) {
      assert.equal(result.get(id)?.state, "unknown");
      assert.equal(result.get(id)?.latencyMs, null);
    }
  });
  test("der Anbieter der Anwendung ist „keine Überwachung“", () => {
    assert.equal(getStatusProvider().id, "none");
  });
});
