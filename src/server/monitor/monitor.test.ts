import assert from "node:assert/strict";
import net from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { allowLoopbackForTests, offsiteNetwork } from "@/lib/offsite/host-policy";
import { startHttp, startHttps, startTcp } from "@/test/fake-monitor";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Netzwerk-Überwachung (F12) gegen lokale Gegenstellen: TCP, HTTP, HTTPS (gültig, abgelaufen, kein TLS), Zielsperre beim Verbinden (Rebinding), Zeitlimit, Statusklassen, keine Weiterleitungen, kein Body,
 * Entprellung und Ereignisse, Parallelitätsgrenze, Belegen (kein Doppellauf), faire Verteilung, Aufräumen/Verdichtung und der Gerätestatus aus Messungen. Die Zeit ist fest vorgegeben (`NOW`), nie die reale Uhr.
 */
const NOW = new Date("2026-03-10T10:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

let env: TestEnv;
let probe: typeof import("./probe");
let run: typeof import("./run");
let resolveMod: typeof import("./resolve");
let provider: typeof import("@/modules/it/network/status-provider");

before(async () => {
  env = await createTestEnv();
  allowLoopbackForTests();
  probe = await import("./probe");
  run = await import("./run");
  resolveMod = await import("./resolve");
  provider = await import("@/modules/it/network/status-provider");
});
after(() => env.cleanup());

const lo = (port: number, extra: Partial<Parameters<typeof probe.probeTarget>[0]> = {}) => ({ kind: "tcp", host: "127.0.0.1", port, path: null, method: "HEAD", ignoreTlsErrors: false, ...extra });
/** Ein Port, auf dem nichts lauscht */
const closedPort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

describe("TCP", () => {
  it("offener Port = erreichbar mit Latenz, Klasse „open“; geschlossener Port = „refused“", async () => {
    const server = await startTcp();
    try {
      const up = await probe.probeTarget(lo(server.port));
      assert.deepEqual([up.ok, up.warn, up.statusClass], [true, false, "open"]);
      assert.ok(up.latencyMs !== null && up.latencyMs >= 0 && up.latencyMs < 2000);
    } finally {
      await server.close();
    }
    const down = await probe.probeTarget(lo(await closedPort()));
    assert.deepEqual([down.ok, down.statusClass, down.latencyMs], [false, "refused", null]);
  });

  it("Zeitlimit: eine Verbindung, über die nichts kommt, ist bei HTTP nach dem Limit „timeout“ (hier 250 ms statt 5 s)", async () => {
    const server = await startTcp({ hold: true });
    try {
      const started = performance.now();
      const result = await probe.probeTarget(lo(server.port, { kind: "http", path: "/" }), { timeoutMs: 250 });
      const took = performance.now() - started;
      assert.deepEqual([result.ok, result.statusClass], [false, "timeout"]);
      assert.ok(took >= 200 && took < 2000, `Dauer ${took}`);
    } finally {
      await server.close();
    }
  });

  it("Port außerhalb 1–65535 oder ungültige Art gilt beim Prüfen als gesperrt (die Datenbank könnte verändert sein)", async () => {
    assert.equal((await probe.probeTarget(lo(0))).statusClass, "blocked");
    assert.equal((await probe.probeTarget(lo(70000))).statusClass, "blocked");
    assert.equal((await probe.probeTarget(lo(80, { kind: "icmp" }))).statusClass, "blocked");
    assert.equal((await probe.probeTarget(lo(80, { kind: "http", path: "//evil.example/x" }))).statusClass, "blocked");
    assert.equal((await probe.probeTarget(lo(80, { kind: "http", path: "/a\r\nHost: x" }))).statusClass, "blocked");
  });
});

describe("HTTP", () => {
  it("Statuszeile → Klasse: 200 → 2xx, 301 → 3xx (nicht gefolgt, erreichbar), 404 → 4xx (erreichbar), 503 → 5xx (Warnung)", async () => {
    const server = await startHttp((req) => ({ status: Number(req.url.slice(1)) || 200, location: "/anderswo" }));
    try {
      const outcome = async (status: number) => probe.probeTarget(lo(server.port, { kind: "http", path: `/${status}` }));
      const results = await Promise.all([200, 301, 404, 503].map(outcome));
      assert.deepEqual(results.map((r) => [r.ok, r.warn, r.statusClass]), [
        [true, false, "2xx"],
        [true, false, "3xx"],
        [true, false, "4xx"],
        [true, true, "5xx"],
      ]);
      for (const r of results) assert.ok(r.latencyMs !== null && r.latencyMs >= 0);
      // Weiterleitungen werden nicht verfolgt: nur die vier Anfragen, nie /anderswo
      assert.deepEqual(server.requests.map((r) => r.url).sort(), ["/200", "/301", "/404", "/503"]);
    } finally {
      await server.close();
    }
  });

  it("die Anfrage trägt genau Host, User-Agent, Accept und Connection: close – Methode HEAD, nie ein Body, keine Zugangsdaten", async () => {
    const server = await startHttp();
    try {
      await probe.probeTarget(lo(server.port, { kind: "http", path: "/status?a=1" }));
      const [req] = server.requests;
      assert.equal(req.method, "HEAD");
      assert.equal(req.url, "/status?a=1");
      const names = req.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase()).sort();
      assert.deepEqual(names, ["accept", "connection", "host", "user-agent"]);
      assert.equal(req.headers["user-agent"], "SchrauberOS-Monitor");
      assert.equal(req.headers.connection, "close");
      assert.equal(req.headers.host, `127.0.0.1:${server.port}`);
      await probe.probeTarget(lo(server.port, { kind: "http", path: "/", method: "GET" }));
      assert.equal(server.requests[1].method, "GET");
    } finally {
      await server.close();
    }
  });

  it("der Antwortinhalt wird nie gelesen: eine riesige Antwort ändert nichts am Ergebnis, die Verbindung wird nach der Statuszeile geschlossen", async () => {
    const server = await startHttp(() => ({ status: 200, bodyBytes: 5_000_000 }));
    try {
      const started = performance.now();
      const result = await probe.probeTarget(lo(server.port, { kind: "http", path: "/", method: "GET" }));
      assert.deepEqual([result.ok, result.statusClass], [true, "2xx"]);
      assert.ok(performance.now() - started < 2000);
      assert.deepEqual(Object.keys(result).sort(), ["latencyMs", "ok", "statusClass", "warn"], "zurück kommen nur Auf/Ab, Latenz, Klasse");
    } finally {
      await server.close();
    }
  });

  it("keine gültige HTTP-Antwort (anderes Protokoll, leere Antwort) = „protocol“, ohne etwas zu übernehmen", async () => {
    const garbage = net.createServer((socket) => {
      socket.on("error", () => undefined);
      socket.end("SSH-2.0-OpenSSH_9.6\r\n");
    });
    await new Promise<void>((resolve) => garbage.listen(0, "127.0.0.1", resolve));
    try {
      const result = await probe.probeTarget(lo((garbage.address() as net.AddressInfo).port, { kind: "http", path: "/" }));
      assert.deepEqual([result.ok, result.statusClass], [false, "protocol"]);
    } finally {
      garbage.close();
    }
    const silent = await startTcp();
    try {
      const result = await probe.probeTarget(lo(silent.port, { kind: "http", path: "/" }));
      assert.deepEqual([result.ok, result.statusClass], [false, "protocol"]);
    } finally {
      await silent.close();
    }
  });

  it("langsame Antwort: nach dem Zeitlimit „timeout“, auch wenn der Server noch antworten würde", async () => {
    const server = await startHttp(() => ({ status: 200, delayMs: 1500 }));
    try {
      const result = await probe.probeTarget(lo(server.port, { kind: "http", path: "/" }), { timeoutMs: 300 });
      assert.deepEqual([result.ok, result.statusClass], [false, "timeout"]);
    } finally {
      await server.close();
    }
  });
});

describe("HTTPS und Zertifikate", () => {
  it("vertrauenswürdiges Zertifikat → normale Klasse; unbekannter Aussteller → Warnung „tlsWarning“ (erreichbar, kein Ausfall); mit „Zertifikatsfehler nicht melden“ → normale Klasse", async () => {
    const server = await startHttps();
    try {
      const target = lo(server.port, { kind: "https", path: "/" });
      assert.deepEqual(pick(await probe.probeTarget(target, { ca: server.cert })), [true, false, "2xx"]);
      assert.deepEqual(pick(await probe.probeTarget(target)), [true, true, "tlsWarning"], "selbst signiert, nicht vertraut");
      assert.deepEqual(pick(await probe.probeTarget({ ...target, ignoreTlsErrors: true })), [true, false, "2xx"]);
    } finally {
      await server.close();
    }
  });

  it("abgelaufenes Zertifikat → Warnung, kein Ausfall", async () => {
    const server = await startHttps(() => ({ status: 200 }), "expired");
    try {
      const result = await probe.probeTarget(lo(server.port, { kind: "https", path: "/" }), { ca: server.cert });
      assert.deepEqual(pick(result), [true, true, "tlsWarning"]);
      assert.deepEqual(pick(await probe.probeTarget(lo(server.port, { kind: "https", path: "/", ignoreTlsErrors: true }), { ca: server.cert })), [true, false, "2xx"]);
    } finally {
      await server.close();
    }
  });

  it("falscher Name im Zertifikat → Warnung (der Name kommt aus dem Ziel, verbunden wird mit der geprüften Adresse)", async () => {
    const server = await startHttps();
    try {
      const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
      const result = await probe.probeTarget(lo(server.port, { kind: "https", host: "other.example", path: "/" }), { ca: server.cert, lookup });
      assert.deepEqual(pick(result), [true, true, "tlsWarning"]);
      const ok = await probe.probeTarget(lo(server.port, { kind: "https", host: "localhost", path: "/" }), { ca: server.cert, lookup });
      assert.deepEqual(pick(ok), [true, false, "2xx"], "passender Name");
    } finally {
      await server.close();
    }
  });

  it("ein Server ohne TLS auf dem HTTPS-Port = „tls“ (nicht erreichbar)", async () => {
    const plain = await startHttp();
    try {
      const result = await probe.probeTarget(lo(plain.port, { kind: "https", path: "/" }));
      assert.deepEqual([result.ok, result.statusClass], [false, "tls"]);
    } finally {
      await plain.close();
    }
  });
});

const pick = (r: { ok: boolean; warn: boolean; statusClass: string }) => [r.ok, r.warn, r.statusClass];

describe("Zielsperre beim Verbinden (DNS einmal, alle Antworten prüfen, an die geprüfte Adresse binden)", () => {
  before(() => {
    offsiteNetwork.allowLoopback = false;
  });
  after(() => {
    allowLoopbackForTests();
  });

  const answers = (...addresses: string[]) => {
    let calls = 0;
    return { lookup: async () => (calls++, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))), calls: () => calls };
  };

  it("Literale: Loopback, Link-Local, Metadaten, Multicast, IPv4-gemappt, Dezimal – nie verbunden", async () => {
    const server = await startTcp();
    try {
      for (const host of ["127.0.0.1", "localhost", "169.254.169.254", "::1", "::ffff:127.0.0.1", "2130706433", "224.0.0.1", "0.0.0.0", "fe80::1", "metadata.google.internal"]) {
        const result = await probe.probeTarget({ kind: "tcp", host, port: server.port, path: null, method: "HEAD", ignoreTlsErrors: false });
        assert.deepEqual([host, result.ok, result.statusClass], [host, false, "blocked"]);
      }
      assert.equal(server.connections, 0, "auf den Fake-Server auf 127.0.0.1 wurde nie verbunden");
    } finally {
      await server.close();
    }
  });

  it("Name: wird einmal aufgelöst; liefert eine einzige Antwort eine verbotene Adresse (Rebinding auf Loopback/Metadaten), wird nicht verbunden", async () => {
    const server = await startTcp();
    try {
      for (const bad of [["127.0.0.1"], ["10.0.0.5", "127.0.0.1"], ["169.254.169.254"], ["::ffff:127.0.0.1"], ["8.8.8.8", "fe80::1"], ["0.0.0.0"], ["224.0.0.5"]]) {
        const a = answers(...bad);
        const result = await probe.probeTarget({ kind: "tcp", host: "nas.firma.example", port: server.port, path: null, method: "HEAD", ignoreTlsErrors: false }, { lookup: a.lookup });
        assert.deepEqual([bad.join(","), result.ok, result.statusClass], [bad.join(","), false, "blocked"]);
        assert.equal(a.calls(), 1, "genau eine Auflösung");
      }
      assert.equal(server.connections, 0);
    } finally {
      await server.close();
    }
  });

  it("private Adressen sind erlaubt (das interne Netz ist das Ziel) – gesperrt nur, was gefährlich ist", async () => {
    for (const address of ["10.1.2.3", "172.16.5.5", "192.168.1.1", "100.64.0.1", "fd12:3456::1"]) {
      const r = await resolveMod.resolveMonitorTarget("nas.firma.example", 1000, async () => [{ address, family: address.includes(":") ? 6 : 4 }]);
      assert.equal(r.addresses[0].address, address);
      assert.equal(r.servername, "nas.firma.example");
    }
    const literal = await resolveMod.resolveMonitorTarget("192.168.1.1", 1000);
    assert.deepEqual(literal, { addresses: [{ address: "192.168.1.1", family: 4 }], servername: null });
  });

  it("keine Antwort oder Fehler der Auflösung = „dns“; Zeitlimit der Auflösung zählt", async () => {
    assert.equal((await probe.probeTarget({ kind: "tcp", host: "gibt-es-nicht.example", port: 22, path: null, method: "HEAD", ignoreTlsErrors: false }, { lookup: async () => [] })).statusClass, "dns");
    assert.equal((await probe.probeTarget({ kind: "tcp", host: "x.example", port: 22, path: null, method: "HEAD", ignoreTlsErrors: false }, { lookup: async () => Promise.reject(new Error("ENOTFOUND")) })).statusClass, "dns");
    const started = performance.now();
    const slow = await probe.probeTarget({ kind: "tcp", host: "x.example", port: 22, path: null, method: "HEAD", ignoreTlsErrors: false }, { timeoutMs: 200, lookup: () => new Promise(() => undefined) });
    assert.equal(slow.statusClass, "dns");
    assert.ok(performance.now() - started < 1500);
  });
});

/* ───────────── Läufe gegen die Datenbank ───────────── */

describe("Host-Gateway des Containers (der Docker-Host ist „der eigene Rechner“)", () => {
  it("Standardroute aus /proc/net/route: little-endian Hex, nur 0.0.0.0/0 mit Gateway-Flag; Müll und andere Routen zählen nicht", async () => {
    const gateway = await import("@/server/host-gateway");
    const table = [
      "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
      "eth0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
      "eth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
      "eth1\t0000A8C0\t0100A8C0\t0003\t0\t0\t0\t00FFFFFF\t0\t0\t0",
      "zzzz\tnicht-hex\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
    ].join("\n");
    assert.deepEqual(gateway.parseDefaultGateways(table), ["172.17.0.1"]);
    assert.deepEqual(gateway.parseDefaultGateways(""), []);
  });

  it("das Gateway wird beim Verbinden nie angesprochen – als Literal und als Antwort eines Namens; Nachbarn im selben Netz bleiben erlaubt", async () => {
    const gateway = await import("@/server/host-gateway");
    gateway.setGatewayTestHooks({ gateways: ["172.17.0.1"] });
    try {
      await assert.rejects(() => resolveMod.resolveMonitorTarget("172.17.0.1", 500), { code: "blocked" });
      await assert.rejects(() => resolveMod.resolveMonitorTarget("::ffff:172.17.0.1", 500), { code: "blocked" });
      await assert.rejects(() => resolveMod.resolveMonitorTarget("host.docker.internal", 500), { code: "blocked" });
      await assert.rejects(() => resolveMod.resolveMonitorTarget("dienst.example", 500, async () => [{ address: "172.17.0.1", family: 4 }]), { code: "blocked" });
      const neighbour = await resolveMod.resolveMonitorTarget("172.17.0.2", 500);
      assert.deepEqual(neighbour.addresses, [{ address: "172.17.0.2", family: 4 }]);
      const outcome = await probe.probeTarget({ kind: "tcp", host: "172.17.0.1", port: 22, path: null, method: "HEAD", ignoreTlsErrors: false });
      assert.equal(outcome.statusClass, "blocked");
    } finally {
      gateway.setGatewayTestHooks({});
    }
  });
});

describe("Läufe: Entprellung, Ereignisse, Belegen, Fairness, Grenzen", () => {
  beforeEach(async () => {
    allowLoopbackForTests();
    await env.db.netMonitorTarget.deleteMany();
    await env.db.appSetting.deleteMany({ where: { key: run.MONITOR_ENABLED_SETTING } });
  });
  const enable = () => env.db.appSetting.upsert({ where: { key: run.MONITOR_ENABLED_SETTING }, update: { value: "true" }, create: { key: run.MONITOR_ENABLED_SETTING, value: "true" } });
  const make = (port: number, extra: Record<string, unknown> = {}) =>
    env.db.netMonitorTarget.create({ data: { name: `Ziel ${port}`, kind: "tcp", host: "127.0.0.1", port, intervalSec: 300, nextCheckAt: at(-1), ...extra } });

  it("ausgeschaltet (Standard): es wird nichts geprüft und nichts verbunden", async () => {
    const server = await startTcp();
    try {
      await make(server.port);
      assert.equal(await run.hasDueTargets(NOW), false);
      const summary = await run.runDueChecks({ now: NOW });
      assert.deepEqual(summary, { checked: 0, up: 0, down: 0, skipped: 0, errors: 0, wentDown: 0, cameBack: 0 });
      assert.equal(server.connections, 0);
      assert.equal(await env.db.netMonitorSample.count(), 0);
    } finally {
      await server.close();
    }
  });

  it("eingeschaltet: ein erreichbares Ziel wird gemessen (Zustand, Latenz, Klasse, Zeit, nächste Prüfung), ohne Ereignis", async () => {
    await enable();
    const server = await startTcp();
    try {
      const target = await make(server.port);
      assert.equal(await run.hasDueTargets(NOW), true);
      const summary = await run.runDueChecks({ now: NOW });
      assert.deepEqual([summary.checked, summary.up, summary.down], [1, 1, 0]);
      const row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } });
      assert.deepEqual([row.state, row.failStreak, row.lastClass, row.lastCheckAt?.toISOString(), row.nextCheckAt.toISOString()], ["up", 0, "open", NOW.toISOString(), at(300).toISOString()]);
      assert.ok(row.lastLatencyMs !== null);
      assert.equal(await env.db.netMonitorEvent.count(), 0);
      const samples = await env.db.netMonitorSample.findMany();
      assert.equal(samples.length, 1);
      assert.deepEqual(Object.keys(samples[0]).sort(), ["at", "id", "latencyMs", "ok", "statusClass", "targetId"], "nur Messwerte, nie Antworttext");
      assert.equal(await run.hasDueTargets(at(10)), false, "noch nicht wieder fällig");
      assert.equal(await run.hasDueTargets(at(301)), true);
    } finally {
      await server.close();
    }
  });

  it("Entprellung: ein Fehlschlag allein ist kein Ausfall; der zweite meldet „Ab“ mit Ereignis; die Wiederkehr meldet „Auf“ mit der Dauer des Ausfalls", async () => {
    await enable();
    const port = await closedPort();
    const target = await make(port);
    const state = async () => env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } });

    await run.runDueChecks({ now: NOW });
    let row = await state();
    assert.deepEqual([row.state, row.failStreak, row.lastClass, row.nextCheckAt.toISOString()], ["unknown", 1, "refused", at(60).toISOString()], "erster Fehlschlag: noch unbekannt, nach 60 s erneut");
    assert.equal(await env.db.netMonitorEvent.count(), 0);

    await run.runDueChecks({ now: at(61) });
    row = await state();
    assert.deepEqual([row.state, row.failStreak, row.stateSince?.toISOString()], ["down", 2, at(61).toISOString()]);
    assert.deepEqual((await env.db.netMonitorEvent.findMany()).map((e) => [e.kind, e.downSeconds]), [["down", null]]);

    await run.runDueChecks({ now: at(61 + 60 + 1) });
    row = await state();
    assert.deepEqual([row.state, row.failStreak], ["down", 3]);
    assert.equal(await env.db.netMonitorEvent.count(), 1, "kein zweites Ausfall-Ereignis");

    // Das Ziel kommt zurück: ein Server auf demselben Port
    const server = net.createServer((s) => s.end());
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      await run.runDueChecks({ now: at(61 + 600) });
    } finally {
      server.close();
    }
    row = await state();
    assert.deepEqual([row.state, row.failStreak], ["up", 0]);
    const events = await env.db.netMonitorEvent.findMany({ orderBy: { at: "asc" } });
    assert.deepEqual(events.map((e) => [e.kind, e.downSeconds]), [["down", null], ["up", 600]]);
  });

  it("ein einzelner Fehlschlag bei einem erreichbaren Ziel bleibt „Auf“", async () => {
    await enable();
    const server = await startTcp();
    const target = await make(server.port);
    await run.runDueChecks({ now: NOW });
    await server.close(); // ab jetzt unerreichbar
    await run.runDueChecks({ now: at(301) });
    const row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } });
    assert.deepEqual([row.state, row.failStreak, row.lastClass], ["up", 1, "refused"]);
    assert.equal(await env.db.netMonitorEvent.count(), 0);
  });

  it("ausgeschaltete Ziele werden nicht geprüft; ein Ziel, dessen Adresse verboten ist (verändertes DB-Feld), wird nie verbunden, sondern als „gesperrt“ gemessen", async () => {
    await enable();
    const server = await startTcp();
    try {
      await make(server.port, { enabled: false });
      assert.equal((await run.runDueChecks({ now: NOW })).checked, 0);
      offsiteNetwork.allowLoopback = false;
      const meta = await make(server.port, { host: "169.254.169.254", name: "Metadaten" });
      await run.runDueChecks({ now: NOW });
      const row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: meta.id } });
      assert.deepEqual([row.lastClass, row.failStreak], ["blocked", 1]);
      assert.equal(server.connections, 0);
    } finally {
      allowLoopbackForTests();
      await server.close();
    }
  });

  it("Parallelitätsgrenze: höchstens 4 Prüfungen gleichzeitig, auch bei 12 fälligen Zielen", async () => {
    await enable();
    const server = await startHttp(() => ({ status: 200, delayMs: 150 }));
    try {
      for (let i = 0; i < 12; i++) await env.db.netMonitorTarget.create({ data: { name: `Ziel ${i}`, kind: "http", host: "127.0.0.1", port: server.port, path: `/${i}`, intervalSec: 300, nextCheckAt: at(-1) } });
      const summary = await run.runDueChecks({ now: NOW });
      assert.equal(summary.checked, 12);
      assert.equal(server.requests.length, 12);
      // Jede Antwort wird 150 ms zurückgehalten, die Anfragen überlappen also wirklich: am Server gemessen höchstens 4 gleichzeitig (und tatsächlich parallel)
      assert.equal(server.inflight.max, 4);
    } finally {
      await server.close();
    }
  });

  it("Belegen: zwei gleichzeitige Läufe prüfen jedes Ziel genau einmal (kein Doppellauf)", async () => {
    await enable();
    const server = await startTcp();
    try {
      for (let i = 0; i < 6; i++) await make(server.port, { name: `Ziel ${i}` });
      const [a, b] = await Promise.all([run.runDueChecks({ now: NOW }), run.runDueChecks({ now: NOW })]);
      assert.equal(a.checked + b.checked, 6);
      assert.equal(a.skipped + b.skipped >= 0, true);
      // Der Zähler des Testservers steigt erst, wenn dessen Ereignisschleife die Verbindungen annimmt (unter Linux nach der Prüfung, nicht davor): kurz abwarten
      for (let i = 0; i < 100 && server.connections < 6; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(server.connections, 6);
      assert.equal(await env.db.netMonitorSample.count(), 6);
    } finally {
      await server.close();
    }
  });

  it("Fairness: ein totes Ziel (Zeitlimit) hält die anderen nicht auf; das am längsten wartende Ziel kommt zuerst; nach der Prüfung rückt jedes ans Ende", async () => {
    await enable();
    const dead = await startTcp({ hold: true });
    const fast = await startHttp();
    try {
      // das tote Ziel wartet am längsten
      await env.db.netMonitorTarget.create({ data: { name: "tot", kind: "http", host: "127.0.0.1", port: dead.port, path: "/", intervalSec: 300, nextCheckAt: at(-500) } });
      for (let i = 0; i < 5; i++) await env.db.netMonitorTarget.create({ data: { name: `schnell ${i}`, kind: "http", host: "127.0.0.1", port: fast.port, path: `/${i}`, intervalSec: 300, nextCheckAt: at(-100 + i) } });
      const started = performance.now();
      const summary = await run.runDueChecks({ now: NOW, concurrency: 2, deps: { timeoutMs: 400 } });
      assert.equal(summary.checked, 6);
      assert.ok(performance.now() - started < 3000);
      assert.equal(fast.requests.length, 5, "alle schnellen Ziele wurden geprüft");
      const deadRow = await env.db.netMonitorTarget.findFirstOrThrow({ where: { name: "tot" } });
      assert.deepEqual([deadRow.lastClass, deadRow.failStreak], ["timeout", 1]);
      assert.equal(deadRow.nextCheckAt.toISOString(), at(60).toISOString(), "nach dem Fehlschlag in einer Minute wieder, hinter den anderen");
      // das Zeitbudget: danach beginnt keine weitere Prüfung
      const open = await startTcp();
      try {
        for (let i = 0; i < 3; i++) await make(open.port, { name: `Rest ${i}`, nextCheckAt: at(-1) });
        const none = await run.runDueChecks({ now: at(1000), budgetMs: -1 });
        assert.equal(none.checked, 0);
        assert.equal(open.connections, 0);
      } finally {
        await open.close();
      }
    } finally {
      await dead.close();
      await fast.close();
    }
  });

  it("ein Abbruch (Zeitlimit des Jobs) bucht kein halbes Ergebnis und lässt das Ziel fällig", async () => {
    await enable();
    const hold = await startTcp({ hold: true });
    try {
      const target = await env.db.netMonitorTarget.create({ data: { name: "langsam", kind: "http", host: "127.0.0.1", port: hold.port, path: "/", intervalSec: 300, nextCheckAt: at(-1) } });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      await run.runDueChecks({ now: NOW, signal: controller.signal, deps: { timeoutMs: 400 } });
      assert.equal(await env.db.netMonitorSample.count(), 0);
      const row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(row.nextCheckAt.toISOString(), at(-1).toISOString(), "unverändert fällig");
      assert.equal(row.lastCheckAt, null);
    } finally {
      await hold.close();
    }
  });

  it("Messungen ändern updatedAt (die Version des Bearbeiten-Formulars) nie: kein „von jemand anderem geändert“ wegen einer Messung", async () => {
    await enable();
    const server = await startTcp();
    try {
      const target = await make(server.port);
      const before = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const summary = await run.runDueChecks({ now: NOW });
      assert.equal(summary.checked, 1);
      const after = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.state, "up");
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "Belegen und Buchen lassen updatedAt stehen");
    } finally {
      await server.close();
    }
  });

  it("Belegen schiebt das Ziel nur um die Haltedauer weiter, nicht um ein Intervall: ein Absturz mitten in der Prüfung verliert die Messung nicht", async () => {
    await enable();
    const hold = await startTcp({ hold: true });
    try {
      const target = await env.db.netMonitorTarget.create({ data: { name: "haengt", kind: "http", host: "127.0.0.1", port: hold.port, path: "/", intervalSec: 3600, nextCheckAt: at(-1) } });
      const check = run.runDueChecks({ now: NOW, deps: { timeoutMs: 300 } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const during = (await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } })).nextCheckAt;
      await check;
      assert.equal(during.toISOString(), new Date(NOW.getTime() + run.CLAIM_LEASE_MS).toISOString(), "belegt nur für die Haltedauer, nicht für die Stunde des Intervalls");
      assert.ok(run.CLAIM_LEASE_MS < 60_000);
    } finally {
      await hold.close();
    }
  });

  it("ein Ergebnis für die alte Adresse wird verworfen, wenn das Ziel während der Prüfung umadressiert wurde (das Zurücksetzen bleibt)", async () => {
    const t = await env.db.netMonitorTarget.create({ data: { name: "R", kind: "tcp", host: "10.0.0.7", port: 22, intervalSec: 300, state: "down", failStreak: 4, stateSince: at(-86_400), lastCheckAt: NOW } });
    const snapshot = { id: t.id, kind: t.kind, host: t.host, port: t.port, path: t.path, method: t.method, ignoreTlsErrors: t.ignoreTlsErrors };
    // wie in der Operation: Adresse ändern und neu anfangen
    await env.db.netMonitorTarget.update({ where: { id: t.id }, data: { host: "10.0.0.8", state: "unknown", stateSince: null, failStreak: 0, lastCheckAt: null, lastClass: null, nextCheckAt: NOW } });
    const result = await run.recordOutcome(snapshot, { ok: false, warn: false, latencyMs: null, statusClass: "timeout" }, at(5));
    assert.deepEqual([result.discarded, result.event], [true, null]);
    const row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: t.id } });
    assert.deepEqual([row.host, row.state, row.failStreak, row.stateSince, row.lastClass], ["10.0.0.8", "unknown", 0, null, null]);
    assert.equal(await env.db.netMonitorSample.count({ where: { targetId: t.id } }), 0, "kein Messwert, kein Ereignis für die alte Adresse");
    assert.equal(await env.db.netMonitorEvent.count({ where: { targetId: t.id } }), 0);
    // passt die Konfiguration, wird gebucht – mit Zustand und Zähler aus der Zeile
    const ok = await run.recordOutcome({ ...snapshot, host: "10.0.0.8" }, { ok: true, warn: false, latencyMs: 4, statusClass: "open" }, at(6));
    assert.deepEqual([ok.discarded, ok.state], [false, "up"]);
  });

  it("das Ergebnis eines Laufs, dessen Ziel währenddessen umadressiert wurde, zählt nicht und ändert das neue Ziel nicht", async () => {
    await enable();
    const hold = await startTcp({ hold: true });
    try {
      const t = await env.db.netMonitorTarget.create({ data: { name: "umzug", kind: "http", host: "127.0.0.1", port: hold.port, path: "/", intervalSec: 300, nextCheckAt: at(-1) } });
      const check = run.runDueChecks({ now: NOW, deps: { timeoutMs: 400 } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await env.db.netMonitorTarget.update({ where: { id: t.id }, data: { port: hold.port + 1, state: "unknown", failStreak: 0, lastCheckAt: null, nextCheckAt: at(-1) } });
      const summary = await check;
      assert.deepEqual([summary.checked, summary.skipped, summary.errors], [0, 1, 0]);
      const row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: t.id } });
      assert.deepEqual([row.state, row.failStreak, row.lastCheckAt, row.lastClass], ["unknown", 0, null, null]);
    } finally {
      await hold.close();
    }
  });

  it("die Zusammenfassung zählt Zustandswechsel (Ausfall, Wiederkehr) – daran hängt die Meldung des Jobs", async () => {
    await enable();
    const port = await closedPort();
    await make(port);
    // erster Fehlschlag: noch kein Wechsel; zweiter: Ausfall
    const first = await run.runDueChecks({ now: NOW });
    assert.deepEqual([first.checked, first.wentDown, first.cameBack], [1, 0, 0]);
    const second = await run.runDueChecks({ now: at(61) });
    assert.deepEqual([second.wentDown, second.cameBack], [1, 0]);
    const server = net.createServer((s) => s.end());
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      const third = await run.runDueChecks({ now: at(700) });
      assert.deepEqual([third.wentDown, third.cameBack], [0, 1]);
    } finally {
      server.close();
    }
  });

  it("ein während der Prüfung gelöschtes Ziel führt nicht zum Fehler", async () => {
    await enable();
    const gone = await env.db.netMonitorTarget.create({ data: { name: "weg", kind: "tcp", host: "127.0.0.1", port: 9, intervalSec: 300, nextCheckAt: at(-1) } });
    await env.db.netMonitorTarget.delete({ where: { id: gone.id } });
    const result = await run.recordOutcome({ id: gone.id, kind: "tcp", host: "127.0.0.1", port: 9, path: null, method: "HEAD", ignoreTlsErrors: false }, { ok: true, warn: false, latencyMs: 5, statusClass: "open" }, NOW);
    assert.equal(result.discarded, true);
  });
});

describe("Gerätestatus aus Messungen (StatusProvider)", () => {
  beforeEach(async () => {
    await env.db.netMonitorTarget.deleteMany();
    await env.db.netDevice.deleteMany();
    await env.db.appSetting.deleteMany({ where: { key: run.MONITOR_ENABLED_SETTING } });
  });
  const setup = async (targets: Array<Record<string, unknown>>) => {
    const device = await env.db.netDevice.create({ data: { name: "sw-1", type: "switch", monitorEnabled: true } });
    for (const t of targets) await env.db.netMonitorTarget.create({ data: { name: "t", kind: "tcp", host: "10.0.0.1", port: 22, intervalSec: 300, deviceId: device.id, ...t } });
    return device;
  };
  const enable = () => env.db.appSetting.create({ data: { key: run.MONITOR_ENABLED_SETTING, value: "true" } });
  const statusOf = async (id: string, now = NOW) => (await provider.getStatusProvider().check([{ id, monitorEnabled: true }], now)).get(id)!;

  it("Überwachung aus: unbekannt, auch wenn Messwerte da sind", async () => {
    const device = await setup([{ state: "up", lastCheckAt: at(-10), lastLatencyMs: 5 }]);
    const status = await statusOf(device.id);
    assert.deepEqual([status.state, status.latencyMs, status.checkedAt], ["unknown", null, null]);
  });

  it("an, aber noch nicht gemessen: unbekannt; gemessen und frisch: online mit Latenz; mehrere Ziele: eingeschränkt", async () => {
    await enable();
    const device = await setup([{ state: "unknown" }]);
    assert.deepEqual([(await statusOf(device.id)).state, (await statusOf(device.id)).stale], ["unknown", false]);
    await env.db.netMonitorTarget.updateMany({ data: { state: "up", lastCheckAt: at(-30), lastLatencyMs: 12 } });
    const online = await statusOf(device.id);
    assert.deepEqual([online.state, online.latencyMs, online.targets, online.checkedAt?.toISOString()], ["online", 12, 1, at(-30).toISOString()]);
    await env.db.netMonitorTarget.create({ data: { name: "zweites", kind: "tcp", host: "10.0.0.1", port: 443, intervalSec: 300, deviceId: device.id, state: "down", lastCheckAt: at(-30) } });
    assert.equal((await statusOf(device.id)).state, "degraded");
  });

  it("veraltet (älter als drei Intervalle): unbekannt und als veraltet gekennzeichnet – nie grün aus alten Werten; deaktivierte Ziele zählen nicht", async () => {
    await enable();
    const device = await setup([{ state: "up", lastCheckAt: at(-1000), lastLatencyMs: 12 }]);
    const stale = await statusOf(device.id);
    assert.deepEqual([stale.state, stale.stale, stale.latencyMs], ["unknown", true, null]);
    assert.equal((await statusOf(device.id, at(-900))).state, "online", "genau drei Intervalle sind noch frisch");
    await env.db.netMonitorTarget.updateMany({ data: { enabled: false, lastCheckAt: at(-10) } });
    assert.deepEqual([(await statusOf(device.id)).state, (await statusOf(device.id)).targets], ["unknown", 0]);
  });

  it("Geräte ohne Ziel bleiben unbekannt", async () => {
    await enable();
    const device = await env.db.netDevice.create({ data: { name: "pc", type: "workstation", monitorEnabled: true } });
    const status = await statusOf(device.id);
    assert.deepEqual([status.state, status.targets], ["unknown", 0]);
  });
});

describe("Aufräumen und Verdichten", () => {
  const DAY = 86_400_000;
  const ago = (days: number, extraMinutes = 0) => new Date(NOW.getTime() - days * DAY + extraMinutes * 60_000);
  let target: { id: string };
  beforeEach(async () => {
    await env.db.netMonitorTarget.deleteMany();
    target = await env.db.netMonitorTarget.create({ data: { name: "t", kind: "tcp", host: "10.0.0.1", port: 22 } });
  });

  it("Rohwerte älter als 7 Tage werden zu Stundenwerten verdichtet und gelöscht; jüngere bleiben unberührt", async () => {
    await env.db.netMonitorSample.createMany({
      data: [
        { targetId: target.id, at: ago(8, 5), ok: true, latencyMs: 10, statusClass: "open" },
        { targetId: target.id, at: ago(8, 10), ok: false, latencyMs: null, statusClass: "refused" },
        { targetId: target.id, at: ago(8, 15), ok: true, latencyMs: 30, statusClass: "open" },
        { targetId: target.id, at: ago(6), ok: true, latencyMs: 99, statusClass: "open" },
      ],
    });
    const removed = await run.pruneMonitor(NOW);
    assert.equal(removed, 3);
    assert.equal(await env.db.netMonitorSample.count(), 1, "die Messung von vor 6 Tagen bleibt roh");
    const hours = await env.db.netMonitorHour.findMany();
    assert.equal(hours.length, 1);
    assert.deepEqual([hours[0].checks, hours[0].failures, hours[0].latencySumMs, hours[0].latencyCount, hours[0].latencyMaxMs], [3, 1, 40, 2, 30]);
    // wiederholbar: ein zweiter Lauf ändert nichts
    assert.equal(await run.pruneMonitor(NOW), 0);
    assert.equal((await env.db.netMonitorHour.findMany()).length, 1);
  });

  it("eine Stunde, die schon Werte hat, wird ergänzt (addierend), nicht überschrieben", async () => {
    const hour = new Date(Math.floor(ago(9).getTime() / 3_600_000) * 3_600_000);
    await env.db.netMonitorHour.create({ data: { targetId: target.id, hour, checks: 2, failures: 1, latencySumMs: 20, latencyCount: 1, latencyMaxMs: 20 } });
    await env.db.netMonitorSample.create({ data: { targetId: target.id, at: new Date(hour.getTime() + 60_000), ok: true, latencyMs: 50, statusClass: "open" } });
    await run.pruneMonitor(NOW);
    const row = await env.db.netMonitorHour.findFirstOrThrow({ where: { targetId: target.id, hour } });
    assert.deepEqual([row.checks, row.failures, row.latencySumMs, row.latencyCount, row.latencyMaxMs], [3, 1, 70, 2, 50]);
  });

  it("Stundenwerte werden nach 30 Tagen gelöscht, Zustandswechsel nach 90 Tagen", async () => {
    await env.db.netMonitorHour.createMany({
      data: [
        { targetId: target.id, hour: ago(31), checks: 1, failures: 0, latencySumMs: 1, latencyCount: 1 },
        { targetId: target.id, hour: ago(29), checks: 1, failures: 0, latencySumMs: 1, latencyCount: 1 },
      ],
    });
    await env.db.netMonitorEvent.createMany({ data: [{ targetId: target.id, at: ago(91), kind: "down" }, { targetId: target.id, at: ago(89), kind: "up", downSeconds: 60 }] });
    await run.pruneMonitor(NOW);
    assert.equal(await env.db.netMonitorHour.count(), 1);
    assert.deepEqual((await env.db.netMonitorEvent.findMany()).map((e) => e.kind), ["up"]);
  });

  it("Verlauf eines gelöschten Ziels geht mit (Cascade, angekündigt)", async () => {
    await env.db.netMonitorSample.create({ data: { targetId: target.id, at: ago(1), ok: true, latencyMs: 1, statusClass: "open" } });
    await env.db.netMonitorEvent.create({ data: { targetId: target.id, at: ago(1), kind: "down" } });
    await env.db.netMonitorTarget.delete({ where: { id: target.id } });
    assert.deepEqual([await env.db.netMonitorSample.count(), await env.db.netMonitorEvent.count()], [0, 0]);
  });

  it("Systemstatus: nicht erreichbare Ziele zählen nur bei eingeschalteter Überwachung und aktiver Funktion", async () => {
    await env.db.appSetting.deleteMany({ where: { key: run.MONITOR_ENABLED_SETTING } });
    await env.db.netMonitorTarget.update({ where: { id: target.id }, data: { state: "down", lastCheckAt: at(-10) } });
    assert.deepEqual(await run.monitorHealth(true, NOW), { down: 0 });
    await env.db.appSetting.create({ data: { key: run.MONITOR_ENABLED_SETTING, value: "true" } });
    assert.deepEqual(await run.monitorHealth(true, NOW), { down: 1 });
    assert.deepEqual(await run.monitorHealth(false, NOW), { down: 0 });
    // eine veraltete Messung (älter als drei Intervalle) ist kein Ausfall, sondern unbekannt – wie in Liste und Dashboard
    assert.deepEqual(await run.monitorHealth(true, at(3_000)), { down: 0 });
  });
});
