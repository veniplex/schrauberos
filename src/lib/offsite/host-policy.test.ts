import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { afterEach, describe, it } from "node:test";
import { allowLoopbackForTests, canonicalHost, isAllowedAddress, isForbiddenHost, isPrivateAddress, offsiteNetwork } from "./host-policy";
import { normalizeWebdavUrl, validateHost } from "./target";

/**
 * Richtlinie für Ziele des Off-Site-Backups (ZP5-6): kein eigener Rechner, kein Verbindungs-lokal, keine Metadaten-Dienste – in jeder Schreibweise; private Netze (NAS im LAN)
 * sind erlaubt. Loopback gibt es nur in Tests.
 */
afterEach(() => {
  offsiteNetwork.allowLoopback = false;
});

const FORBIDDEN = [
  // Metadaten-Dienst, auch in den Schreibweisen, die vorher durchgingen
  "169.254.169.254", "2852039166", "0xa9fea9fe", "0251.0376.0251.0376", "0xA9.0xFE.0xA9.0xFE", "169.254.0.5", "169.254.169.254.",
  "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:a9fe:a9fe", "[::ffff:169.254.169.254]", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "2001:0:1:2:3:4:5601:5601",
  "fd00:ec2::254", "[fd00:ec2::254]", "FD00:EC2:0:0:0:0:0:254", "100.100.100.200", "168.63.129.16", "metadata.google.internal", "METADATA.GOOGLE.INTERNAL.", "instance-data",
  // nicht angebbare oder eigene Ziele
  "0", "0.0.0.0", "0.1.2.3", "::", "[::]", "0:0:0:0:0:0:0:0", "255.255.255.255", "224.0.0.1", "239.255.255.250", "240.0.0.1", "ff02::1", "[ff02::1]", "fe80::1", "[fe80::1]", "fe80::1%eth0", "febf::1",
  // eigener Rechner
  "127.0.0.1", "127.1", "127.255.255.254", "2130706433", "0x7f.1", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:7f00:1", "::ffff:127.0.0.1", "::127.0.0.1", "localhost", "LOCALHOST", "localhost.", "foo.localhost",
];
const ALLOWED = ["192.168.1.20", "10.0.0.5", "172.16.0.1", "172.31.255.254", "100.64.0.5", "8.8.8.8", "1.1.1.1", "fd12:3456:789a::1", "fc00::1", "2001:db8::1", "2606:4700:4700::1111", "[2606:4700:4700::1111]", "::ffff:c0a8:0114", "nas.local", "backup.example.org", "nas", "xn--bcher-kva.example", "169.253.1.1", "169.255.1.1"];

describe("Adressrichtlinie für Off-Site-Ziele", () => {
  for (const host of FORBIDDEN) {
    it(`verboten: ${host}`, () => {
      assert.equal(isForbiddenHost(host), true, host);
      assert.equal(validateHost(host), "forbiddenHost", host);
    });
  }
  for (const host of ALLOWED) {
    it(`erlaubt: ${host}`, () => {
      assert.equal(isForbiddenHost(host), false, host);
      assert.equal(validateHost(host), null, host);
    });
  }

  it("schreibweisen werden wie die kanonische Adresse behandelt", () => {
    assert.deepEqual(canonicalHost("2852039166"), { kind: "ip", ip: "169.254.169.254" });
    assert.deepEqual(canonicalHost("0xa9fea9fe"), { kind: "ip", ip: "169.254.169.254" });
    assert.deepEqual(canonicalHost("0251.0376.0251.0376"), { kind: "ip", ip: "169.254.169.254" });
    assert.deepEqual(canonicalHost("0"), { kind: "ip", ip: "0.0.0.0" });
    assert.deepEqual(canonicalHost("[::1]"), { kind: "ip", ip: "::1" });
    assert.deepEqual(canonicalHost("NAS.Local."), { kind: "name", name: "nas.local" });
    assert.equal(canonicalHost(""), null);
    assert.equal(canonicalHost("a b"), null);
    assert.equal(canonicalHost("x".repeat(300)), null);
  });

  it("WebDAV-Adressen: die gleichen Umgehungen scheitern, HTTPS bleibt Pflicht", () => {
    for (const url of [
      "https://169.254.169.254/latest", "https://2852039166/", "https://0xa9fea9fe/", "https://0251.0376.0251.0376/", "https://[::ffff:169.254.169.254]/", "https://[::ffff:a9fe:a9fe]/",
      "https://[fd00:ec2::254]/", "https://[::1]/dav", "https://127.0.0.1/dav", "https://localhost/dav", "https://0/dav", "https://metadata.google.internal/",
    ]) {
      assert.deepEqual(normalizeWebdavUrl(url), { ok: false, problem: "forbiddenHost" }, url);
    }
    assert.deepEqual(normalizeWebdavUrl("http://127.0.0.1:8080/dav"), { ok: false, problem: "scheme" }, "Klartext-HTTP auch für den eigenen Rechner nicht (nur in Tests)");
    assert.deepEqual(normalizeWebdavUrl("http://nas.local/dav"), { ok: false, problem: "scheme" });
    assert.deepEqual(normalizeWebdavUrl("https://192.168.1.20:5006/dav/backups/"), { ok: true, url: "https://192.168.1.20:5006/dav/backups" });
    assert.deepEqual(normalizeWebdavUrl("https://nas.local/dav"), { ok: true, url: "https://nas.local/dav" });
  });

  it("Loopback gibt es nur mit dem Test-Schalter, und der Schalter lässt sich im Betrieb nicht setzen", () => {
    const saved = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    try {
      assert.throws(() => allowLoopbackForTests(), /nur in Tests/);
      assert.equal(offsiteNetwork.allowLoopback, false);
    } finally {
      if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
    }
    process.env.NODE_TEST_CONTEXT ??= "child-v8";
    allowLoopbackForTests();
    assert.equal(isAllowedAddress("127.0.0.1"), true);
    assert.equal(isAllowedAddress("::1"), true);
    assert.equal(isForbiddenHost("localhost"), false);
    assert.deepEqual(normalizeWebdavUrl("http://127.0.0.1:8080/dav"), { ok: true, url: "http://127.0.0.1:8080/dav" });
    // alles andere bleibt verboten
    assert.equal(isAllowedAddress("169.254.169.254"), false);
    assert.equal(isAllowedAddress("::ffff:a9fe:a9fe"), false);
    assert.equal(isAllowedAddress("0.0.0.0"), false);
  });
});

describe("Private Netze (Freigabe für Mail-Relays und Webhooks)", () => {
  it("RFC 1918, Carrier-NAT und IPv6-ULA sind privat – auch als eingebettete IPv4-Adresse –, öffentliche Adressen nicht", () => {
    for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.10", "100.64.0.1", "100.127.255.254", "fd12:3456::1", "fc00::1", "::ffff:192.168.0.5", "::ffff:a00:1"]) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.169.0.1", "11.0.0.1", "2001:4860:4860::8888", "fe00::1", "::ffff:8.8.8.8", "kein-host", "", "999.1.1.1"]) assert.equal(isPrivateAddress(ip), false, ip);
  });

  it("Loopback ist nur mit dem Test-Schalter privat; die Sperren (Metadaten, Verbindungs-lokal) bleiben davon unberührt", () => {
    assert.equal(isPrivateAddress("127.0.0.1"), false);
    assert.equal(isPrivateAddress("::1"), false);
    allowLoopbackForTests();
    assert.equal(isPrivateAddress("127.0.0.1"), true);
    assert.equal(isPrivateAddress("::1"), true);
    assert.equal(isPrivateAddress("169.254.169.254"), false);
    assert.equal(isAllowedAddress("169.254.169.254"), false);
  });
});

describe("Eigene Schnittstellenadressen (auch in gemappter und anderer IPv6-Schreibweise)", () => {
  const own = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .map((info) => info.address.split("%")[0])
    .filter((address) => !/^(127\.|::1$|fe80:)/i.test(address));

  it("jede eigene Adresse ist verboten – in jeder Schreibweise (IPv4, IPv4-gemappt dezimal und hexadezimal, IPv6 groß/ausgeschrieben)", { skip: own.length === 0 ? "keine eigene Nicht-Loopback-Adresse in dieser Umgebung" : false }, () => {
    for (const address of own) {
      assert.equal(isAllowedAddress(address), false, address);
      assert.equal(isForbiddenHost(address), true, address);
      const v4 = address.split(".").map(Number);
      if (v4.length === 4) {
        const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
        assert.equal(isAllowedAddress(`::ffff:${address}`), false, `::ffff:${address}`);
        assert.equal(isAllowedAddress(`::ffff:${hex(v4[0], v4[1])}:${hex(v4[2], v4[3])}`), false, "gemappt hexadezimal");
        assert.equal(isAllowedAddress(`::FFFF:${hex(v4[0], v4[1]).toUpperCase()}:${hex(v4[2], v4[3]).toUpperCase()}`), false, "gemappt, Großbuchstaben");
        assert.equal(isAllowedAddress(`0:0:0:0:0:ffff:${address}`), false, "ausgeschrieben");
        assert.equal(isForbiddenHost(`[::ffff:${address}]`), true);
      } else {
        assert.equal(isAllowedAddress(address.toUpperCase()), false, "Großbuchstaben");
        assert.equal(isAllowedAddress(`[${address}]`.slice(1, -1)), false);
      }
    }
  });

  it("fremde öffentliche Adressen bleiben erlaubt, auch gemappt", () => {
    assert.equal(isAllowedAddress("::ffff:8.8.8.8"), true);
    assert.equal(isAllowedAddress("::ffff:808:808"), true);
  });
});
