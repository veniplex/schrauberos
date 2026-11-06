import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeError, stripControl } from "./log-safe";

describe("Log-Hygiene", () => {
  it("entfernt Steuerzeichen und kürzt", () => {
    assert.equal(stripControl("a\r\nb\u001b[31mc\t"), "a b [31mc");
    assert.equal(stripControl("x".repeat(300), 10).length, 10);
  });
  it("beschreibt Fehler nur mit Art und Code", () => {
    const error = Object.assign(new Error("Unique constraint failed on username=geheim"), { code: "P2002" });
    const text = describeError(error);
    assert.equal(text, "Error P2002");
    assert.ok(!text.includes("geheim"));
    assert.equal(describeError("zeichenkette"), "string");
  });
});
