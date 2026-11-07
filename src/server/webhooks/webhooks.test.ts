import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { offsiteNetwork } from "@/lib/offsite/host-policy";
import { MAX_ATTEMPTS, classifyStatus, retryDelayMs } from "@/lib/webhooks/schedule";
import { generateWebhookSecret, signWebhook, signatureHeader, verifyWebhook } from "@/lib/webhooks/signature";
import { checkWebhookUrl } from "@/lib/webhooks/url";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { startFakeWebhook, type FakeWebhookServer } from "@/test/fake-webhook";

/**
 * Webhooks: Signatur (Referenzprüfer, Wiederholungsschutz), Zielsperre (Loopback, Link-Local, Metadaten, Private, ULA, IPv4-gemappt, Dezimal-/Hex-Schreibweise), Festlegen der Adresse
 * (Rebinding), keine Weiterleitungen, TLS-Prüfung, Zeit- und Größenlimits, Zustellung mit Wiederholung bis zum Aufgeben, 410, Idempotenz paralleler Zustellung, Nutzlast ohne Fachdaten, Zustellprotokoll
 * ohne Nutzlast und Antworttext, Operationen der Verwaltung und das Zurücksetzen der Geheimnisse.
 */
describe("Signatur und Referenzprüfung", () => {
  const body = '{"id":"evt_1","type":"order.closed"}';

  it("HMAC-SHA256 über Zeitstempel.ID.Body, hexadezimal; verifizierbar mit dem Referenzprüfer", () => {
    const secret = generateWebhookSecret();
    assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
    const signature = signWebhook(secret, 1_700_000_000, "evt_1", body);
    assert.match(signature, /^[0-9a-f]{64}$/);
    // fester Vektor (Gegenprobe gegen eine unabhängige Berechnung)
    assert.equal(signWebhook("geheim", "1700000000", "evt_1", "{}"), "c72d7b3e4a90c1fb6391e29b9a367241c624d869fe1276dfeff7aa906a6a9bc9");
    const header = signatureHeader([secret], 1_700_000_000, "evt_1", body);
    assert.equal(header, `v1=${signature}`);
    assert.deepEqual(verifyWebhook({ secrets: [secret], timestamp: "1700000000", eventId: "evt_1", body, signature: header, now: 1_700_000_010 }), { ok: true });
  });

  it("Wiederholungsschutz: ein alter (oder zu neuer) Zeitstempel, ein anderer Body, ein anderes Geheimnis und Unsinn werden abgelehnt", () => {
    const secret = generateWebhookSecret();
    const header = signatureHeader([secret], 1_700_000_000, "evt_1", body);
    const check = (over: Partial<Parameters<typeof verifyWebhook>[0]>) => verifyWebhook({ secrets: [secret], timestamp: "1700000000", eventId: "evt_1", body, signature: header, now: 1_700_000_000, ...over });
    assert.deepEqual(check({}), { ok: true });
    assert.deepEqual(check({ now: 1_700_000_000 + 301 }), { ok: false, reason: "timestamp" }, "Wiederholung mit altem Zeitstempel");
    assert.deepEqual(check({ now: 1_700_000_000 - 301 }), { ok: false, reason: "timestamp" });
    assert.deepEqual(check({ now: 1_700_000_000 + 299 }), { ok: true });
    assert.deepEqual(check({ body: `${body} ` }), { ok: false, reason: "signature" });
    assert.deepEqual(check({ eventId: "evt_2" }), { ok: false, reason: "signature" });
    assert.deepEqual(check({ timestamp: "1700000001" }), { ok: false, reason: "signature" });
    assert.deepEqual(check({ secrets: [generateWebhookSecret()] }), { ok: false, reason: "signature" });
    assert.deepEqual(check({ signature: "v1=zz" }), { ok: false, reason: "signature" });
    assert.deepEqual(check({ signature: "" }), { ok: false, reason: "format" });
    assert.deepEqual(check({ signature: header.replace("v1=", "v2=") }), { ok: false, reason: "format" });
    assert.deepEqual(check({ timestamp: "abc" }), { ok: false, reason: "format" });
    assert.deepEqual(check({ timestamp: null }), { ok: false, reason: "format" });
  });

  it("Rotation: zwei Signaturen im Kopf, jedes der beiden Geheimnisse genügt", () => {
    const [fresh, old] = [generateWebhookSecret(), generateWebhookSecret()];
    const header = signatureHeader([fresh, old], 1_700_000_000, "evt_1", body);
    assert.equal(header.split(",").length, 2);
    for (const secrets of [[fresh], [old], [old, fresh]]) assert.deepEqual(verifyWebhook({ secrets, timestamp: "1700000000", eventId: "evt_1", body, signature: header, now: 1_700_000_000 }), { ok: true });
    assert.deepEqual(verifyWebhook({ secrets: [generateWebhookSecret()], timestamp: "1700000000", eventId: "evt_1", body, signature: header, now: 1_700_000_000 }), { ok: false, reason: "signature" });
  });

  it("Wartezeiten 1 min … 6 h, höchstens 12 Versuche; Statuscodes: 2xx Erfolg, 410 Ziel weg, 3xx Weiterleitung, sonst wiederholen", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => retryDelayMs(n) / 60_000), [1, 5, 15, 30, 60, 120, 180, 240, 360, 360, 360]);
    assert.equal(retryDelayMs(0), 60_000);
    assert.equal(MAX_ATTEMPTS, 12);
    assert.deepEqual([200, 204, 410, 301, 302, 400, 404, 429, 500, 503].map(classifyStatus), ["sent", "sent", "gone", "redirect", "redirect", "retry", "retry", "retry", "retry", "retry"]);
  });
});

describe("Zielsperre (Adresse ohne Netzwerk)", () => {
  before(() => {
    offsiteNetwork.allowLoopback = false;
  });
  const blocked = (url: string, allowPrivate = false) => {
    const result = checkWebhookUrl(url, { allowPrivate });
    return result.ok ? "ok" : result.problem;
  };

  it("eigener Rechner, Link-Local, Metadaten, IPv6-Loopback, IPv4-gemappt, Dezimal-, Hex- und Oktal-Schreibweise sind nie erlaubt – auch nicht mit Freigabe", () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://127.1/hook",
      "https://localhost/hook",
      "https://foo.localhost/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://169.254.0.5/",
      "https://[::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://[::ffff:7f00:1]/hook",
      "https://[::ffff:169.254.169.254]/",
      "https://[fe80::1]/",
      "https://[fd00:ec2::254]/",
      "https://2130706433/hook",
      "https://0x7f000001/hook",
      "https://0177.0.0.1/hook",
      "https://2852039166/",
      "https://0xa9fea9fe/",
      "https://0.0.0.0/",
      "https://metadata.google.internal/",
      "https://100.100.100.200/",
      "https://168.63.129.16/",
    ]) {
      assert.equal(blocked(url), "forbiddenHost", url);
      assert.equal(blocked(url, true), "forbiddenHost", `${url} (mit Freigabe)`);
    }
  });

  it("private Netze (10.x, 172.16–31.x, 192.168.x, 100.64/10, ULA) nur mit ausdrücklicher Freigabe; http nur dort", () => {
    for (const url of ["https://10.1.2.3/hook", "https://172.16.0.9/", "https://192.168.1.20/", "https://100.64.0.1/", "https://[fd12:3456::1]/", "https://[fc00::1]/", "https://[::ffff:10.0.0.1]/", "https://167772161/"]) {
      assert.equal(blocked(url), "privateNeedsApproval", url);
      assert.equal(blocked(url, true), "ok", `${url} (mit Freigabe)`);
    }
    assert.equal(blocked("http://192.168.1.20/hook", true), "ok", "Klartext zu einem privaten Ziel mit Freigabe");
    assert.equal(blocked("http://192.168.1.20/hook"), "privateNeedsApproval");
    assert.equal(blocked("http://203.0.113.5/hook", true), "plainNeedsPrivate", "nie unverschlüsselt zu einer öffentlichen Adresse");
    assert.equal(blocked("http://hook.example.org/", false), "plainNeedsPrivate");
  });

  it("öffentliche https-Ziele gehen; Zugangsdaten, Fragmente, falsche Schemas und Unsinn nicht", () => {
    for (const url of ["https://hook.example.org/a?b=1", "https://203.0.113.5:8443/x", "https://[2001:db8::1]/x"]) assert.equal(blocked(url), "ok", url);
    assert.equal(blocked("https://user:pw@hook.example.org/"), "credentials");
    assert.equal(blocked("https://hook.example.org/#x"), "fragment");
    for (const url of ["ftp://hook.example.org/", "file:///etc/passwd", "javascript:alert(1)", "gopher://x/"]) assert.equal(blocked(url), "scheme", url);
    for (const url of ["", "   ", "nicht-eine-adresse", "https://", `https://${"a".repeat(600)}.example.org/`, "https://hook.example.org/\nHost: x"]) assert.equal(blocked(url), "invalid", url);
  });
});

describe("Zustellung", () => {
  let env: TestEnv;
  let server: FakeWebhookServer;
  let send: typeof import("./send");
  let target: typeof import("./target");
  let deliver: typeof import("./deliver");
  let secrets: typeof import("./secrets");
  let ops: typeof import("@/modules/admin/api/operations");
  let jobs: typeof import("@/modules/admin/api/jobs");
  let admin: import("@/server/auth/session").AppSession;
  const PASSWORD = "Passwort-Test-1234";

  const lookupLocal = async () => [{ address: "127.0.0.1", family: 4 }];

  before(async () => {
    env = await createTestEnv();
    send = await import("./send");
    target = await import("./target");
    deliver = await import("./deliver");
    secrets = await import("./secrets");
    ops = await import("@/modules/admin/api/operations");
    jobs = await import("@/modules/admin/api/jobs");
    const { allowLoopbackForTests } = await import("@/lib/offsite/host-policy");
    allowLoopbackForTests();
    const { getSession } = await import("@/server/auth/session");
    const user = await env.user({ username: "webhook-admin", password: PASSWORD, roles: [await env.role({ isAdmin: true })] });
    env.browser.reset();
    await env.signIn({ id: user.id });
    admin = (await getSession())!;
  });
  after(async () => {
    await server?.close();
    await env.cleanup();
  });
  beforeEach(async () => {
    await server?.close();
    send.setWebhookTestHooks({});
    await env.db.webhook.deleteMany();
    await env.db.appSetting.deleteMany({ where: { key: { startsWith: "webhook." } } });
    await env.db.auditLog.deleteMany();
    await env.db.outboxEvent.deleteMany();
  });

  /** Ziel starten, Zertifikat und Namensauflösung vorgeben, Webhook samt Geheimnis anlegen. */
  async function setup(options: Parameters<typeof startFakeWebhook>[0] = {}, webhook: { enabled?: boolean; events?: string; allowPrivate?: boolean } = {}) {
    server = await startFakeWebhook(options);
    send.setWebhookTestHooks({ ca: server.cert, lookup: lookupLocal });
    const row = await env.db.webhook.create({ data: { name: "Ziel", url: server.url, events: webhook.events ?? "order.closed,billing.paid", enabled: webhook.enabled ?? true, allowPrivate: webhook.allowPrivate ?? true } });
    const secret = await secrets.issueWebhookSecret(row.id);
    return { row, secret };
  }
  const event = (id: string, type = "order.closed", entityId: string | null = "order_1") => ({ id, type, entityId, createdAt: new Date("2026-03-01T10:00:00Z") });

  it("Nutzlast und Köpfe: nur ID, Typ, Zeitpunkt, Ressource und ID der Sache; Signatur verifizierbar (auch mit dem Prüfcode der Doku); Zeitstempel frisch", async () => {
    const { secret } = await setup();
    assert.equal(await deliver.fanOutEvent(event("evt_a")), 1);
    const now = new Date();
    const summary = await deliver.deliverDue({ now });
    assert.equal(summary.sent, 1);
    assert.equal(server.requests.length, 1);
    const [request] = server.requests;
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/hook");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["x-webhook-id"], "evt_a");
    assert.equal(request.headers["x-webhook-event"], "order.closed");
    assert.match(String(request.headers["user-agent"]), /^SchrauberOS-Webhook\//);
    assert.deepEqual(JSON.parse(request.body), { id: "evt_a", type: "order.closed", createdAt: "2026-03-01T10:00:00.000Z", entity: { resource: "orders", id: "order_1" } });
    assert.equal(Number(request.headers["x-webhook-timestamp"]), Math.floor(now.getTime() / 1000));
    const check = verifyWebhook({ secrets: [secret], timestamp: String(request.headers["x-webhook-timestamp"]), eventId: String(request.headers["x-webhook-id"]), body: request.body, signature: String(request.headers["x-webhook-signature"]) });
    assert.deepEqual(check, { ok: true });

    // Der Prüfcode der Doku-Seite ist Referenz: ausgeführt akzeptiert er die Anfrage und lehnt Wiederholungen mit altem Zeitstempel ab
    const { NODE_VERIFY } = await import("@/modules/admin/api/docs-examples");
    const source = NODE_VERIFY.replace(/^import .*$/m, "").replace("export function", "function");
    const verify = new Function("createHmac", "timingSafeEqual", "Buffer", `${source}
return verifyWebhook;`)(createHmac, timingSafeEqual, Buffer) as (s: string[], h: Record<string, string>, b: string) => boolean;
    const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, String(v)]));
    assert.equal(verify([secret], headers, request.body), true);
    assert.equal(verify([secret], { ...headers, "x-webhook-timestamp": String(Math.floor(now.getTime() / 1000) - 3600) }, request.body), false, "Wiederholung mit altem Zeitstempel");
    assert.equal(verify([secret], headers, `${request.body} `), false);
    assert.equal(verify([generateWebhookSecret()], headers, request.body), false);
  });

  it("jeder Versuch trägt einen neuen Zeitstempel und eine neue Signatur (späte Wiederholungen bleiben im Fenster)", async () => {
    const { secret } = await setup({ respond: (_r, i) => ({ status: i === 0 ? 500 : 204 }) });
    await deliver.fanOutEvent(event("evt_t"));
    const t0 = new Date();
    assert.equal((await deliver.deliverDue({ now: t0 })).retried, 1);
    const t1 = new Date(t0.getTime() + 61_000);
    assert.equal((await deliver.deliverDue({ now: t1 })).sent, 1);
    const stamps = server.requests.map((r) => Number(r.headers["x-webhook-timestamp"]));
    assert.equal(stamps[1] - stamps[0], 61);
    assert.notEqual(server.requests[0].headers["x-webhook-signature"], server.requests[1].headers["x-webhook-signature"]);
    for (const r of server.requests) assert.deepEqual(verifyWebhook({ secrets: [secret], timestamp: String(r.headers["x-webhook-timestamp"]), eventId: "evt_t", body: r.body, signature: String(r.headers["x-webhook-signature"]), now: Number(r.headers["x-webhook-timestamp"]) }), { ok: true });
  });

  it("Rotation: während der Überlappung zwei Signaturen (neues zuerst), danach nur das neue", async () => {
    const { row, secret: first } = await setup();
    const second = await secrets.rotateWebhookSecret(row.id);
    await env.db.webhook.update({ where: { id: row.id }, data: { previousSecretUntil: new Date(Date.now() + 3_600_000) } });
    await deliver.fanOutEvent(event("evt_r1"));
    await deliver.deliverDue({});
    const header = String(server.requests[0].headers["x-webhook-signature"]);
    assert.equal(header.split(",").length, 2);
    for (const secret of [first, second]) assert.deepEqual(verifyWebhook({ secrets: [secret], timestamp: String(server.requests[0].headers["x-webhook-timestamp"]), eventId: "evt_r1", body: server.requests[0].body, signature: header }), { ok: true });
    // Überlappung vorbei: nur das neue Geheimnis
    await env.db.webhook.update({ where: { id: row.id }, data: { previousSecretUntil: new Date(Date.now() - 1000) } });
    await deliver.fanOutEvent(event("evt_r2"));
    await deliver.deliverDue({});
    const later = String(server.requests[1].headers["x-webhook-signature"]);
    assert.equal(later.split(",").length, 1);
    assert.deepEqual(verifyWebhook({ secrets: [first], timestamp: String(server.requests[1].headers["x-webhook-timestamp"]), eventId: "evt_r2", body: server.requests[1].body, signature: later }), { ok: false, reason: "signature" });
  });

  it("Weiterleitungen werden nie verfolgt: eine 3xx-Antwort ist ein Fehlversuch, es folgt keine zweite Anfrage", async () => {
    await setup({ respond: () => ({ status: 307, location: "https://169.254.169.254/latest/meta-data" }) });
    const result = await send.postWebhook(server.url, { allowPrivate: true, headers: {}, body: "{}" });
    assert.equal(result.status, 307);
    assert.equal(server.requests.length, 1);
    await deliver.fanOutEvent(event("evt_redirect"));
    await deliver.deliverDue({});
    const row = await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "evt_redirect" } });
    assert.deepEqual([row.status, row.lastStatus, row.lastError], ["pending", 307, "redirect"]);
    assert.equal(server.requests.length, 2, "ein Versuch, keine Folgeanfrage an das Ziel der Weiterleitung");
  });

  it("DNS-Rebinding: aufgelöst wird einmal, verbunden wird mit der geprüften Adresse; ein Name mit auch nur einer verbotenen Antwort wird nie angesprochen", async () => {
    server = await startFakeWebhook();
    send.setWebhookTestHooks({ ca: server.cert });
    let calls = 0;
    // erste Auflösung: erlaubte Adresse (der Test-Empfänger), jede weitere: Metadaten-Dienst
    const rebinding = async () => (++calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "169.254.169.254", family: 4 }]);
    const ok = await send.postWebhook(server.url, { allowPrivate: true, headers: {}, body: "{}" }, { lookup: rebinding });
    assert.equal(ok.status, 204);
    assert.equal(calls, 1, "nur eine Auflösung – zwischen Prüfung und Verbindung gibt es keine zweite");
    assert.equal(server.requests.length, 1);

    // eine verbotene Antwort unter mehreren genügt zur Ablehnung; es wird nie verbunden
    for (const answers of [
      [{ address: "169.254.169.254", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }, { address: "169.254.169.254", family: 4 }],
      [{ address: "::ffff:169.254.169.254", family: 6 }],
      [{ address: "0.0.0.0", family: 4 }],
    ]) {
      await assert.rejects(send.postWebhook(server.url, { allowPrivate: true, headers: {}, body: "{}" }, { lookup: async () => answers }), (e: unknown) => e instanceof target.WebhookError && e.code === "forbiddenHost");
    }
    assert.equal(server.requests.length, 1, "kein weiterer Verbindungsversuch");
  });

  it("öffentliche Namen, die privat auflösen, brauchen die Freigabe; ohne Freigabe wird nicht verbunden", async () => {
    server = await startFakeWebhook();
    send.setWebhookTestHooks({ ca: server.cert });
    const privateAnswer = async () => [{ address: "10.1.2.3", family: 4 }];
    await assert.rejects(send.postWebhook("https://hook.example.org/x", { allowPrivate: false, headers: {}, body: "{}" }, { lookup: privateAnswer }), (e: unknown) => e instanceof target.WebhookError && e.code === "forbiddenHost");
    // mit Freigabe geht der Name an die private Adresse (hier nicht erreichbar → connect/timeout, aber nicht verboten)
    await assert.rejects(send.postWebhook("https://hook.example.org/x", { allowPrivate: true, headers: {}, body: "{}" }, { lookup: privateAnswer, timeoutMs: 300 }), (e: unknown) => e instanceof target.WebhookError && e.code !== "forbiddenHost");
    // ULA und IPv4-gemappt wie private
    await assert.rejects(send.postWebhook("https://hook.example.org/x", { allowPrivate: false, headers: {}, body: "{}" }, { lookup: async () => [{ address: "fd12::1", family: 6 }] }), (e: unknown) => e instanceof target.WebhookError && e.code === "forbiddenHost");
    await assert.rejects(send.postWebhook("https://hook.example.org/x", { allowPrivate: false, headers: {}, body: "{}" }, { lookup: async () => [{ address: "::ffff:192.168.0.1", family: 6 }] }), (e: unknown) => e instanceof target.WebhookError && e.code === "forbiddenHost");
    assert.equal(server.requests.length, 0);
  });

  it("TLS wird geprüft (unbekannte Zertifizierungsstelle → tls), Klartext nie zu öffentlichen Zielen, Zeitlimit und Antwortgrenze greifen", async () => {
    await setup({ respond: (_r, i) => (i === 1 ? { status: 200, delayMs: 2_000 } : i === 0 ? { status: 200, bodyBytes: 200_000 } : { status: 204 }) });
    send.setWebhookTestHooks({ lookup: lookupLocal }); // ohne die Zertifizierungsstelle des Test-Empfängers
    await assert.rejects(send.postWebhook(server.url, { allowPrivate: true, headers: {}, body: "{}" }), (e: unknown) => e instanceof target.WebhookError && e.code === "tls");
    assert.equal(server.requests.length, 0, "nichts geht über eine ungeprüfte Verbindung hinaus");
    send.setWebhookTestHooks({ ca: server.cert, lookup: lookupLocal });
    // Antwort sehr groß: es zählt nur der Statuscode, der Rest wird abgebrochen
    const big = await send.postWebhook(server.url, { allowPrivate: true, headers: {}, body: "{}" });
    assert.equal(big.status, 200);
    // Zeitlimit
    await assert.rejects(send.postWebhook(server.url, { allowPrivate: true, headers: {}, body: "{}" }, { timeoutMs: 300 }), (e: unknown) => e instanceof target.WebhookError && e.code === "timeout");
    // Klartext zu einer öffentlichen Adresse: nie
    await assert.rejects(send.postWebhook("http://203.0.113.5/x", { allowPrivate: true, headers: {}, body: "{}" }), (e: unknown) => e instanceof target.WebhookError && e.code === "config");
    // Verbindung verweigert
    await assert.rejects(send.postWebhook("https://127.0.0.1:1/x", { allowPrivate: true, headers: {}, body: "{}" }), (e: unknown) => e instanceof target.WebhookError && e.code === "connect");
  });

  it("Fehlversuche werden mit wachsender Pause wiederholt; nach 12 Versuchen ist die Zustellung aufgegeben (sichtbar) und wird nicht mehr gesendet", async () => {
    await setup({ respond: () => ({ status: 503, body: "GEHEIMER ANTWORTTEXT" }) });
    await deliver.fanOutEvent(event("evt_dead"));
    let now = new Date();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const summary = await deliver.deliverDue({ now });
      assert.equal(summary.retried + summary.failed, 1, `Versuch ${attempt}`);
      const row = await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "evt_dead" } });
      assert.equal(row.attempts, attempt);
      assert.equal(row.lastStatus, 503);
      assert.equal(row.lastError, "http");
      if (attempt < MAX_ATTEMPTS) {
        assert.equal(row.status, "pending");
        assert.equal(row.nextAttemptAt.getTime() - now.getTime(), retryDelayMs(attempt));
        // vor Ablauf der Wartezeit wird nichts gesendet
        assert.equal((await deliver.deliverDue({ now: new Date(now.getTime() + retryDelayMs(attempt) - 1000) })).retried, 0);
        now = new Date(now.getTime() + retryDelayMs(attempt));
      } else {
        assert.equal(row.status, "failed");
        assert.ok(row.completedAt);
      }
    }
    assert.equal(server.requests.length, MAX_ATTEMPTS);
    assert.equal(await deliver.hasDueDeliveries(new Date(now.getTime() + 100 * 86_400_000)), false);
    assert.equal((await deliver.deliverDue({ now: new Date(now.getTime() + 100 * 86_400_000) })).retried, 0);
    // Protokoll: weder Nutzlast noch Antworttext
    const dump = JSON.stringify(await env.db.webhookDelivery.findMany());
    assert.ok(!dump.includes("GEHEIMER ANTWORTTEXT"));
    const columns = Object.keys((await env.db.webhookDelivery.findFirstOrThrow()) as object).sort();
    assert.deepEqual(columns, ["attempts", "completedAt", "createdAt", "entityId", "eventAt", "eventId", "id", "lastAttemptAt", "lastDurationMs", "lastError", "lastStatus", "nextAttemptAt", "status", "type", "webhookId"], "das Protokoll kennt keine Nutzlast und keinen Antworttext");
  });

  it("„Erneut zustellen“ nimmt eine aufgegebene Zustellung wieder auf (gleiche Ereignis-ID); Tests und ausgeschaltete Ziele nicht", async () => {
    const { row } = await setup({ respond: (_r, i) => ({ status: i < MAX_ATTEMPTS ? 500 : 204 }) });
    await deliver.fanOutEvent(event("evt_again"));
    let now = new Date();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await deliver.deliverDue({ now });
      now = new Date(now.getTime() + 7 * 3_600_000);
    }
    const dead = await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "evt_again" } });
    assert.equal(dead.status, "failed");
    const again = await ops.redeliverOperation.execute(admin, { id: dead.id });
    assert.ok(again.ok);
    assert.equal((await env.db.webhookDelivery.findUniqueOrThrow({ where: { id: dead.id } })).attempts, 0);
    assert.equal((await deliver.deliverDue({ now })).sent, 1);
    assert.equal(server.requests.at(-1)?.headers["x-webhook-id"], "evt_again");
    // wartend oder zurückgestellt: nicht noch einmal anstoßen
    await env.db.webhookDelivery.update({ where: { id: dead.id }, data: { status: "pending" } });
    const busy = await ops.redeliverOperation.execute(admin, { id: dead.id });
    assert.ok(!busy.ok && busy.failure.code === "conflict");
    await env.db.webhookDelivery.update({ where: { id: dead.id }, data: { status: "failed" } });
    await env.db.webhook.update({ where: { id: row.id }, data: { enabled: false } });
    const off = await ops.redeliverOperation.execute(admin, { id: dead.id });
    assert.ok(!off.ok && off.failure.code === "conflict");
  });

  it("410 Gone beendet die Zustellung und schaltet das Ziel aus (offene Zustellungen werden zurückgestellt, Audit nennt den Grund)", async () => {
    const { row } = await setup({ respond: () => ({ status: 410 }) });
    await deliver.fanOutEvent(event("evt_g1"));
    await deliver.fanOutEvent(event("evt_g2"));
    const summary = await deliver.deliverDue({ limit: 1 });
    assert.equal(summary.gone, 1);
    const hook = await env.db.webhook.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([hook.enabled, hook.disabledReason], [false, "gone"]);
    const states = (await env.db.webhookDelivery.findMany({ orderBy: { eventId: "asc" } })).map((d) => [d.eventId, d.status]);
    assert.deepEqual(states, [["evt_g1", "gone"], ["evt_g2", "held"]]);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "webhook.disabled" } });
    assert.match(entry.target ?? "", /gone/);
    assert.equal(entry.actorName, "System");
    // Einschalten holt Zurückgestelltes nach (hier ist das Ziel weiter 410 → wieder aus)
    assert.equal(await deliver.hasDueDeliveries(), false);
  });

  it("Parallele Zustellung ist idempotent: dieselbe Zustellung wird von genau einem Läufer gesendet; Fan-out legt je Ziel und Ereignis nur eine an", async () => {
    await setup();
    assert.equal(await deliver.fanOutEvent(event("evt_p")), 1);
    assert.equal(await deliver.fanOutEvent(event("evt_p")), 0, "dasselbe Ereignis (Wiederholung der Outbox) legt nichts doppelt an");
    assert.equal(await env.db.webhookDelivery.count(), 1);
    const id = (await env.db.webhookDelivery.findFirstOrThrow()).id;
    const results = await Promise.all(Array.from({ length: 6 }, () => deliver.attemptDelivery(id)));
    assert.equal(results.filter((r) => r === "sent").length, 1);
    assert.equal(results.filter((r) => r === "skipped").length, 5);
    assert.equal(server.requests.length, 1);
    // auch zwei gleichzeitige Jobläufe
    await deliver.fanOutEvent(event("evt_p2"));
    const runs = await Promise.all([deliver.deliverDue({}), deliver.deliverDue({})]);
    assert.equal(runs.reduce((sum, s) => sum + s.sent, 0), 1);
    assert.equal(server.requests.length, 2);
  });

  it("ein Läufer, der mitten im Versuch abstürzt, blockiert nicht für immer: nach der Frist übernimmt ein anderer", async () => {
    await setup();
    await deliver.fanOutEvent(event("evt_lease"));
    const id = (await env.db.webhookDelivery.findFirstOrThrow()).id;
    // übernommen, aber nie abgeschlossen (Absturz)
    await env.db.webhookDelivery.update({ where: { id }, data: { attempts: 1, nextAttemptAt: new Date(Date.now() + 120_000) } });
    assert.equal((await deliver.deliverDue({})).sent, 0);
    assert.equal((await deliver.deliverDue({ now: new Date(Date.now() + 121_000) })).sent, 1);
    assert.equal((await env.db.webhookDelivery.findUniqueOrThrow({ where: { id } })).attempts, 2);
  });

  it("ausgeschaltete Ziele: Ereignisse werden zurückgestellt, beim Einschalten nachgeholt; älter als 14 Tage verfallen; Ereignisse außerhalb des Katalogs erreichen nie ein Ziel", async () => {
    const { row } = await setup({}, { enabled: false });
    await deliver.fanOutEvent(event("evt_h1"));
    assert.equal((await env.db.webhookDelivery.findFirstOrThrow()).status, "held");
    assert.equal(await deliver.hasDueDeliveries(), false);
    await deliver.fanOutEvent(event("evt_h2"));
    await env.db.webhookDelivery.updateMany({ where: { eventId: "evt_h1" }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });
    const on = await ops.setWebhookEnabledOperation.execute(admin, { id: row.id, enabled: true });
    assert.ok(on.ok);
    assert.deepEqual((await env.db.webhookDelivery.findMany()).map((d) => [d.eventId, d.status]), [["evt_h2", "pending"]], "das ältere ist verworfen");
    assert.equal((await deliver.deliverDue({})).sent, 1);
    // nicht abonnierte und nicht im Katalog stehende Ereignisse
    assert.equal(await deliver.fanOutEvent(event("evt_x", "order.created")), 0);
    for (const type of ["mail.send", "user.create", "time.entry", "employee.absence", "unbekannt"]) assert.equal(await deliver.fanOutEvent(event(`evt_${type}`, type)), 0, type);
    // Ausschalten stellt Wartendes wieder zurück
    await deliver.fanOutEvent(event("evt_h3"));
    await ops.setWebhookEnabledOperation.execute(admin, { id: row.id, enabled: false });
    assert.equal((await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "evt_h3" } })).status, "held");
    // zu viele zurückgestellte: darüber hinaus verfallen neue
    await env.db.webhookDelivery.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ webhookId: row.id, eventId: `bulk_${i}`, type: "order.closed", eventAt: new Date(), status: "held" })) });
    assert.equal(await deliver.fanOutEvent(event("evt_over")), 0);
  });

  it("Outbox-Abnehmer legt Zustellungen an – nur für Ereignisse des Katalogs, nie für mail.send; Aufräumen löscht Protokoll nach 30 und Zurückgestelltes nach 14 Tagen", async () => {
    const { row } = await setup();
    const { writeOutboxEvent } = await import("@/server/outbox");
    const { deliverOutbox } = await import("@/server/jobs/outbox");
    const active = await (await import("@/modules/features")).getActiveFeatureIds();
    await writeOutboxEvent(env.db, { type: "order.closed", entityId: "order_77", payload: { number: "A-1", kunde: "GEHEIM" } });
    await writeOutboxEvent(env.db, { type: "mail.send", entityId: "mail_1", payload: { mailId: "mail_1" } });
    const summary = await deliverOutbox({ handlers: jobs.outboxHandlers, activeFeatures: active });
    assert.equal(summary.delivered, 1);
    const rows = await env.db.webhookDelivery.findMany();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].type, rows[0].entityId], ["order.closed", "order_77"]);
    await deliver.deliverDue({});
    assert.ok(!server.requests[0].body.includes("GEHEIM") && !server.requests[0].body.includes("A-1"), "Nutzdaten des Ereignisses gehen nie hinaus");

    const old = (days: number) => new Date(Date.now() - days * 86_400_000);
    await env.db.webhookDelivery.createMany({
      data: [
        { webhookId: row.id, eventId: "o1", type: "order.closed", eventAt: old(40), status: "sent", completedAt: old(31) },
        { webhookId: row.id, eventId: "o2", type: "order.closed", eventAt: old(40), status: "failed", completedAt: old(29) },
        { webhookId: row.id, eventId: "o3", type: "order.closed", eventAt: old(20), status: "held", createdAt: old(15) },
        { webhookId: row.id, eventId: "o4", type: "order.closed", eventAt: old(5), status: "held", createdAt: old(5) },
      ],
    });
    assert.equal(await deliver.pruneWebhookDeliveries(), 2);
    assert.deepEqual((await env.db.webhookDelivery.findMany({ where: { eventId: { startsWith: "o" } }, orderBy: { eventId: "asc" } })).map((d) => d.eventId), ["o2", "o4"]);
  });

  it("Katalog: Ereignisse nur aus freigegebenen Funktionen; jede Ressource existiert in der API; jede Beschriftung ist vorhanden; keine sensiblen Bereiche", async () => {
    const { WEBHOOK_EVENTS } = await import("@/modules/catalog");
    const { apiResourceRoots } = await import("@/server/api/doc");
    const { de } = await import("@/i18n/messages/de");
    const { en } = await import("@/i18n/messages/en");
    const { isPlatformFeature } = await import("@/lib/api/scope");
    const roots = apiResourceRoots();
    assert.ok(WEBHOOK_EVENTS.length >= 10);
    const label = (messages: unknown, type: string) => type.split(".").reduce<unknown>((cur, part) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined), (messages as { api: { webhooks: { events: unknown } } }).api.webhooks.events);
    for (const e of WEBHOOK_EVENTS) {
      assert.ok(roots.has(e.resource), `${e.type}: Ressource /${e.resource} gibt es nicht`);
      assert.ok(!isPlatformFeature(e.feature), `${e.type}: Plattform/Verwaltung meldet nichts`);
      assert.ok(!/^(employee|time|user|role|setting|backup|update|audit|vault|tresor|absence|api)/.test(e.type), `${e.type}: sensibler Bereich`);
      assert.equal(typeof label(de, e.type), "string", `${e.type}: Beschriftung (de)`);
      assert.equal(typeof label(en, e.type), "string", `${e.type}: Beschriftung (en)`);
    }
    assert.equal(new Set(WEBHOOK_EVENTS.map((e) => e.type)).size, WEBHOOK_EVENTS.length, "Typen sind eindeutig");
    // jedes Ereignis des Katalogs wird irgendwo wirklich ausgelöst (`emit("<typ>"`)
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : /operations\.ts$/.test(n) ? [path.join(dir, n)] : []));
    const emitted = walk(path.resolve(process.cwd(), "src/modules")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const e of WEBHOOK_EVENTS) assert.ok(emitted.includes(`emit("${e.type}"`), `${e.type} wird nirgends ausgelöst`);
  });

  describe("Operationen der Verwaltung", () => {
    const save = (input: Record<string, unknown>, who = admin) => ops.saveWebhookOperation.execute(who, { name: "Buchhaltung", url: "https://hook.example.org/x?token=GEHEIM", events: ["billing.paid"], ...input });

    it("Anlegen: ausgeschaltet, Geheimnis einmalig im Ergebnis (verschlüsselt gespeichert), Audit mit Name und Host – nie Geheimnis oder Parameter der Adresse", async () => {
      const created = await save({});
      assert.ok(created.ok);
      assert.ok(created.ok && created.data.secret?.startsWith("whsec_"));
      const secret = created.ok ? created.data.secret! : "";
      const row = await env.db.webhook.findUniqueOrThrow({ where: { id: created.ok ? created.data.id : "" } });
      assert.equal(row.enabled, false);
      assert.equal(row.events, "billing.paid");
      assert.equal(await secrets.hasWebhookSecret(row.id), true);
      const stored = await env.db.appSetting.findUniqueOrThrow({ where: { key: `webhook.secret.${row.id}` } });
      assert.notEqual(stored.value, secret);
      assert.ok(!stored.value.includes(secret));
      const dump = JSON.stringify([await env.db.auditLog.findMany(), await env.db.outboxEvent.findMany()]);
      assert.ok(!dump.includes(secret), "das Geheimnis steht nirgends im Klartext");
      assert.ok(!JSON.stringify(await env.db.webhook.findMany()).includes(secret));
      assert.ok(!dump.includes("GEHEIM"), "Parameter der Adresse stehen nicht im Audit-Log");
      const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "webhook.create" } });
      assert.equal(entry.target, "Buchhaltung → hook.example.org");
    });

    it("prüft Adresse (https, gesperrte Ziele), Ereignisse aus dem Katalog, Pflichtangaben und die Obergrenze von 20 Zielen", async () => {
      offsiteNetwork.allowLoopback = false;
      try {
        for (const [url, key] of [
          ["http://hook.example.org/", "api.webhooks.errors.url.plainNeedsPrivate"],
          ["https://127.0.0.1/x", "api.webhooks.errors.url.forbiddenHost"],
          ["https://169.254.169.254/x", "api.webhooks.errors.url.forbiddenHost"],
          ["https://10.0.0.5/x", "api.webhooks.errors.url.privateNeedsApproval"],
          ["https://u:p@hook.example.org/", "api.webhooks.errors.url.credentials"],
          ["ftp://hook.example.org/", "api.webhooks.errors.url.scheme"],
        ] as const) {
          const denied = await save({ url });
          assert.ok(!denied.ok, url);
          assert.equal(!denied.ok && denied.failure.fields?.url.key, key, url);
        }
        assert.ok((await save({ url: "https://10.0.0.5/x", allowPrivate: true })).ok, "private Adresse mit Freigabe");
        assert.ok(!(await save({ url: "https://127.0.0.1/x", allowPrivate: true })).ok, "Loopback nie");
      } finally {
        offsiteNetwork.allowLoopback = true;
      }
      for (const events of [[], ["mail.send"], ["billing.paid", "unbekannt"]]) assert.ok(!(await save({ events })).ok, JSON.stringify(events));
      assert.ok(!(await save({ name: "" })).ok);
      await env.db.webhook.deleteMany();
      for (let i = 0; i < 20; i++) assert.ok((await save({ name: `W${i}` })).ok);
      const over = await save({ name: "Zu viel" });
      assert.ok(!over.ok && over.failure.code === "invalid");
      assert.equal(await env.db.webhook.count(), 20);
    });

    it("Ändern mit Version (Konflikt statt Überschreiben); Einschalten erst mit Geheimnis; nur Administration (api.manage), nie ein Token", async () => {
      const created = await save({});
      assert.ok(created.ok);
      const id = created.ok ? created.data.id : "";
      const row = await env.db.webhook.findUniqueOrThrow({ where: { id } });
      const version = String(row.updatedAt.getTime());
      const changed = await save({ id, version, name: "Neu", enabled: true });
      assert.ok(changed.ok);
      assert.equal((await env.db.webhook.findUniqueOrThrow({ where: { id } })).enabled, true);
      const stale = await save({ id, version, name: "Alt" });
      assert.ok(!stale.ok && stale.failure.code === "conflict");
      assert.equal((await env.db.webhook.findUniqueOrThrow({ where: { id } })).name, "Neu");
      // ohne Geheimnis kein Einschalten
      await secrets.removeWebhookSecrets(id);
      await ops.setWebhookEnabledOperation.execute(admin, { id, enabled: false });
      const noSecret = await ops.setWebhookEnabledOperation.execute(admin, { id, enabled: true });
      assert.ok(!noSecret.ok && noSecret.failure.code === "conflict");

      const plain = await sessionOfUser(["customers.view"]);
      for (const outcome of [await save({}, plain), await ops.setWebhookEnabledOperation.execute(plain, { id, enabled: false }), await ops.deleteWebhookOperation.execute(plain, { id }), await ops.rotateWebhookSecretOperation.execute(plain, { id }), await ops.testWebhookOperation.execute(plain, { id }), await ops.redeliverOperation.execute(plain, { id: "x" })]) {
        assert.ok(!outcome.ok && outcome.failure.code === "forbidden");
      }
      // Token als Principal: nie (ein API-Principal trägt kein adminOnly-Recht)
      await import("@/server/api/auth");
      const { makeToken, apiRequest } = await import("@/test/api-helpers");
      const { token } = await makeToken(env, { admin: true, scope: ["customers.view"] });
      const auth = await (await import("@/server/operations")).getApiAuthenticator()(apiRequest("GET", "/customers", { token }));
      assert.ok(auth.ok);
      if (auth.ok) {
        const viaToken = await save({}, auth.principal);
        assert.ok(!viaToken.ok && viaToken.failure.code === "forbidden");
        assert.ok(!(await ops.deleteWebhookOperation.execute(auth.principal, { id })).ok);
      }
      assert.equal(await env.db.webhook.count({ where: { id } }), 1);
    });

    async function sessionOfUser(permissions: string[]) {
      const { getSession } = await import("@/server/auth/session");
      const user = await env.user({ username: `u-${Math.random()}`, password: PASSWORD, roles: [await env.role({ permissions })] });
      env.browser.reset();
      await env.signIn({ id: user.id });
      return (await getSession())!;
    }

    it("Neues Geheimnis: Klartext einmalig, das bisherige signiert 24 Stunden mit; Löschen entfernt Ziel, Geheimnisse und Protokoll", async () => {
      const created = await save({});
      assert.ok(created.ok);
      const id = created.ok ? created.data.id : "";
      const first = created.ok ? created.data.secret! : "";
      const rotated = await ops.rotateWebhookSecretOperation.execute(admin, { id });
      assert.ok(rotated.ok);
      const second = rotated.ok ? rotated.data.secret : "";
      assert.notEqual(second, first);
      assert.equal(rotated.ok && rotated.data.overlapHours, 24);
      const hook = await env.db.webhook.findUniqueOrThrow({ where: { id } });
      assert.ok(hook.previousSecretUntil && Math.abs(hook.previousSecretUntil.getTime() - (Date.now() + 24 * 3_600_000)) < 60_000);
      assert.deepEqual(await secrets.signingSecrets(id, hook.previousSecretUntil, new Date()), [second, first]);
      assert.deepEqual(await secrets.signingSecrets(id, hook.previousSecretUntil, new Date(Date.now() + 25 * 3_600_000)), [second]);
      const dump = JSON.stringify([await env.db.auditLog.findMany(), await env.db.appSetting.findMany()]);
      assert.ok(!dump.includes(first) && !dump.includes(second));

      await env.db.webhookDelivery.create({ data: { webhookId: id, eventId: "e1", type: "billing.paid", eventAt: new Date() } });
      assert.ok((await ops.deleteWebhookOperation.execute(admin, { id })).ok);
      assert.equal(await env.db.webhook.count(), 0);
      assert.equal(await env.db.webhookDelivery.count(), 0);
      assert.equal(await env.db.appSetting.count({ where: { key: { startsWith: "webhook." } } }), 0);
      assert.equal(await env.db.auditLog.count({ where: { action: { in: ["webhook.create", "webhook.secret", "webhook.delete"] } } }), 3);
    });

    it("Test-Ereignis: ein Versuch (auch bei ausgeschaltetem Ziel), Ergebnis im Protokoll, keine Wiederholung; höchstens 5 je Minute; Fehler nennen nur den Code", async () => {
      const { row } = await setup({ respond: (_r, i) => ({ status: i === 1 ? 500 : 204, body: "GEHEIMER ANTWORTTEXT" }) }, { enabled: false });
      const ok = await ops.testWebhookOperation.execute(admin, { id: row.id });
      assert.ok(ok.ok && ok.data.outcome === "sent" && ok.data.status === 204);
      assert.equal(server.requests[0].headers["x-webhook-event"], "webhook.test");
      assert.equal(JSON.parse(server.requests[0].body).entity, null);
      const failed = await ops.testWebhookOperation.execute(admin, { id: row.id });
      assert.ok(failed.ok && failed.data.outcome === "failed" && failed.data.status === 500);
      const rows = await env.db.webhookDelivery.findMany({ orderBy: { createdAt: "asc" } });
      assert.deepEqual(rows.map((r) => [r.type, r.status, r.attempts]), [["webhook.test", "sent", 1], ["webhook.test", "failed", 1]]);
      assert.ok(!JSON.stringify(rows).includes("GEHEIMER ANTWORTTEXT"));
      assert.equal(await deliver.hasDueDeliveries(), false, "ein Test wird nie wiederholt");
      for (let i = 0; i < 3; i++) assert.ok((await ops.testWebhookOperation.execute(admin, { id: row.id })).ok);
      const limited = await ops.testWebhookOperation.execute(admin, { id: row.id });
      assert.ok(!limited.ok && limited.failure.code === "busy");
      const redeliver = await ops.redeliverOperation.execute(admin, { id: rows[1].id });
      assert.ok(!redeliver.ok);
      assert.equal(await env.db.auditLog.count({ where: { action: "webhook.test" } }), 5);

      // Ziel nicht erreichbar → Fehlercode statt Text
      await env.db.webhook.update({ where: { id: row.id }, data: { url: "https://127.0.0.1:1/x" } });
      await env.db.webhookDelivery.deleteMany();
      const down = await ops.testWebhookOperation.execute(admin, { id: row.id });
      assert.ok(down.ok && down.data.outcome === "failed" && down.data.error === "connect" && down.data.status === null);
    });
  });

  it("Geheimnis-Verbraucher: nach einem Restore ohne Schlüssel sind die Geheimnisse unlesbar – sie werden entfernt, das Ziel wird ausgeschaltet (Audit)", async () => {
    const { resetUnreadableSecrets, allSecretConsumers } = await import("@/server/secret-reset");
    const { row } = await setup();
    const { row: other } = await (async () => {
      const r = await env.db.webhook.create({ data: { name: "Zweites", url: "https://b.example.org/x", events: "order.closed", enabled: true } });
      await secrets.issueWebhookSecret(r.id);
      return { row: r };
    })();
    // das Geheimnis des ersten stammt von einem anderen Schlüssel (nicht entschlüsselbar), das zweite ist in Ordnung
    await env.db.appSetting.update({ where: { key: `webhook.secret.${row.id}` }, data: { value: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA" } });
    assert.ok(allSecretConsumers().some((c) => c.id === "webhooks.secret"));
    const items = await resetUnreadableSecrets(allSecretConsumers().filter((c) => c.id === "webhooks.secret"), { force: true });
    assert.deepEqual(items.map((i) => i.id), ["webhooks.secret"]);
    const first = await env.db.webhook.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([first.enabled, first.disabledReason], [false, "secret"]);
    assert.equal(await env.db.appSetting.count({ where: { key: `webhook.secret.${row.id}` } }), 0);
    const second = await env.db.webhook.findUniqueOrThrow({ where: { id: other.id } });
    assert.equal(second.enabled, true, "ein lesbares Geheimnis bleibt");
    assert.equal(await secrets.hasWebhookSecret(other.id), true);
    assert.ok((await env.db.auditLog.findFirst({ where: { action: "webhook.disabled" } }))?.target?.includes("secret"));
  });

  it("ohne Geheimnis wird nichts gesendet (Fehlercode „secret“)", async () => {
    const { row } = await setup();
    await secrets.removeWebhookSecrets(row.id);
    await deliver.fanOutEvent(event("evt_nosecret"));
    await deliver.deliverDue({});
    assert.equal(server.requests.length, 0);
    const delivery = await env.db.webhookDelivery.findFirstOrThrow();
    assert.deepEqual([delivery.status, delivery.lastError], ["pending", "secret"]);
  });
});
