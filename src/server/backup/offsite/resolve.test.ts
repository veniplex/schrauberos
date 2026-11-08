import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { allowLoopbackForTests, offsiteNetwork } from "@/lib/offsite/host-policy";
import { pinnedFetch, resolvePinned } from "./resolve";
import { OffsiteError } from "./transport";
import { WebdavTransport } from "./webdav";

/**
 * Namensauflösung vor dem Verbinden (ZP5-6): Alle Antworten werden geprüft, verbunden wird nur mit der geprüften Adresse (kein DNS-Rebinding), Zahlenschreibweisen
 * und IPv4-in-IPv6 umgehen nichts.
 */
afterEach(() => {
  offsiteNetwork.allowLoopback = false;
});

const answer = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof OffsiteError ? error.code : `other:${(error as Error).message}`;
  }
};

describe("resolvePinned", () => {
  it("ein Name mit LAN-Adresse wird auf diese Adresse festgelegt; Literale gelten ohne Auflösung", async () => {
    assert.deepEqual(await resolvePinned("nas.example.org", answer("192.168.1.20")), { address: "192.168.1.20", family: 4 });
    assert.deepEqual(await resolvePinned("nas.example.org", answer("2606:4700:4700::1111", "192.168.1.20")), { address: "2606:4700:4700::1111", family: 6 });
    assert.deepEqual(await resolvePinned("192.168.1.20", async () => assert.fail("kein Lookup für ein Literal")), { address: "192.168.1.20", family: 4 });
    assert.deepEqual(await resolvePinned("[2606:4700:4700::1111]", async () => assert.fail("kein Lookup")), { address: "2606:4700:4700::1111", family: 6 });
  });

  it("das Host-Gateway des Containers (der Docker-Host) ist gesperrt – als Literal, als Name und als Antwort eines Namens", async () => {
    const gateway = await import("@/server/host-gateway");
    gateway.setGatewayTestHooks({ gateways: ["172.17.0.1"] });
    try {
      assert.equal(await codeOf(resolvePinned("172.17.0.1", async () => assert.fail("kein Lookup für ein Literal"))), "forbiddenHost");
      assert.equal(await codeOf(resolvePinned("host.docker.internal", answer("172.17.0.1"))), "forbiddenHost");
      assert.equal(await codeOf(resolvePinned("nas.example.org", answer("172.17.0.1"))), "forbiddenHost");
      assert.equal(await codeOf(resolvePinned("nas.example.org", answer("172.17.0.2"))), "ok", "Nachbarn im selben Netz bleiben erlaubt");
    } finally {
      gateway.setGatewayTestHooks({});
    }
  });

  it("Name, der auf Verbotenes zeigt (Metadaten, Loopback, IPv4-in-IPv6), wird abgewiesen", async () => {
    for (const bad of ["169.254.169.254", "127.0.0.1", "::1", "::ffff:a9fe:a9fe", "fd00:ec2::254", "0.0.0.0", "fe80::1", "224.0.0.1"]) {
      assert.equal(await codeOf(resolvePinned("harmlos.example.org", answer(bad))), "forbiddenHost", bad);
    }
  });

  it("DNS-Rebinding: sobald eine der Antworten verboten ist, wird abgewiesen – in jeder Reihenfolge", async () => {
    assert.equal(await codeOf(resolvePinned("rebind.example.org", answer("203.0.113.5", "169.254.169.254"))), "forbiddenHost");
    assert.equal(await codeOf(resolvePinned("rebind.example.org", answer("169.254.169.254", "203.0.113.5"))), "forbiddenHost");
    // und bei jeder Verbindung neu: eine zweite Auflösung mit anderer Antwort wird einzeln geprüft
    assert.deepEqual(await resolvePinned("rebind.example.org", answer("203.0.113.5")), { address: "203.0.113.5", family: 4 });
    assert.equal(await codeOf(resolvePinned("rebind.example.org", answer("127.0.0.1"))), "forbiddenHost");
  });

  it("verbotene Literale in jeder Schreibweise und verbotene Namen werden ohne Auflösung abgewiesen", async () => {
    for (const host of ["2852039166", "0xa9fea9fe", "0251.0376.0251.0376", "0", "::ffff:a9fe:a9fe", "[::1]", "localhost", "metadata.google.internal", "x.localhost"]) {
      assert.equal(await codeOf(resolvePinned(host, async () => assert.fail("kein Lookup"))), "forbiddenHost", host);
    }
  });

  it("Fehler der Auflösung und leere Antworten werden zu einem Verbindungsfehler", async () => {
    assert.equal(await codeOf(resolvePinned("gibt-es-nicht.example.org", async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })))), "connect");
    assert.equal(await codeOf(resolvePinned("leer.example.org", answer())), "connect");
    assert.equal(await codeOf(resolvePinned("", answer("192.168.1.20"))), "config");
  });
});

describe("pinnedFetch", () => {
  it("verbindet nur die festgelegte Adresse, der Name bleibt im Host-Kopf (hier: ein beliebiger Name zeigt auf den Testserver)", async () => {
    allowLoopbackForTests();
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(`${request.method} ${request.url} host=${request.headers.host}`);
      response.writeHead(207, { "content-type": "application/xml" }).end("<multistatus/>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const fetchPinned = pinnedFetch({ address: "127.0.0.1", family: 4 });
      const response = await fetchPinned(`http://dav.beliebig.example:${port}/pfad`, { method: "PROPFIND", headers: { Depth: "0" }, body: "<x/>" });
      assert.equal(response.status, 207);
      assert.equal(await response.text(), "<multistatus/>");
      assert.deepEqual(seen, [`PROPFIND /pfad host=dav.beliebig.example:${port}`]);
      // Statuscodes ohne Rumpf
      const none = createServer((_request, response) => void response.writeHead(204).end());
      await new Promise<void>((resolve) => none.listen(0, "127.0.0.1", resolve));
      try {
        assert.equal((await fetchPinned(`http://x.example:${(none.address() as AddressInfo).port}/`, { method: "DELETE" })).status, 204);
      } finally {
        none.close();
      }
    } finally {
      server.close();
    }
  });

  it("ein nicht erreichbares Ziel ist ein Verbindungsfehler (wie bei fetch), ein Zeitlimit ein Zeitfehler; das WebDAV-Ziel bildet beides ab", async () => {
    allowLoopbackForTests();
    const t = new WebdavTransport("http://dav.beliebig.example:9/x", { username: "u", password: "p" }, { fetchImpl: pinnedFetch({ address: "127.0.0.1", family: 4 }), requestMs: 3000 });
    assert.equal(await codeOf(t.list()), "connect");
    const slow = createServer(() => undefined);
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    try {
      const timed = new WebdavTransport(`http://dav.beliebig.example:${(slow.address() as AddressInfo).port}/x`, { username: "u", password: "p" }, { fetchImpl: pinnedFetch({ address: "127.0.0.1", family: 4 }), requestMs: 200 });
      assert.equal(await codeOf(timed.list()), "timeout");
    } finally {
      slow.closeAllConnections();
      slow.close();
    }
  });
});
