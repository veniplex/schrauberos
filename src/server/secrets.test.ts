import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { decryptSecret, encryptSecret } from "./secrets";

const dir = mkdtempSync(path.join(tmpdir(), "so-secrets-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_URL = `file:${path.join(dir, "none.db")}`; // frische Datenbank: nichts Verschlüsseltes, ein Schlüssel darf angelegt werden
after(() => rmSync(dir, { recursive: true, force: true }));

describe("Geheimnisse", () => {
  it("verschlüsselt und entschlüsselt", () => {
    const blob = encryptSecret("ghp_geheim");
    assert.ok(!blob.includes("ghp_geheim"));
    assert.equal(decryptSecret(blob), "ghp_geheim");
  });

  it("erzeugt bei jedem Aufruf andere Chiffretexte", () => {
    assert.notEqual(encryptSecret("x"), encryptSecret("x"));
  });

  it("liefert null bei manipulierten oder fremden Daten", () => {
    const blob = encryptSecret("x");
    assert.equal(decryptSecret(blob.slice(0, -4) + "AAAA"), null);
    assert.equal(decryptSecret("müll"), null);
    assert.equal(decryptSecret("v2:a:b:c"), null);
  });
});
