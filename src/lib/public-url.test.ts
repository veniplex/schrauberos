import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePublicUrl, publicLink } from "./public-url";

describe("Adresse der Anwendung (lib/public-url)", () => {
  it("normalisiert zur Herkunft: ohne Schrägstrich am Ende, Groß-/Kleinschreibung des Hosts, Standardport", () => {
    assert.deepEqual(parsePublicUrl("https://Werkstatt.Example/"), { ok: true, value: "https://werkstatt.example" });
    assert.deepEqual(parsePublicUrl("  https://werkstatt.example  "), { ok: true, value: "https://werkstatt.example" });
    assert.deepEqual(parsePublicUrl("http://192.168.1.10:3000"), { ok: true, value: "http://192.168.1.10:3000" });
    assert.deepEqual(parsePublicUrl("https://werkstatt.example:443"), { ok: true, value: "https://werkstatt.example" });
    assert.deepEqual(parsePublicUrl("http://[::1]:3000"), { ok: true, value: "http://[::1]:3000" });
  });

  it("lehnt alles ab, was keine reine Herkunft ist", () => {
    assert.deepEqual(parsePublicUrl(""), { ok: false, error: "empty" });
    assert.deepEqual(parsePublicUrl("   "), { ok: false, error: "empty" });
    assert.deepEqual(parsePublicUrl("werkstatt.example"), { ok: false, error: "invalid" });
    assert.deepEqual(parsePublicUrl("javascript:alert(1)"), { ok: false, error: "scheme" });
    assert.deepEqual(parsePublicUrl("ftp://werkstatt.example"), { ok: false, error: "scheme" });
    assert.deepEqual(parsePublicUrl("data:text/html,x"), { ok: false, error: "scheme" });
    assert.deepEqual(parsePublicUrl("https://user:pw@werkstatt.example"), { ok: false, error: "credentials" });
    assert.deepEqual(parsePublicUrl("https://user@werkstatt.example"), { ok: false, error: "credentials" });
    assert.deepEqual(parsePublicUrl("https://werkstatt.example/app"), { ok: false, error: "extra" });
    assert.deepEqual(parsePublicUrl("https://werkstatt.example/?x=1"), { ok: false, error: "extra" });
    assert.deepEqual(parsePublicUrl("https://werkstatt.example/#a"), { ok: false, error: "extra" });
    assert.deepEqual(parsePublicUrl(`https://${"a".repeat(250)}.example`), { ok: false, error: "invalid" });
  });

  it("publicLink baut absolute Adressen nur mit gesetzter Herkunft und führendem Schrägstrich", () => {
    assert.equal(publicLink("https://werkstatt.example", "/tires/abc"), "https://werkstatt.example/tires/abc");
    assert.equal(publicLink(null, "/tires/abc"), null);
    assert.equal(publicLink("https://werkstatt.example", "tires/abc"), null);
  });
});
