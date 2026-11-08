import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LINEAR_MAX_RATIO, measureLinearity } from "./timing";

describe("measureLinearity", () => {
  const spin = (iterations: number) => {
    let x = 0;
    for (let i = 0; i < iterations; i++) x = (x + i * 31) % 1_000_003;
    return x;
  };

  it("erkennt lineares Verhalten (≈ 4) und quadratisches (≈ 16) – unabhängig von der absoluten Geschwindigkeit des Rechners", () => {
    const linear = measureLinearity((n) => n, (n) => spin(n * 200_000), 5);
    const quadratic = measureLinearity((n) => n, (n) => spin(n * n * 400_000), 5);
    assert.ok(linear.ratio < LINEAR_MAX_RATIO, `linear: ${linear.ratio.toFixed(1)}`);
    assert.ok(quadratic.ratio > LINEAR_MAX_RATIO, `quadratisch: ${quadratic.ratio.toFixed(1)}`);
  });

  it("eine sehr schnelle Aufgabe fällt nie als nicht linear auf (die kleine Messung zählt mindestens floorMs)", () => {
    const tiny = measureLinearity((n) => n, (n) => n * 2, 10);
    assert.ok(tiny.ratio < LINEAR_MAX_RATIO);
    assert.ok(tiny.smallMs >= 5);
  });
});
