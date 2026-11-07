import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { endAfterStartChange } from "./absence-dates";

describe("endAfterStartChange (Bis zieht Von nach)", () => {
  it("Ende stand noch auf dem alten Beginn: folgt dem neuen", () => {
    assert.equal(endAfterStartChange("2026-07-01", "2026-07-01", "2026-07-08"), "2026-07-08");
  });
  it("Ende läge vor dem neuen Beginn: folgt", () => {
    assert.equal(endAfterStartChange("2026-07-03", "2026-07-01", "2026-07-08"), "2026-07-08");
  });
  it("leeres Ende: wird gesetzt", () => {
    assert.equal(endAfterStartChange("", "", "2026-07-08"), "2026-07-08");
  });
  it("bewusst späteres Ende bleibt (Zeitraum wird nur nach hinten verschoben, solange das Ende dahinter liegt)", () => {
    assert.equal(endAfterStartChange("2026-07-20", "2026-07-01", "2026-07-08"), "2026-07-20");
  });
  it("Beginn gelöscht: Ende bleibt", () => {
    assert.equal(endAfterStartChange("2026-07-20", "2026-07-01", ""), "2026-07-20");
  });
});
