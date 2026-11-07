import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cidrsOverlap, compareIPv4, formatIPv4, freeRanges, ipInCidr, nextFreeIp, normalizeMac, overlappingSubnets, parseCidr, parseIPv4, warrantyState } from "./domain";

describe("IPv4", () => {
  test("parse/format Roundtrip", () => {
    assert.equal(formatIPv4(parseIPv4("192.168.10.5")!), "192.168.10.5");
    assert.equal(parseIPv4("255.255.255.255"), 0xffffffff);
  });
  test("ungültige Adressen", () => {
    for (const bad of ["", "1.2.3", "256.1.1.1", "1.2.3.4.5", "a.b.c.d", "1.2.3.-4"]) assert.equal(parseIPv4(bad), null, bad);
  });
  test("numerisch sortieren", () => {
    assert.deepEqual(["10.0.0.20", "10.0.0.3", "10.0.0.100"].sort(compareIPv4), ["10.0.0.3", "10.0.0.20", "10.0.0.100"]);
  });
});

describe("CIDR", () => {
  test("/24", () => {
    const c = parseCidr("192.168.10.0/24")!;
    assert.equal(formatIPv4(c.first), "192.168.10.1");
    assert.equal(formatIPv4(c.last), "192.168.10.254");
    assert.equal(c.hosts, 254);
  });
  test("/30 hat 2 Hosts", () => {
    assert.equal(parseCidr("10.0.0.0/30")!.hosts, 2);
  });
  test("lehnt Host-Adresse als Netz, zu große/kleine Netze und Unsinn ab", () => {
    for (const bad of ["192.168.1.5/24", "10.0.0.0/8", "10.0.0.1/31", "10.0.0.0", "x/24", "10.0.0.0/33", "10.0.0.5/32x"]) assert.equal(parseCidr(bad), null, bad);
  });
  test("/31 (Punkt-zu-Punkt): beide Adressen nutzbar, keine Broadcast-Adresse", () => {
    const c = parseCidr("10.0.0.0/31")!;
    assert.deepEqual([formatIPv4(c.first), formatIPv4(c.last), c.hosts], ["10.0.0.0", "10.0.0.1", 2]);
    assert.equal(ipInCidr("10.0.0.0", "10.0.0.0/31"), true);
    assert.equal(ipInCidr("10.0.0.1", "10.0.0.0/31"), true);
    assert.equal(ipInCidr("10.0.0.2", "10.0.0.0/31"), false);
    assert.equal(nextFreeIp("10.0.0.0/31", ["10.0.0.0"]), "10.0.0.1");
    assert.equal(nextFreeIp("10.0.0.0/31", ["10.0.0.0", "10.0.0.1"]), null);
    assert.notEqual(parseCidr("10.0.0.2/31"), null, "gerade Netzadresse");
    assert.equal(parseCidr("10.0.0.3/31"), null, "ungerade Adresse ist keine Netzadresse");
  });
  test("/32 (einzelner Host): genau eine nutzbare Adresse", () => {
    const c = parseCidr("10.0.0.7/32")!;
    assert.deepEqual([formatIPv4(c.first), formatIPv4(c.last), c.hosts, c.network === c.broadcast], ["10.0.0.7", "10.0.0.7", 1, true]);
    assert.equal(ipInCidr("10.0.0.7", "10.0.0.7/32"), true);
    assert.equal(ipInCidr("10.0.0.8", "10.0.0.7/32"), false);
    assert.deepEqual(freeRanges("10.0.0.7/32", []), [{ from: "10.0.0.7", to: "10.0.0.7", count: 1 }]);
  });
  test("/30 bleibt bei zwei nutzbaren Adressen (Netz und Broadcast fallen weg)", () => {
    const c = parseCidr("10.0.0.0/30")!;
    assert.deepEqual([formatIPv4(c.first), formatIPv4(c.last)], ["10.0.0.1", "10.0.0.2"]);
  });
  test("ipInCidr: Netz- und Broadcastadresse gelten nicht als Host", () => {
    assert.equal(ipInCidr("192.168.10.77", "192.168.10.0/24"), true);
    assert.equal(ipInCidr("192.168.10.0", "192.168.10.0/24"), false);
    assert.equal(ipInCidr("192.168.10.255", "192.168.10.0/24"), false);
    assert.equal(ipInCidr("192.168.11.5", "192.168.10.0/24"), false);
  });
});

describe("freie Adressen", () => {
  test("Lücken werden zu Bereichen zusammengefasst", () => {
    const r = freeRanges("10.0.0.0/29", ["10.0.0.1", "10.0.0.4"]);
    assert.deepEqual(r, [
      { from: "10.0.0.2", to: "10.0.0.3", count: 2 },
      { from: "10.0.0.5", to: "10.0.0.6", count: 2 },
    ]);
  });
  test("leeres Netz: ein Bereich; volles Netz: keiner", () => {
    assert.deepEqual(freeRanges("10.0.0.0/30", []), [{ from: "10.0.0.1", to: "10.0.0.2", count: 2 }]);
    assert.deepEqual(freeRanges("10.0.0.0/30", ["10.0.0.1", "10.0.0.2"]), []);
  });
  test("Adressen außerhalb des Netzes werden ignoriert", () => {
    assert.equal(nextFreeIp("10.0.0.0/30", ["10.9.9.9"]), "10.0.0.1");
    assert.equal(nextFreeIp("10.0.0.0/30", ["10.0.0.1", "10.0.0.2"]), null);
  });
});

describe("MAC", () => {
  test("normalisiert gängige Schreibweisen", () => {
    assert.equal(normalizeMac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF");
    assert.equal(normalizeMac("aabb.ccdd.eeff"), "AA:BB:CC:DD:EE:FF");
    assert.equal(normalizeMac("AABBCCDDEEFF"), "AA:BB:CC:DD:EE:FF");
  });
  test("ungültige MACs", () => {
    for (const bad of ["", "aa:bb", "zz:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:ff:00"]) assert.equal(normalizeMac(bad), null, bad);
  });
});

describe("Garantie", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  test("Zustände", () => {
    assert.equal(warrantyState(null, 90, now), null);
    assert.equal(warrantyState(new Date("2026-10-01"), 90, now), "expired");
    assert.equal(warrantyState(new Date("2027-01-15"), 90, now), "soon");
    assert.equal(warrantyState(new Date("2028-01-01"), 90, now), "ok");
  });
});

describe("Überschneidung von Netzen", () => {
  test("gleiche Netze, Teilnetze und Randfälle (Netz- und Broadcast-Adresse, /31, /32)", () => {
    assert.equal(cidrsOverlap("192.168.10.0/24", "192.168.10.0/24"), true);
    assert.equal(cidrsOverlap("192.168.0.0/16", "192.168.10.0/24"), true, "ein Netz im anderen");
    assert.equal(cidrsOverlap("192.168.10.0/24", "192.168.0.0/16"), true, "unabhängig von der Reihenfolge");
    assert.equal(cidrsOverlap("192.168.10.0/24", "192.168.11.0/24"), false, "aneinandergrenzend ist keine Überschneidung");
    assert.equal(cidrsOverlap("192.168.10.0/25", "192.168.10.128/25"), false);
    assert.equal(cidrsOverlap("192.168.10.0/25", "192.168.10.0/24"), true);
    assert.equal(cidrsOverlap("10.0.0.0/31", "10.0.0.1/32"), true, "/32 in /31");
    assert.equal(cidrsOverlap("10.0.0.0/31", "10.0.0.2/31"), false);
    assert.equal(cidrsOverlap("10.0.0.255/32", "10.0.0.0/24"), true, "die Broadcast-Adresse gehört zum Netz");
    assert.equal(cidrsOverlap("10.0.0.0/32", "10.0.1.0/32"), false);
    assert.equal(cidrsOverlap("kein netz", "10.0.0.0/24"), false);
  });
  test("overlappingSubnets lässt das Netz selbst aus", () => {
    const all = [
      { id: "a", cidr: "10.0.0.0/24" },
      { id: "b", cidr: "10.0.0.0/25" },
      { id: "c", cidr: "10.1.0.0/24" },
    ];
    assert.deepEqual(overlappingSubnets("10.0.0.0/24", all, "a").map((s) => s.id), ["b"]);
    assert.deepEqual(overlappingSubnets("10.0.0.0/24", all).map((s) => s.id), ["a", "b"]);
  });
});
