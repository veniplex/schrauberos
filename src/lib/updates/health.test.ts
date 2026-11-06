import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { healthVerdict, isStarting } from "./health";

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

describe("Startet die App noch?", () => {
  it("nur ein 503 mit status „starting“ zählt – alles andere verlängert das Gesundheitsfenster nicht", () => {
    assert.equal(isStarting(503, { status: "starting" }), true);
    for (const [status, body] of [[200, { status: "starting" }], [503, { status: "error" }], [503, { status: "reinstall" }], [503, null], [503, "starting"], [502, { status: "starting" }]] as const) {
      assert.equal(isStarting(status, body), false, JSON.stringify([status, body]));
    }
  });
});
