import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { offsiteNetwork } from "@/lib/offsite/host-policy";
import { hostHeader, normalizeTarget, targetKey, targetLabel, type TargetInput } from "./target";

before(() => {
  offsiteNetwork.allowLoopback = false;
});

const check = (input: Partial<TargetInput> & { host: string }) => {
  const result = normalizeTarget({ kind: "tcp", port: 22, ...input });
  return result.ok ? "ok" : `${result.problem.field}:${result.problem.key}`;
};

describe("Zielsperre (Eingabe)", () => {
  it("Loopback, der eigene Rechner, ‚dieses Netz‘, Link-Local samt Metadaten, Multicast und Reserviertes sind in jeder Schreibweise gesperrt", () => {
    for (const host of [
      "127.0.0.1",
      "127.1",
      "127.255.255.254",
      "localhost",
      "LOCALHOST.",
      "foo.localhost",
      "ip6-localhost",
      "[::1]",
      "::1",
      "::ffff:127.0.0.1",
      "[::ffff:7f00:1]",
      "2130706433",
      "0x7f000001",
      "0177.0.0.1",
      "0",
      "0.0.0.0",
      "::",
      "169.254.169.254",
      "169.254.0.5",
      "2852039166",
      "0xa9fea9fe",
      "[::ffff:a9fe:a9fe]",
      "fe80::1",
      "fd00:ec2::254",
      "100.100.100.200",
      "168.63.129.16",
      "metadata.google.internal",
      "224.0.0.1",
      "239.255.255.250",
      "ff02::1",
      "255.255.255.255",
      "240.0.0.1",
      "64:ff9b::7f00:1",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b:1::1",
      "100::1",
      "2002:7f00:1::1",
    ]) {
      assert.equal(check({ host }), "host:forbiddenHost", host);
    }
  });

  it("die Namen des Docker-Hosts sind wie localhost gesperrt (die Adresse dahinter sperrt das Host-Gateway beim Speichern und Verbinden)", () => {
    for (const host of ["host.docker.internal", "HOST.DOCKER.INTERNAL", "host.docker.internal.", "gateway.docker.internal", "host.containers.internal", "host.lima.internal"]) assert.equal(check({ host }), "host:forbiddenHost", host);
    assert.equal(check({ host: "docker.internal.example" }), "ok", "ein ähnlicher, anderer Name bleibt erlaubt");
  });

  it("das interne Netz ist erlaubt: RFC 1918, Carrier-NAT, ULA, öffentliche Adressen und Namen", () => {
    for (const host of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.10.1", "100.64.0.1", "fd12:3456::1", "[fc00::1]", "8.8.8.8", "2001:4860:4860::8888", "nas.firma.example", "NAS.Firma.Example.", "sw-core-01"]) {
      assert.equal(check({ host }), "ok", host);
    }
  });

  it("Schreibweisen werden vereinheitlicht gespeichert (kleingeschrieben, Dezimal → Punkte, ohne Klammern)", () => {
    const r = normalizeTarget({ kind: "tcp", host: "NAS.Firma.Example.", port: 22 });
    assert.ok(r.ok && r.value.host === "nas.firma.example");
    const dec = normalizeTarget({ kind: "tcp", host: "3232235777", port: 22 });
    assert.ok(dec.ok && dec.value.host === "192.168.1.1", "Dezimal-Schreibweise wird zur Adresse und als solche bewertet");
    const v6 = normalizeTarget({ kind: "tcp", host: "[FD12:3456::1]", port: 22 });
    assert.ok(v6.ok && v6.value.host === "fd12:3456::1");
  });

  it("alles, was kein einfacher Host ist, wird abgelehnt: @, /, ?, #, Leerraum, Steuerzeichen, Nicht-ASCII, leer, zu lang", () => {
    for (const host of ["a@b", "user:pw@host", "host/pfad", "host?x=1", "host#frag", "ho st", "ho\nst", "host\r\nX: y", "höst.de", "", "   ", "a".repeat(254), "host;rm", "ho%20st", "[::1", "host\\x"]) {
      assert.notEqual(check({ host }), "ok", JSON.stringify(host));
    }
    assert.equal(check({ host: "user@192.168.1.1" }), "host:credentials");
  });
});

describe("Port, Art, Pfad, Intervall", () => {
  it("Port 1–65535; bei HTTP/HTTPS Standard 80/443; bei TCP ist er Pflicht", () => {
    for (const port of [0, -1, 65536, 1.5, Number.NaN]) assert.equal(check({ host: "10.0.0.1", port }), "port:port", String(port));
    assert.equal(check({ host: "10.0.0.1", port: 1 }), "ok");
    assert.equal(check({ host: "10.0.0.1", port: 65535 }), "ok");
    assert.equal(check({ host: "10.0.0.1", port: undefined }), "port:port");
    const http = normalizeTarget({ kind: "http", host: "10.0.0.1" });
    const https = normalizeTarget({ kind: "https", host: "10.0.0.1" });
    assert.ok(http.ok && http.value.port === 80 && http.value.path === "/");
    assert.ok(https.ok && https.value.port === 443);
  });

  it("unbekannte Art und Anfrage werden abgelehnt (nur tcp/http/https, HEAD/GET); TCP kennt keinen Pfad und immer HEAD", () => {
    assert.equal(check({ host: "10.0.0.1", kind: "icmp" }), "kind:invalid");
    assert.equal(check({ host: "10.0.0.1", kind: "ftp" }), "kind:invalid");
    assert.equal(check({ host: "10.0.0.1", kind: "https", method: "POST" }), "method:invalid");
    assert.equal(check({ host: "10.0.0.1", kind: "https", method: "DELETE" }), "method:invalid");
    const tcp = normalizeTarget({ kind: "tcp", host: "10.0.0.1", port: 22, path: "/x", method: "GET" });
    assert.ok(tcp.ok && tcp.value.path === null && tcp.value.method === "HEAD");
  });

  it("Pfad: beginnt mit /, höchstens 300 Zeichen, kein Leerraum/Steuerzeichen/#/Rückstrich, kann den Host nicht wechseln, keine Zugangsdaten", () => {
    const path = (p: string) => check({ kind: "https", host: "10.0.0.1", port: 443, path: p });
    assert.equal(path("/status?x=1&y=2"), "ok");
    assert.equal(path("/a/b/c.html"), "ok");
    for (const bad of ["status", "//evil.example/x", "/\\\\evil.example", "/a b", "/a\r\nHost: evil", "/a\tb", "/x#frag", "http://evil.example/", "/" + "a".repeat(300), "/\u0000"]) {
      assert.notEqual(path(bad), "ok", JSON.stringify(bad));
    }
    // Nicht-ASCII im Pfad wird prozentkodiert (die Anfragezeile bleibt einfaches ASCII)
    const umlaut = normalizeTarget({ kind: "https", host: "10.0.0.1", port: 443, path: "/ä" });
    assert.ok(umlaut.ok && umlaut.value.path === "/%C3%A4");
    const encoded = normalizeTarget({ kind: "https", host: "10.0.0.1", port: 443, path: "/a%20b" });
    assert.ok(encoded.ok && encoded.value.path === "/a%20b");
  });

  it("eine eingefügte Adresse wird zerlegt; Zugangsdaten darin und fremde Schemata sind verboten", () => {
    const r = normalizeTarget({ kind: "tcp", host: "https://nas.firma.example:8443/status?x=1" });
    assert.ok(r.ok);
    assert.deepEqual([r.value.kind, r.value.host, r.value.port, r.value.path], ["https", "nas.firma.example", 8443, "/status?x=1"]);
    assert.equal(check({ host: "https://user:pw@nas.firma.example/" }), "host:credentials");
    assert.equal(check({ host: "https://user@nas.firma.example/" }), "host:credentials");
    assert.equal(check({ host: "ftp://nas.firma.example/" }), "host:invalid");
    assert.equal(check({ host: "file:///etc/passwd" }), "host:invalid");
    assert.equal(check({ host: "http://127.0.0.1:8080/" }), "host:forbiddenHost");
    assert.equal(check({ host: "http://169.254.169.254/latest/meta-data" }), "host:forbiddenHost");
    assert.equal(check({ host: "http://[::1]/" }), "host:forbiddenHost");
  });

  it("Intervall mindestens 60 s, höchstens 24 h, ganzzahlig; Standard 300 s", () => {
    for (const intervalSec of [0, 1, 59, 86_401, 60.5]) assert.equal(check({ host: "10.0.0.1", intervalSec }), "intervalSec:interval", String(intervalSec));
    assert.equal(check({ host: "10.0.0.1", intervalSec: 60 }), "ok");
    assert.equal(check({ host: "10.0.0.1", intervalSec: 86_400 }), "ok");
    const d = normalizeTarget({ kind: "tcp", host: "10.0.0.1", port: 22 });
    assert.ok(d.ok && d.value.intervalSec === 300);
  });
});

describe("Hilfen", () => {
  it("Schlüssel doppelter Ziele ist unabhängig von Groß-/Kleinschreibung des Hosts", () => {
    assert.equal(targetKey({ kind: "tcp", host: "NAS", port: 22, path: null }), targetKey({ kind: "tcp", host: "nas", port: 22, path: null }));
    assert.notEqual(targetKey({ kind: "https", host: "nas", port: 443, path: "/a" }), targetKey({ kind: "https", host: "nas", port: 443, path: "/b" }));
  });
  it("Host-Kopfzeile: IPv6 in Klammern, Port nur abweichend vom Standard", () => {
    assert.equal(hostHeader("https", "nas.example", 443), "nas.example");
    assert.equal(hostHeader("https", "nas.example", 8443), "nas.example:8443");
    assert.equal(hostHeader("http", "fd12::1", 80), "[fd12::1]");
    assert.equal(hostHeader("http", "fd12::1", 8080), "[fd12::1]:8080");
  });
  it("lesbare Zieladresse", () => {
    assert.equal(targetLabel({ kind: "tcp", host: "10.0.0.1", port: 22, path: null }), "tcp://10.0.0.1:22");
    assert.equal(targetLabel({ kind: "https", host: "nas", port: 8443, path: "/x" }), "https://nas:8443/x");
    assert.equal(targetLabel({ kind: "http", host: "fd12::1", port: 80, path: "/" }), "http://[fd12::1]/");
  });
});
