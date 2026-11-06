import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStaleDeploymentError, mayAutoReload } from "./stale-deployment";

describe("Veralteter Tab nach Web-Update", () => {
  it("erkennt „Server Action nicht gefunden“", () => {
    assert.ok(isStaleDeploymentError(Object.assign(new Error("x"), { name: "UnrecognizedActionError" })));
    assert.ok(isStaleDeploymentError(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.')));
  });
  it("hält andere Fehler nicht dafür", () => {
    assert.equal(isStaleDeploymentError(new Error("Datenbank gesperrt")), false);
    assert.equal(isStaleDeploymentError("Failed to find Server Action"), false);
    assert.equal(isStaleDeploymentError(null), false);
    assert.equal(isStaleDeploymentError(undefined), false);
  });
  it("lädt höchstens einmal je Zeitfenster automatisch neu (keine Schleife)", () => {
    assert.equal(mayAutoReload(null, 1_000), true);
    assert.equal(mayAutoReload(1_000, 5_000), false);
    assert.equal(mayAutoReload(1_000, 40_000), true);
    assert.equal(mayAutoReload(50_000, 1_000), true); // Uhr zurückgestellt
  });
});
