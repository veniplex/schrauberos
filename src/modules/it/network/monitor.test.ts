import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { isApiForbidden } from "@/lib/api/scope";
import { versionOf } from "@/lib/concurrency";
import { offsiteNetwork } from "@/lib/offsite/host-policy";
import { DEFAULT_ROLES } from "@/modules/default-roles";
import { MARKED_PERMISSIONS } from "@/modules/catalog";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Netzwerk-Überwachung im Aktions-Rahmen: eigenes Recht `network.monitor` (nicht `network.edit`), Zielsperre und Eingabeprüfung beim Speichern, Grenzen, Audit ohne Zugangsdaten, Sichtbarkeit der Zieladresse nur mit dem
 * Recht, die API (nur lesend, nur Gemessenes, nie die Adresse) und das Kennzeichen des Rechts (in keiner Standardrolle, in keinem Token).
 */
let env: TestEnv;
let actions: typeof import("./monitor-actions");
let queries: typeof import("./queries");
let router: typeof import("@/server/api/router");
let run: typeof import("@/server/monitor/run");

before(async () => {
  env = await createTestEnv();
  offsiteNetwork.allowLoopback = false;
  actions = await import("./monitor-actions");
  queries = await import("./queries");
  router = await import("@/server/api/router");
  run = await import("@/server/monitor/run");
});
after(() => env.cleanup());

const login = async (permissions: string[]) => {
  const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
  await env.signIn(user);
  return user;
};
const audits = async () => (await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((e) => `${e.action} ${e.target}`);

beforeEach(async () => {
  await env.db.netMonitorTarget.deleteMany();
  await env.db.netDevice.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.appSetting.deleteMany({ where: { key: run.MONITOR_ENABLED_SETTING } });
  env.browser.reset();
});

const save = (fields: Record<string, string | number | boolean | undefined> = {}) =>
  actions.saveMonitorTarget({}, form({ name: "Switch SSH", kind: "tcp", host: "192.168.10.10", port: 22, intervalSec: 300, enabled: true, ...fields }));

describe("Rechte", () => {
  it("network.edit genügt nicht – Ziele anlegen, ändern, löschen und der Schalter brauchen network.monitor", async () => {
    await login(["network.view", "network.edit", "network.delete"]);
    assert.equal(await redirectOf(() => save()), "/forbidden");
    assert.equal(await redirectOf(() => actions.setMonitoring(form({ enabled: "true" }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.deleteMonitorTarget(form({ id: "x" }))), "/forbidden");
    assert.equal(await env.db.netMonitorTarget.count(), 0);

    await login(["network.view", "network.monitor"]);
    const target = await redirectOf(() => save());
    const row = await env.db.netMonitorTarget.findFirstOrThrow();
    assert.equal(target, `/network/monitoring/${row.id}`);
    assert.deepEqual([row.kind, row.host, row.port, row.intervalSec, row.enabled, row.state, row.createdByName], ["tcp", "192.168.10.10", 22, 300, true, "unknown", row.createdByName]);
  });

  it("ein Administrator hat das Recht (er hat alle Rechte des Katalogs); ohne Anmeldung gibt es nichts", async () => {
    const role = await env.role({ isAdmin: true });
    await env.signIn(await env.user({ username: "admin-x", roles: [role] }));
    assert.ok(await redirectOf(() => save()));
    assert.equal(await env.db.netMonitorTarget.count(), 1);
    env.signOut();
    assert.equal(await redirectOf(() => save({ name: "Anonym", host: "10.0.0.9" })), "/login");
    assert.equal(await env.db.netMonitorTarget.count(), 1);
  });

  it("das Recht ist gekennzeichnet (sensibel), in keiner Standardrolle und in keinem API-Token", () => {
    assert.equal(MARKED_PERMISSIONS.get("network.monitor"), "sensitive");
    for (const role of DEFAULT_ROLES) assert.ok(!(role.permissions as readonly string[]).includes("network.monitor"), role.key);
    assert.equal(isApiForbidden("network.monitor"), true);
  });
});

describe("Eingabeprüfung und Zielsperre beim Speichern", () => {
  it("gesperrte Ziele werden abgelehnt (Loopback, eigener Rechner, Link-Local/Metadaten, Multicast, IPv4-gemappt, Dezimal) – nichts wird gespeichert", async () => {
    await login(["network.view", "network.monitor"]);
    for (const host of ["127.0.0.1", "localhost", "169.254.169.254", "::1", "::ffff:127.0.0.1", "2130706433", "224.0.0.1", "0.0.0.0", "metadata.google.internal", "http://127.0.0.1:8080/"]) {
      const state = await save({ host });
      assert.ok(state.fieldErrors?.host, host);
    }
    assert.equal(await env.db.netMonitorTarget.count(), 0);
  });

  it("Zugangsdaten in der Adresse, ungültiger Port/Pfad/Intervall/Art/Anfrage werden abgelehnt", async () => {
    await login(["network.view", "network.monitor"]);
    assert.ok((await save({ host: "https://user:pw@nas.example/" })).fieldErrors?.host);
    assert.ok((await save({ host: "user@nas.example" })).fieldErrors?.host);
    assert.ok((await save({ port: 0 })).fieldErrors?.port);
    assert.ok((await save({ port: 70000 })).fieldErrors?.port);
    assert.ok((await save({ kind: "https", path: "//evil.example/x" })).fieldErrors?.path);
    assert.ok((await save({ kind: "https", path: "/a b" })).fieldErrors?.path);
    assert.ok((await save({ intervalSec: 30 })).fieldErrors?.intervalSec);
    assert.ok((await save({ intervalSec: 100000 })).fieldErrors?.intervalSec);
    assert.ok((await save({ kind: "icmp" })).fieldErrors?.kind);
    assert.ok((await save({ kind: "https", method: "POST" })).fieldErrors?.method);
    assert.ok((await save({ deviceId: "gibt-es-nicht" })).fieldErrors?.deviceId);
    assert.ok((await save({ name: "" })).fieldErrors?.name);
    assert.equal(await env.db.netMonitorTarget.count(), 0);
  });

  it("private Adressen sind erlaubt; eine eingefügte Adresse wird zerlegt; Standardport bei HTTP(S)", async () => {
    await login(["network.view", "network.monitor"]);
    await redirectOf(() => save({ host: "https://nas.firma.example:8443/status?x=1", name: "NAS" }));
    await redirectOf(() => save({ host: "10.1.2.3", kind: "https", name: "Web", path: "/", port: undefined }));
    const rows = await env.db.netMonitorTarget.findMany({ orderBy: { name: "asc" } });
    assert.deepEqual(rows.map((r) => [r.name, r.kind, r.host, r.port, r.path]), [
      ["NAS", "https", "nas.firma.example", 8443, "/status?x=1"],
      ["Web", "https", "10.1.2.3", 443, "/"],
    ]);
  });

  it("doppelte Ziele und mehr als 100 Ziele werden abgelehnt", async () => {
    await login(["network.view", "network.monitor"]);
    await redirectOf(() => save());
    assert.ok((await save({ name: "Doppelt" })).fieldErrors?.host, "gleiche Art, Host, Port und Pfad");
    assert.equal(await redirectOf(() => save({ name: "Anderer Port", port: 2222 })) !== null, true);
    await env.db.netMonitorTarget.deleteMany();
    await env.db.netMonitorTarget.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ name: `T${i}`, kind: "tcp", host: `10.0.${Math.floor(i / 200)}.${(i % 200) + 1}`, port: 22 })) });
    const state = await save({ host: "10.9.9.9", name: "Nr. 101" });
    assert.ok(state.error, "Grenze erreicht");
    assert.equal(await env.db.netMonitorTarget.count(), 100);
  });

  it("Ändern prüft die Version; eine geänderte Adresse setzt den Zustand zurück, ein geänderter Name nicht; Gerät und HTTPS-Option werden übernommen", async () => {
    await login(["network.view", "network.monitor"]);
    const device = await env.db.netDevice.create({ data: { name: "sw-1", type: "switch" } });
    await redirectOf(() => save({ deviceId: device.id }));
    let row = await env.db.netMonitorTarget.findFirstOrThrow();
    assert.equal(row.deviceId, device.id);
    await env.db.netMonitorTarget.update({ where: { id: row.id }, data: { state: "up", failStreak: 0, lastCheckAt: new Date("2026-03-10T10:00:00Z"), lastClass: "open" } });
    row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    const stale = versionOf(row);
    assert.ok(await redirectOf(() => save({ id: row.id, version: stale, name: "Umbenannt", deviceId: device.id })));
    row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([row.name, row.state, row.lastClass], ["Umbenannt", "up", "open"], "Namensänderung behält die Messung");
    assert.ok((await save({ id: row.id, version: stale, name: "Veraltet" })).error, "veraltete Version");
    assert.ok(await redirectOf(() => save({ id: row.id, version: versionOf(row), host: "192.168.10.11", deviceId: device.id })));
    row = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([row.host, row.state, row.lastCheckAt, row.lastClass, row.failStreak], ["192.168.10.11", "unknown", null, null, 0], "neue Adresse = neu messen");
    // ignoreTlsErrors gilt nur für HTTPS
    assert.ok(await redirectOf(() => save({ id: row.id, version: versionOf(row), ignoreTlsErrors: true })));
    assert.equal((await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } })).ignoreTlsErrors, false);
    assert.ok(await redirectOf(() => save({ name: "TLS", kind: "https", host: "10.0.0.2", ignoreTlsErrors: true })));
    assert.equal((await env.db.netMonitorTarget.findFirstOrThrow({ where: { name: "TLS" } })).ignoreTlsErrors, true);
  });
});

describe("Schalter, Löschen, Audit", () => {
  it("die Überwachung ist standardmäßig aus; der Schalter schaltet ein und aus, macht alle Ziele fällig und wird protokolliert", async () => {
    await login(["network.view", "network.monitor"]);
    assert.equal(await queries.monitoringEnabled(), false);
    await redirectOf(() => save());
    await env.db.netMonitorTarget.updateMany({ data: { nextCheckAt: new Date("2099-01-01T00:00:00Z") } });
    await actions.setMonitoring(form({ enabled: "true" }));
    assert.equal(await queries.monitoringEnabled(), true);
    assert.ok((await env.db.netMonitorTarget.findFirstOrThrow()).nextCheckAt.getTime() < Date.parse("2099-01-01T00:00:00Z"));
    await actions.setMonitoring(form({ enabled: "false" }));
    assert.equal(await queries.monitoringEnabled(), false);
    assert.deepEqual((await audits()).filter((a) => a.startsWith("network.monitorSwitch")), ["network.monitorSwitch ein", "network.monitorSwitch aus"]);
  });

  it("Löschen nimmt den Verlauf mit und wird protokolliert; das Audit nennt das Ziel, nie mehr (keine Zugangsdaten, keine Antworten)", async () => {
    await login(["network.view", "network.monitor"]);
    await redirectOf(() => save());
    const row = await env.db.netMonitorTarget.findFirstOrThrow();
    await env.db.netMonitorSample.create({ data: { targetId: row.id, at: new Date("2026-03-10T10:00:00Z"), ok: true, latencyMs: 3, statusClass: "open" } });
    assert.equal(await redirectOf(() => actions.deleteMonitorTarget(form({ id: row.id }))), "/network/monitoring");
    assert.deepEqual([await env.db.netMonitorTarget.count(), await env.db.netMonitorSample.count()], [0, 0]);
    assert.deepEqual(await audits(), ["network.monitorCreate Switch SSH: tcp://192.168.10.10:22", "network.monitorDelete Switch SSH: tcp://192.168.10.10:22"]);
  });
});

describe("Version, Termin und Zustand beim Ändern", () => {
  const NOW = new Date("2026-03-10T10:00:00.000Z");
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

  it("eine Messung zwischen Öffnen und Speichern des Formulars macht das Speichern nicht zum Konflikt (updatedAt bleibt bei Messungen)", async () => {
    await login(["network.view", "network.monitor"]);
    await env.db.appSetting.create({ data: { key: run.MONITOR_ENABLED_SETTING, value: "true" } });
    const { startTcp } = await import("@/test/fake-monitor");
    const { allowLoopbackForTests } = await import("@/lib/offsite/host-policy");
    const server = await startTcp();
    try {
      allowLoopbackForTests();
      const target = await env.db.netMonitorTarget.create({ data: { name: "T", kind: "tcp", host: "127.0.0.1", port: server.port, intervalSec: 60, nextCheckAt: at(-1) } });
      const version = versionOf(await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } })); // Formular geöffnet
      await new Promise((resolve) => setTimeout(resolve, 15));
      assert.equal((await run.runDueChecks({ now: NOW })).checked, 1); // eine Messung läuft
      offsiteNetwork.allowLoopback = false;
      // gelingt (Weiterleitung), statt „von jemand anderem geändert“ zu melden
      assert.ok(await redirectOf(() => save({ id: target.id, version, name: "Umbenannt", host: "192.168.10.20", port: 22, intervalSec: 60 })));
      assert.equal((await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: target.id } })).name, "Umbenannt");
    } finally {
      offsiteNetwork.allowLoopback = false;
      await server.close();
    }
  });

  it("Intervalländerung setzt den nächsten Termin neu: verkürzt = sofort fällig, wenn überfällig; verlängert = letzte Messung + neues Intervall", async () => {
    await login(["network.view", "network.monitor"]);
    await redirectOf(() => save({ intervalSec: 3600 }));
    const row = await env.db.netMonitorTarget.findFirstOrThrow();
    const lastCheckAt = new Date(Date.now() - 30 * 60_000);
    await env.db.netMonitorTarget.update({ where: { id: row.id }, data: { state: "up", lastCheckAt, nextCheckAt: new Date(lastCheckAt.getTime() + 3600_000) } });
    let current = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    // 1 h → 1 min: die letzte Messung ist 30 min alt, also ist das Ziel überfällig – sofort dran, Zustand und Messung bleiben
    await redirectOf(() => save({ id: row.id, version: versionOf(current), intervalSec: 60 }));
    current = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(current.nextCheckAt.getTime() <= Date.now() + 1000, "fällig");
    assert.deepEqual([current.state, current.intervalSec], ["up", 60]);
    // 1 min → 10 min: nächster Termin = letzte Messung + 10 min (nicht schon nach einer Minute)
    const recent = new Date(Date.now() - 2 * 60_000);
    await env.db.netMonitorTarget.update({ where: { id: row.id }, data: { lastCheckAt: recent, nextCheckAt: new Date(recent.getTime() + 60_000) } });
    current = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    await redirectOf(() => save({ id: row.id, version: versionOf(current), intervalSec: 600 }));
    current = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(current.nextCheckAt.getTime(), recent.getTime() + 600_000);
  });

  it("Ausschalten (Ziel oder ganze Überwachung) setzt den Zustand auf „unbekannt“: nach dem Wiedereinschalten gibt es keine „Wieder erreichbar nach 3 Tagen“", async () => {
    await login(["network.view", "network.monitor"]);
    await redirectOf(() => save());
    const row = await env.db.netMonitorTarget.findFirstOrThrow();
    const down = { state: "down", failStreak: 5, stateSince: at(-3 * 86_400), lastCheckAt: at(-100), lastClass: "timeout" };
    await env.db.netMonitorTarget.update({ where: { id: row.id }, data: down });
    let current = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    await redirectOf(() => save({ id: row.id, version: versionOf(current), enabled: false }));
    current = await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([current.enabled, current.state, current.stateSince, current.failStreak, current.lastCheckAt], [false, "unknown", null, 0, null]);
    // ganze Überwachung
    await env.db.netMonitorTarget.update({ where: { id: row.id }, data: { ...down, enabled: true } });
    await actions.setMonitoring(form({ enabled: "true" }));
    await actions.setMonitoring(form({ enabled: "false" }));
    assert.equal((await env.db.netMonitorTarget.findUniqueOrThrow({ where: { id: row.id } })).state, "unknown");
  });
});

describe("Grenzen des Rechts: Docker-Host gesperrt, Änderungen gedrosselt, Überwachen setzt Ansehen voraus", () => {
  it("network.monitor ohne network.view: alle Operationen verweigert (die Formulare lesen Geräte und IP-Adressen)", async () => {
    await login(["network.monitor"]);
    assert.ok((await save()).error, "Anlegen verweigert");
    await actions.setMonitoring(form({ enabled: "true" })).catch(() => undefined);
    assert.equal(await queries.monitoringEnabled(), false, "Schalter verweigert");
    assert.equal(await env.db.netMonitorTarget.count(), 0);
  });

  it("das Host-Gateway des Containers und host.docker.internal gelten wie der eigene Rechner: beim Speichern abgelehnt", async () => {
    const { setGatewayTestHooks } = await import("@/server/host-gateway");
    setGatewayTestHooks({ gateways: ["172.17.0.1"] });
    try {
      await login(["network.view", "network.monitor"]);
      for (const host of ["172.17.0.1", "::ffff:172.17.0.1", "::ffff:ac11:1", "host.docker.internal", "Host.Docker.Internal.", "gateway.docker.internal"]) {
        assert.ok((await save({ host })).fieldErrors?.host, host);
      }
      assert.equal(await env.db.netMonitorTarget.count(), 0);
      // andere private Adressen bleiben erlaubt
      assert.ok(await redirectOf(() => save({ host: "172.17.0.2", name: "Nachbar" })));
    } finally {
      setGatewayTestHooks({});
    }
  });

  it("Zieladressen anlegen/ändern ist je Konto gedrosselt (10 frei, dann wartet das Konto) – Umbenennen und Intervall zählen nicht, ein anderes Konto ist nicht betroffen", async () => {
    const { resetLoginThrottle } = await import("@/server/auth/throttle");
    resetLoginThrottle();
    await login(["network.view", "network.monitor"]);
    for (let i = 0; i < 10; i++) await redirectOf(() => save({ host: `10.20.0.${i + 1}`, name: `T${i}` }));
    const blocked = await save({ host: "10.20.0.99", name: "Zu viel" });
    assert.ok(blocked.error, "elfte Änderung wird gebremst");
    assert.equal(await env.db.netMonitorTarget.count({ where: { name: "Zu viel" } }), 0);
    // Umbenennen und Intervall ändern: keine Adressänderung
    const row = await env.db.netMonitorTarget.findFirstOrThrow({ where: { name: "T0" } });
    assert.ok(await redirectOf(() => save({ id: row.id, version: versionOf(row), host: row.host, name: "T0 neu", intervalSec: 600 })));
    // ein anderes Konto hat sein eigenes Kontingent
    await login(["network.view", "network.monitor"]);
    assert.ok(await redirectOf(() => save({ host: "10.30.0.1", name: "Anderes Konto" })));
    resetLoginThrottle();
  });
});

describe("Job-Meldung", () => {
  it("eine Routinerunde meldet nichts (kein Eintrag im Laufprotokoll); Ausfall und Wiederkehr schon", async () => {
    const { featureJobs } = await import("@/modules/jobs");
    const monitor = featureJobs.find((j) => j.id === "network.monitor")!;
    const { allowLoopbackForTests } = await import("@/lib/offsite/host-policy");
    const { startTcp } = await import("@/test/fake-monitor");
    await env.db.appSetting.upsert({ where: { key: run.MONITOR_ENABLED_SETTING }, update: { value: "true" }, create: { key: run.MONITOR_ENABLED_SETTING, value: "true" } });
    const server = await startTcp();
    const ctx = () => ({ now: new Date(), signal: new AbortController().signal, attempt: 1, manual: false });
    try {
      allowLoopbackForTests();
      const target = await env.db.netMonitorTarget.create({ data: { name: "J", kind: "tcp", host: "127.0.0.1", port: server.port, intervalSec: 300, nextCheckAt: new Date(0) } });
      assert.equal(await monitor.run(ctx()), undefined, "Routine: erreichbar, nichts Auffälliges");
      // ausfallen lassen: zwei Fehlschläge in Folge
      await server.close();
      await env.db.netMonitorTarget.update({ where: { id: target.id }, data: { nextCheckAt: new Date(0) } });
      assert.equal(await monitor.run(ctx()), undefined, "erster Fehlschlag: noch kein Wechsel");
      await env.db.netMonitorTarget.update({ where: { id: target.id }, data: { nextCheckAt: new Date(0) } });
      assert.match(String(await monitor.run(ctx())), /1 ausgefallen/);
    } finally {
      offsiteNetwork.allowLoopback = false;
      await server.close().catch(() => undefined);
    }
  });
});

describe("Verlauf: Rohwerte am Siebentagerand", () => {
  it("noch nicht verdichtete Rohwerte älter als 7 Tage erscheinen (zwischen nächtlichem Aufräumen und jetzt − 7 Tage klafft keine Lücke); verdichtete werden nicht doppelt gezählt", async () => {
    const NOW = new Date("2026-03-10T10:00:00.000Z");
    const DAY = 86_400_000;
    const target = await env.db.netMonitorTarget.create({ data: { name: "H", kind: "tcp", host: "10.0.0.9", port: 22 } });
    await env.db.netMonitorSample.createMany({
      data: [
        { targetId: target.id, at: new Date(NOW.getTime() - 7 * DAY - 2 * 3600_000), ok: true, latencyMs: 12, statusClass: "open" },
        { targetId: target.id, at: new Date(NOW.getTime() - 7 * DAY + 2 * 3600_000), ok: false, latencyMs: null, statusClass: "timeout" },
      ],
    });
    const before = await queries.monitorHistory(target.id, NOW);
    assert.equal(before.hours.reduce((n, h) => n + h.checks, 0), 2, "beide Messungen zählen");
    assert.equal(before.availability30d, 50);
    // nach dem Aufräumen: die ältere ist verdichtet (Stundenwert), die jüngere bleibt roh – die Summe ändert sich nicht
    await run.pruneMonitor(NOW);
    const after = await queries.monitorHistory(target.id, NOW);
    assert.equal(after.hours.reduce((n, h) => n + h.checks, 0), 2, "keine Doppelzählung");
  });
});

describe("Sichtbarkeit der Zieladresse", () => {
  it("ohne network.monitor liest die Abfrage Host, Port und Pfad gar nicht erst; mit dem Recht stehen sie dabei", async () => {
    await env.db.netMonitorTarget.create({ data: { name: "Intern", kind: "https", host: "10.0.0.8", port: 8443, path: "/geheim?token=abc", state: "up", lastCheckAt: new Date("2026-03-10T10:00:00Z") } });
    const plain = await queries.listMonitorTargets({ canManage: false });
    assert.equal(plain.length, 1);
    assert.deepEqual(Object.keys(plain[0]).sort(), ["device", "enabled", "id", "intervalSec", "kind", "lastCheckAt", "lastClass", "lastLatencyMs", "name", "state", "stateSince"]);
    assert.ok(!JSON.stringify(plain).includes("10.0.0.8") && !JSON.stringify(plain).includes("token=abc"));
    const detail = await queries.getMonitorTarget(plain[0].id, { canManage: false });
    assert.equal(detail?.address, undefined);
    const full = await queries.listMonitorTargets({ canManage: true });
    assert.deepEqual(full[0].address, { host: "10.0.0.8", port: 8443, path: "/geheim?token=abc", method: "HEAD", ignoreTlsErrors: false });
  });
});

describe("API (nur lesend, nur Gemessenes)", () => {
  let token: string;
  type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const call = async (method: string, path: string, who = token, body?: unknown) => {
    const response = await router.handleApiRequest(apiRequest(method, path, { token: who, body }));
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : {}) as Json };
  };
  before(async () => {
    token = (await makeToken(env, { admin: true, scope: ["network.view"] })).token;
  });

  it("ausgeschaltete Überwachung: keine Ziele (es gibt nichts Gemessenes)", async () => {
    await env.db.netMonitorTarget.create({ data: { name: "T", kind: "tcp", host: "10.0.0.1", port: 22, state: "up", lastCheckAt: new Date("2099-01-01T00:00:00Z"), lastLatencyMs: 4 } });
    const off = await call("GET", "/network-status");
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.data, []);
    const row = await env.db.netMonitorTarget.findFirstOrThrow();
    assert.equal((await call("GET", `/network-status/${row.id}`)).status, 404);
  });

  it("eingeschaltet: Zustand, Latenz, Klasse, Zeitpunkte – nie Host, Port oder Pfad; veraltete Messungen als unbekannt mit stale", async () => {
    await env.db.appSetting.create({ data: { key: run.MONITOR_ENABLED_SETTING, value: "true" } });
    await env.db.netMonitorTarget.create({ data: { name: "T", kind: "tcp", host: "10.0.0.1", port: 22, path: "/x", state: "up", lastCheckAt: new Date("2099-01-01T00:00:00Z"), lastLatencyMs: 4, lastClass: "open" } });
    const fresh = await call("GET", "/network-status");
    assert.equal(fresh.json.data.length, 1);
    const item = fresh.json.data[0];
    assert.deepEqual(Object.keys(item).sort(), ["deviceId", "id", "intervalSeconds", "kind", "lastCheckAt", "latencyMs", "name", "resultClass", "stale", "state", "stateSince"]);
    assert.deepEqual([item.state, item.stale, item.latencyMs, item.resultClass], ["up", false, 4, "open"]);
    assert.ok(!JSON.stringify(fresh.json).includes("10.0.0.1"));
    await env.db.netMonitorTarget.updateMany({ data: { lastCheckAt: new Date("2020-01-01T00:00:00Z") } });
    const stale = (await call("GET", "/network-status")).json.data[0];
    assert.deepEqual([stale.state, stale.stale], ["unknown", true]);
    await env.db.netMonitorEvent.create({ data: { targetId: item.id, at: new Date("2026-03-10T10:00:00Z"), kind: "down" } });
    const events = await call("GET", `/network-status-events?targetId=${item.id}`);
    assert.deepEqual(events.json.data.map((e: Json) => [e.kind, e.downSeconds]), [["down", null]]);
  });

  it("Schreiben gibt es nicht; ein Token kann network.monitor nicht tragen; ohne network.view im Scope 403", async () => {
    for (const [method, path] of [["POST", "/network-status"], ["PATCH", "/network-status/x"], ["DELETE", "/network-status/x"]] as const) {
      assert.ok([404, 405].includes((await call(method, path, token, { name: "x" })).status), method);
    }
    assert.equal(await env.db.netMonitorTarget.count(), 0, "nichts angelegt");
    const { checkTokenScope } = await import("@/lib/api/scope");
    assert.equal(checkTokenScope({ rights: new Set(["network.monitor", "network.view"]) }, ["network.monitor"]), "forbidden");
    const none = (await makeToken(env, { admin: true, scope: ["customers.view"] })).token;
    assert.equal((await call("GET", "/network-status", none)).status, 403);
  });
});

describe("Job", () => {
  it("der Job ist angemeldet, gehört der Funktion IT & Netzwerk und prüft nur bei eingeschalteter Überwachung (shouldRun)", async () => {
    const { featureJobs } = await import("@/modules/jobs");
    const monitor = featureJobs.find((j) => j.id === "network.monitor");
    assert.ok(monitor && monitor.feature === "it.network");
    assert.deepEqual(monitor.schedule, { every: 30_000 });
    assert.equal(await monitor.shouldRun!({ now: new Date("2026-03-10T10:00:00Z") }), false);
    assert.ok(featureJobs.some((j) => j.id === "network.monitor-prune" && j.feature === "it.network"));
  });
});
