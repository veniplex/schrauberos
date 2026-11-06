import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FallbackBoundary } from "./widget-boundary";

describe("Fehlergrenze für Dashboard-Bausteine", () => {
  it("zeigt den Inhalt, solange nichts wirft, und nach einem Fehler nur den Ersatz", () => {
    const boundary = new FallbackBoundary({ children: "Inhalt", fallback: () => "Ersatz" });
    assert.equal(boundary.render(), "Inhalt");
    // So setzt React den Zustand, wenn ein Kind beim Rendern wirft
    boundary.state = FallbackBoundary.getDerivedStateFromError();
    assert.equal(boundary.render(), "Ersatz");
  });

  it("reicht dem Ersatz eine Funktion zum erneuten Versuch", () => {
    let received: unknown;
    const boundary = new FallbackBoundary({ children: "Inhalt", fallback: (retry) => ((received = retry), "Ersatz") });
    boundary.state = FallbackBoundary.getDerivedStateFromError();
    boundary.render();
    assert.equal(typeof received, "function");
  });
});
