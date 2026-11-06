import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { healthVerdict } from "./health";

describe("Health-Bewertung des Launchers", () => {
  it("unterscheidet gesund, abwarten und endgültig", () => {
    assert.equal(healthVerdict(200, { status: "ok" }), "ok");
    assert.equal(healthVerdict(503, { status: "starting" }), "wait");
    assert.equal(healthVerdict(503, { status: "error" }), "wait");
    assert.equal(healthVerdict(503, { status: "reinstall", message: "x" }), "fatal");
    assert.equal(healthVerdict(502, null), "wait");
    assert.equal(healthVerdict(500, { status: "reinstall" }), "wait");
    assert.equal(healthVerdict(503, "reinstall"), "wait");
  });
});
