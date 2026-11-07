import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { healthVerdict, isStarting, isUnresponsiveError, positiveMs, probeHealth } from "./health";

describe("Health-Bewertung des Launchers", () => {
  it("unterscheidet gesund, abwarten und endgültig", () => {
    assert.equal(healthVerdict(200, { status: "ok" }), "ok");
    assert.equal(healthVerdict(503, { status: "starting" }), "wait");
    assert.equal(healthVerdict(503, { status: "error" }), "wait");
    assert.equal(healthVerdict(503, { status: "reinstall", message: "x" }), "fatal");
    assert.equal(healthVerdict(502, null), "wait");
    assert.equal(healthVerdict(500, { status: "reinstall" }), "wait");
    assert.equal(healthVerdict(503, "reinstall"), "wait");
  });
});

describe("Startet die App noch?", () => {
  it("nur ein 503 mit status „starting“ zählt – alles andere verlängert das Gesundheitsfenster nicht", () => {
    assert.equal(isStarting(503, { status: "starting" }), true);
    for (const [status, body] of [[200, { status: "starting" }], [503, { status: "error" }], [503, { status: "reinstall" }], [503, null], [503, "starting"], [502, { status: "starting" }]] as const) {
      assert.equal(isStarting(status, body), false, JSON.stringify([status, body]));
    }
  });
});

describe("Health-Abfrage mit echtem Netzwerk", () => {
  const sockets = new Set<net.Socket>();
  const listen = (server: net.Server) => {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    return new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(String((server.address() as AddressInfo).port))));
  };
  const close = (server: net.Server) =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const socket of sockets) socket.destroy();
    });

  it("liest die Antwort einer App, die „starting“ meldet (so wie sie jetzt wirklich antwortet: 503 mit status)", async () => {
    const server = http.createServer((_req, res) => res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "starting" })));
    const port = await listen(server);
    try {
      const reply = await probeHealth(port, 1000);
      assert.deepEqual(reply, { status: 503, body: { status: "starting" } });
      assert.equal(isStarting(reply!.status, reply!.body), true);
    } finally {
      await close(server);
    }
  });

  it("Verbindung angenommen, aber keine Antwort (Event-Loop blockiert) → unresponsive; Verbindung verweigert → null", async () => {
    // Der Server nimmt die Verbindung an (Kernel), liest und antwortet aber nie – wie eine App im synchronen Migrationsschritt
    const silent = net.createServer(() => undefined);
    const port = await listen(silent);
    try {
      assert.deepEqual(await probeHealth(port, 150), { status: 0, body: null, unresponsive: true });
    } finally {
      await close(silent);
    }
    // Niemand lauscht mehr auf diesem Port
    assert.equal(await probeHealth(port, 500), null);
  });

  it("erkennt die Fehlerarten", () => {
    assert.equal(isUnresponsiveError(new DOMException("timed out", "TimeoutError")), true);
    assert.equal(isUnresponsiveError(new DOMException("aborted", "AbortError")), true);
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    assert.equal(isUnresponsiveError(refused), false);
    assert.equal(isUnresponsiveError(new TypeError("fetch failed")), false);
    assert.equal(isUnresponsiveError("TimeoutError"), false);
  });
});

describe("Wartezeiten aus der Umgebung", () => {
  it("leer, keine Zahl, null oder negativ → Standardwert (NaN würde die Frist auf 0 setzen)", () => {
    for (const bad of [undefined, "", "abc", "NaN", "0", "-5", "Infinity"]) assert.equal(positiveMs(bad, 90_000), 90_000, String(bad));
    assert.equal(positiveMs("120000", 90_000), 120_000);
    assert.equal(positiveMs("1500.7", 90_000), 1500);
  });
});
