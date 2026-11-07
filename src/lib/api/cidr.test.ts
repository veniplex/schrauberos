import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressToBigInt, ipInNets, netsOf, parseNet, parseNetList, MAX_NETS } from "./cidr";

describe("Adressbereiche (CIDR) für Token", () => {
  it("liest IPv4/IPv6-Adressen und Bereiche; /0, zu lange Längen und Unsinn sind ungültig", () => {
    for (const ok of ["10.0.0.0/8", "203.0.113.7", "203.0.113.0/24", "2001:db8::/32", "::1", "fe80::1/64", "0.0.0.0/1"]) assert.ok(parseNet(ok), ok);
    for (const bad of ["", "10.0.0.0/0", "10.0.0.0/33", "::/129", "10.0.0/8", "256.1.1.1", "1.2.3.4/", "1.2.3.4/a", "hallo", "10.0.0.0/8/8", "1.2.3.4/-1", "::g"]) assert.equal(parseNet(bad), null, bad);
  });

  it("prüft Zugehörigkeit; IPv4-gemappt ist dieselbe Adresse; Familien vermischen sich nie; ohne Adresse oder ohne Bereiche nie", () => {
    const nets = netsOf("203.0.113.0/24\n2001:db8::/32\n192.0.2.9");
    assert.equal(ipInNets("203.0.113.1", nets), true);
    assert.equal(ipInNets("203.0.114.1", nets), false);
    assert.equal(ipInNets("192.0.2.9", nets), true);
    assert.equal(ipInNets("192.0.2.10", nets), false);
    assert.equal(ipInNets("2001:db8:ffff::1", nets), true);
    assert.equal(ipInNets("2001:db9::1", nets), false);
    assert.equal(ipInNets("::ffff:203.0.113.200", nets), true);
    assert.equal(ipInNets("::ffff:cb00:7101", nets), true, "gemappt in Hex-Schreibweise");
    assert.equal(ipInNets("::ffff:198.51.100.1", nets), false);
    assert.equal(ipInNets(null, nets), false);
    assert.equal(ipInNets("kein-ip", nets), false);
    assert.equal(ipInNets("203.0.113.1", []), false, "eine leere Liste erlaubt nichts");
    // ein IPv6-Bereich trifft keine IPv4-Adresse mit gleichen Zahlen
    assert.equal(ipInNets("0.0.0.1", netsOf("::/1")), false);
    assert.equal(addressToBigInt("1.2.3.4")?.family, 4);
    assert.equal(addressToBigInt("::ffff:1.2.3.4")?.family, 4);
    assert.equal(addressToBigInt("2001:db8::1")?.family, 6);
  });

  it("Liste: Zeilen, Komma und Leerzeichen trennen; Doppelte entfallen; leer = keine Beschränkung; höchstens 20; Fehler nennt den Eintrag", () => {
    assert.deepEqual(parseNetList("  "), { ok: true, nets: [], text: null });
    assert.deepEqual(parseNetList(null), { ok: true, nets: [], text: null });
    const list = parseNetList("10.0.0.0/8, 10.0.0.0/8\n192.168.0.0/16 2001:db8::/32;::1");
    assert.ok(list.ok);
    assert.equal(list.ok && list.text, "10.0.0.0/8\n192.168.0.0/16\n2001:db8::/32\n::1");
    const bad = parseNetList("10.0.0.0/8\nkaputt");
    assert.deepEqual(bad, { ok: false, reason: "invalid", entry: "kaputt" });
    const tooMany = parseNetList(Array.from({ length: MAX_NETS + 1 }, (_, i) => `10.0.${i}.0/24`).join("\n"));
    assert.deepEqual(tooMany, { ok: false, reason: "tooMany" });
    assert.ok(parseNetList(Array.from({ length: MAX_NETS }, (_, i) => `10.0.${i}.0/24`).join("\n")).ok);
  });

  it("gespeicherter Text mit kaputten Zeilen: nur die gültigen gelten (enger, nie weiter)", () => {
    assert.equal(netsOf("unsinn\n10.0.0.0/8").length, 1);
    assert.equal(netsOf("unsinn").length, 0);
    assert.equal(netsOf(null).length, 0);
  });
});
