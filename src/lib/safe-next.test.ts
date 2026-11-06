import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("lässt interne Pfade samt Suchparametern durch", () => {
    assert.equal(safeNext("/appointments?view=day&date=2026-05-01"), "/appointments?view=day&date=2026-05-01");
    assert.equal(safeNext("/vehicles/abc#details"), "/vehicles/abc#details");
    assert.equal(safeNext("/"), "/");
  });

  it("weist fremde Ziele und Tricks ab", () => {
    for (const evil of ["/\\x", "/%5Cx", "/\\t/x", "/\t/x", "/\n/x", "//x", "///x", "/\\/x", "javascript:alert(1)", "https://evil.example", "http://evil.example/", "evil.example", "", "x", "\\\\evil.example"]) {
      const result = safeNext(evil);
      assert.ok(result.startsWith("/") && !result.startsWith("//") && !result.includes("\\"), `${JSON.stringify(evil)} → ${result}`);
      assert.equal(new URL(result, "http://schrauberos.invalid").origin, "http://schrauberos.invalid", `${JSON.stringify(evil)} → ${result}`);
    }
    // die klar fremden Ziele fallen auf den Standard zurück
    for (const evil of ["/\\x", "/%5Cx", "/%5cx", "/\\t/x", "/\t/x", "//x", "javascript:alert(1)", "https://evil.example", "evil.example", "", "x"]) assert.equal(safeNext(evil), "/", JSON.stringify(evil));
  });

  it("nimmt keine Nicht-Texte und keine Anmeldeseite als Ziel", () => {
    assert.equal(safeNext(null), "/");
    assert.equal(safeNext(undefined), "/");
    assert.equal(safeNext(["/x"]), "/");
    assert.equal(safeNext("/login"), "/");
    assert.equal(safeNext("/login?next=/x"), "/");
    assert.equal(safeNext("/loginx"), "/loginx");
  });

  it("begrenzt die Länge", () => {
    assert.equal(safeNext(`/${"a".repeat(3000)}`), "/");
  });
});
