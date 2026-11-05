import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareIPv4, formatIPv4, freeRanges, ipInCidr, nextFreeIp, normalizeMac, parseCidr, parseIPv4, warrantyState } from "./network";

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
    for (const bad of ["192.168.1.5/24", "10.0.0.0/8", "10.0.0.0/31", "10.0.0.0", "x/24", "10.0.0.0/33"]) assert.equal(parseCidr(bad), null, bad);
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
