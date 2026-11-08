import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { startFakeSmtp, type FakeSmtp, type FakeSmtpOptions } from "@/test/fake-smtp";

/**
 * E-Mail-Versand gegen einen echten (kleinen) SMTP-Server im Test: Einstellungen und ihre Regeln, Zielsperre, TLS-Standard, CRLF-Schutz, Limits, Outbox, Wiederholung und Aufgabe, Verbindungstest,
 * Test-Mail, Geheimnis. Echte Verbindungen laufen über die Schleife des eigenen Rechners (im Betrieb gesperrt; `allowLoopbackForTests` gilt nur in Tests und zählt dort als „privates Netz“).
 */
let env: TestEnv;
let fake: FakeSmtp | null = null;
type Mods = {
  hostPolicy: typeof import("@/lib/offsite/host-policy");
  session: typeof import("@/server/auth/session");
  ops: typeof import("@/modules/admin/mail/operations");
  settings: typeof import("./settings");
  queue: typeof import("./queue");
  deliver: typeof import("./deliver");
  transport: typeof import("./transport");
  outbox: typeof import("@/server/outbox");
  jobs: typeof import("@/modules/admin/mail/jobs");
  files: typeof import("@/server/files");
  errors: typeof import("@/server/operations/errors");
  deliverOutbox: typeof import("@/server/jobs/outbox");
  secrets: typeof import("@/modules/admin/mail/secrets");
  settingsApi: typeof import("@/server/settings");
};
let m: Mods;

before(async () => {
  env = await createTestEnv();
  m = {
    hostPolicy: await import("@/lib/offsite/host-policy"),
    session: await import("@/server/auth/session"),
    ops: await import("@/modules/admin/mail/operations"),
    settings: await import("./settings"),
    queue: await import("./queue"),
    deliver: await import("./deliver"),
    transport: await import("./transport"),
    outbox: await import("@/server/outbox"),
    jobs: await import("@/modules/admin/mail/jobs"),
    files: await import("@/server/files"),
    errors: await import("@/server/operations/errors"),
    deliverOutbox: await import("@/server/jobs/outbox"),
    secrets: await import("@/modules/admin/mail/secrets"),
    settingsApi: await import("@/server/settings"),
  };
});
after(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  m.hostPolicy.offsiteNetwork.allowLoopback = false;
  m.transport.setMailTestHooks({});
  await env.db.mailMessage.deleteMany();
  await env.db.outboxEvent.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.appSetting.deleteMany({ where: { key: { startsWith: "mail." } } });
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
});
afterEach(async () => {
  await fake?.close();
  fake = null;
});

let counter = 0;
async function signInAs(permissions: string[], options: { isAdmin?: boolean; email?: string | null } = {}) {
  const role = await env.role({ permissions, isAdmin: options.isAdmin });
  const user = await env.user({ username: `u${++counter}`, name: `Benutzer ${counter}`, roles: [role] });
  if (options.email !== null) await env.db.user.update({ where: { id: user.id }, data: { email: options.email ?? `u${counter}@werkstatt.example` } });
  await env.signIn(user);
  const session = await m.session.getSession();
  assert.ok(session);
  return session;
}
const admin = () => signInAs([], { isAdmin: true });

const baseSettings = (extra: Record<string, unknown> = {}) => ({
  enabled: true,
  host: "smtp.example.org",
  port: 587,
  security: "starttls",
  user: "",
  fromAddress: "werkstatt@example.org",
  fromName: "Werkstatt Müller",
  replyTo: "",
  allowPrivate: false,
  plainConfirmed: false,
  limitHour: 60,
  limitDay: 300,
  limitUserHour: 20,
  limitUserDay: 100,
  ...extra,
});

/** Einstellungen über die Operation speichern (mit allen Regeln); gibt das Ergebnis zurück. */
async function save(session: Awaited<ReturnType<typeof admin>>, extra: Record<string, unknown> = {}) {
  return m.ops.saveSettings.execute(session, baseSettings(extra));
}

/** Einstellungen für den Versand an den Fake-Server setzen (Schleife, unverschlüsselt/mit Anmeldung je nach Fall). */
async function configureFor(server: FakeSmtp, extra: Partial<import("./settings").MailSettings> = {}, password: string | null = null) {
  m.hostPolicy.allowLoopbackForTests();
  await m.settings.saveMailSettings(
    { ...m.settings.DEFAULT_MAIL_SETTINGS, enabled: true, host: server.host, port: server.port, security: "none", allowPrivate: true, plainConfirmed: true, fromAddress: "werkstatt@example.org", fromName: "Werkstatt Müller", ...extra },
    env.db,
  );
  if (password !== null) await m.settings.setMailPassword(password, env.db);
}

async function queue(session: Awaited<ReturnType<typeof admin>>, mail: Partial<import("./queue").QueueMailInput> = {}) {
  const input = { to: ["kunde@example.com"], subject: "Ihre Rechnung", text: "Guten Tag,\nanbei die Rechnung.", ...mail };
  return env.db.$transaction((tx) =>
    m.queue.queueMail(
      {
        tx,
        principal: session,
        emit: async (type, payload, entityId) => {
          await m.outbox.writeOutboxEvent(tx, { type, payload, entityId: entityId ?? null, actorId: session.user.id });
        },
      },
      input,
    ),
  );
}

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof m.errors.OperationError) return error.failure;
    throw error;
  }
  assert.fail("Fehler erwartet");
};

const headersOf = (data: string) => data.split("\r\n\r\n")[0];

/* ================================================================= Einstellungen */

describe("Einstellungen speichern", () => {
  it("Administratoren speichern gültige Einstellungen; der Versand gilt danach als eingerichtet; das Audit nennt Ziel, nie das Passwort", async () => {
    const session = await admin();
    assert.equal(await m.settings.mailConfigured(), false);
    const result = await save(session, { user: "konto", password: "geheim-4711" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(await m.settings.mailConfigured(), true);
    const stored = await m.settings.getMailSettings();
    assert.deepEqual([stored.host, stored.port, stored.security, stored.fromAddress, stored.user, stored.limits.userHour], ["smtp.example.org", 587, "starttls", "werkstatt@example.org", "konto", 20]);
    const audit = await env.db.auditLog.findMany();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "mail.settings");
    assert.match(audit[0].target ?? "", /smtp\.example\.org:587 · starttls · an/);
    assert.ok(!JSON.stringify(audit).includes("geheim-4711"));
  });

  it("ohne das Recht mail.manage geht nichts (auch nicht mit mail.send); ausgeschaltet oder unvollständig gilt der Versand als nicht eingerichtet", async () => {
    const sender = await signInAs(["mail.send"]);
    const denied = await save(sender);
    assert.equal(denied.ok, false);
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
    const session = await admin();
    await save(session, { enabled: false });
    assert.equal(await m.settings.mailConfigured(), false);
    await save(session, { enabled: true });
    assert.equal(await m.settings.mailConfigured(), true);
  });

  it("Zielsperre beim Speichern: der eigene Rechner, Verbindungs-lokal, Metadaten-Dienste und Namen wie localhost sind nie erlaubt", async () => {
    const session = await admin();
    for (const host of ["localhost", "127.0.0.1", "[::1]", "169.254.169.254", "metadata.google.internal", "0.0.0.0", "2852039166", "0xa9fea9fe", "::ffff:169.254.169.254", "fe80::1"]) {
      const result = await save(session, { host });
      assert.equal(result.ok, false, host);
      assert.ok(!result.ok && result.failure.fields?.host, `${host}: Feldfehler am Server erwartet`);
    }
    assert.equal(await m.settings.mailConfigured(), false);
  });

  it("eine private Adresse braucht die ausdrückliche Freigabe; mit ihr geht sie, öffentliche Adressen nie ohne Freigabe nötig", async () => {
    const session = await admin();
    const without = await save(session, { host: "192.168.1.25" });
    assert.ok(!without.ok && without.failure.fields?.host);
    const allowed = await save(session, { host: "192.168.1.25", allowPrivate: true });
    assert.equal(allowed.ok, true);
    assert.equal((await save(session, { host: "93.184.216.34" })).ok, true);
    assert.equal((await save(session, { host: "mail.example.org" })).ok, true);
  });

  it("Klartext nur mit Freigabe für das eigene Netz UND ausdrücklicher Bestätigung; die Bestätigung gilt nur für „none“", async () => {
    const session = await admin();
    const noPrivate = await save(session, { security: "none", plainConfirmed: true });
    assert.ok(!noPrivate.ok && noPrivate.failure.fields?.security);
    const noConfirm = await save(session, { security: "none", allowPrivate: true, host: "10.0.0.5" });
    assert.ok(!noConfirm.ok && noConfirm.failure.fields?.plainConfirmed);
    assert.equal((await save(session, { security: "none", allowPrivate: true, host: "10.0.0.5", plainConfirmed: true })).ok, true);
    assert.equal((await m.settings.getMailSettings()).plainConfirmed, true);
    await save(session, { security: "starttls", plainConfirmed: true });
    assert.equal((await m.settings.getMailSettings()).plainConfirmed, false, "bei Verschlüsselung wird die Klartext-Bestätigung nicht aufbewahrt");
  });

  it("Einschalten braucht Server und gültige Absenderadresse; Absender- und Antwortadresse werden geprüft und normalisiert", async () => {
    const session = await admin();
    const incomplete = await save(session, { host: "", enabled: true });
    assert.ok(!incomplete.ok && incomplete.failure.fields?.enabled);
    const badFrom = await save(session, { fromAddress: "keine adresse" });
    assert.ok(!badFrom.ok && badFrom.failure.fields?.fromAddress);
    const injected = await save(session, { replyTo: "a@b.de\r\nBcc: x@y.de" });
    assert.ok(!injected.ok && injected.failure.fields?.replyTo);
    await save(session, { fromAddress: "Info@Werkstatt.DE", replyTo: "Antwort@Werkstatt.DE" });
    const stored = await m.settings.getMailSettings();
    assert.deepEqual([stored.fromAddress, stored.replyTo], ["Info@werkstatt.de", "Antwort@werkstatt.de"]);
  });

  it("Passwort: verschlüsselt gespeichert (nie im Klartext in der Datenbank), bleibt bei leerem Feld, muss bei anderem Ziel neu eingegeben werden, lässt sich entfernen", async () => {
    const session = await admin();
    const missing = await save(session, { user: "konto" });
    assert.ok(!missing.ok && missing.failure.fields?.password, "ein Benutzername braucht ein Passwort");
    assert.equal((await save(session, { user: "konto", password: "streng-geheim-77" })).ok, true);
    const row = await env.db.appSetting.findUnique({ where: { key: "mail.password" } });
    assert.ok(row && /^v1:/.test(row.value) && !row.value.includes("streng-geheim-77"));
    const everything = JSON.stringify([await env.db.appSetting.findMany(), await env.db.auditLog.findMany()]);
    assert.ok(!everything.includes("streng-geheim-77"), "das Passwort steht in keiner Tabelle im Klartext");
    assert.equal(await m.settingsApi.getSecret("mail.password"), "streng-geheim-77");
    // leer lassen = behalten (Ziel unverändert)
    assert.equal((await save(session, { user: "konto", fromName: "Neu" })).ok, true);
    assert.equal(await m.settingsApi.getSecret("mail.password"), "streng-geheim-77");
    // anderes Ziel ohne neues Passwort: abgelehnt, das alte geht nie an einen anderen Server
    const moved = await save(session, { user: "konto", host: "smtp.anderer-anbieter.example" });
    assert.ok(!moved.ok && moved.failure.fields?.password);
    assert.equal(await m.settingsApi.getSecret("mail.password"), "streng-geheim-77");
    // Benutzer entfernen räumt das Passwort weg
    assert.equal((await save(session, { user: "" })).ok, true);
    assert.equal(await m.settingsApi.hasSecret("mail.password"), false);
  });
});

/* ================================================================= Zielauflösung und Verbindungsoptionen */

describe("Zielauflösung (Rebinding) und Verbindungsoptionen", () => {
  const answer = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("jede Antwort der Namensauflösung wird geprüft: eine verbotene oder (ohne Freigabe) private Adresse unter mehreren sperrt das Ziel", async () => {
    const { resolveMailTarget, MailError } = m.transport;
    const code = async (promise: Promise<unknown>) => (await promise.then(() => "ok", (e: unknown) => (e instanceof MailError ? e.code : "anders")));
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: false }, answer("93.184.216.34", "169.254.169.254"))), "forbiddenHost");
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: false }, answer("93.184.216.34", "10.0.0.1"))), "forbiddenHost");
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: true }, answer("93.184.216.34", "10.0.0.1"))), "ok");
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: true }, answer("93.184.216.34", "169.254.169.254"))), "forbiddenHost", "Metadaten sind auch mit Freigabe gesperrt");
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: true }, answer("127.0.0.1"))), "forbiddenHost", "Loopback im Betrieb nie");
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: false }, answer())), "dns");
    assert.equal(await code(resolveMailTarget("mail.example.org", { allowPrivate: false }, async () => Promise.reject(new Error("ENOTFOUND")))), "dns");
    assert.equal(await code(resolveMailTarget("localhost", { allowPrivate: true }, answer("93.184.216.34"))), "forbiddenHost");
    assert.equal(await code(resolveMailTarget("metadata.google.internal", { allowPrivate: true }, answer("93.184.216.34"))), "forbiddenHost");
  });

  it("das Host-Gateway des Containers (der Docker-Host) bleibt auch mit der Freigabe gesperrt – als Literal, als Name und als Antwort eines Namens", async () => {
    const { resolveMailTarget, MailError } = m.transport;
    const gateway = await import("@/server/host-gateway");
    const code = async (promise: Promise<unknown>) => (await promise.then(() => "ok", (e: unknown) => (e instanceof MailError ? e.code : "anders")));
    gateway.setGatewayTestHooks({ gateways: ["172.17.0.1"] });
    try {
      assert.equal(await code(resolveMailTarget("172.17.0.1", { allowPrivate: true })), "forbiddenHost");
      assert.equal(await code(resolveMailTarget("host.docker.internal", { allowPrivate: true }, answer("172.17.0.1"))), "forbiddenHost");
      assert.equal(await code(resolveMailTarget("relay.example.org", { allowPrivate: true }, answer("172.17.0.1"))), "forbiddenHost");
      assert.equal(await code(resolveMailTarget("relay.example.org", { allowPrivate: true }, answer("172.17.0.2"))), "ok", "Nachbarn im selben Netz bleiben mit Freigabe erlaubt");
    } finally {
      gateway.setGatewayTestHooks({});
    }
  });

  it("verbunden wird mit der geprüften Adresse; der Name dient nur der Prüfung des Zertifikats", async () => {
    const pin = await m.transport.resolveMailTarget("Mail.Example.ORG.", { allowPrivate: false }, answer("93.184.216.34"));
    assert.deepEqual([pin.address, pin.family, pin.private, pin.servername], ["93.184.216.34", 4, false, "mail.example.org"]);
    const options = m.transport.transportOptions({ host: "mail.example.org", port: 587, security: "starttls", user: "u", password: "p", allowPrivate: false, plainConfirmed: false }, pin, "example.org");
    assert.equal(options.host, "93.184.216.34", "nodemailer bekommt die IP, nie den Namen");
    assert.equal((options.tls as { servername?: string }).servername, "mail.example.org");
    const literal = await m.transport.resolveMailTarget("93.184.216.34", { allowPrivate: false });
    assert.equal(literal.servername, null);
  });

  it("TLS ist Standard: STARTTLS erzwingt Verschlüsselung (kein Zurückfallen), SMTPS ist sofort verschlüsselt, Zertifikatsprüfung und TLS 1.2 gelten immer", () => {
    const pin = { address: "93.184.216.34", family: 4 as const, private: false, servername: "mail.example.org" };
    const conn = { host: "mail.example.org", port: 587, user: "", password: null, allowPrivate: false, plainConfirmed: false };
    const starttls = m.transport.transportOptions({ ...conn, security: "starttls" }, pin, "example.org");
    assert.deepEqual([starttls.secure, starttls.requireTLS, starttls.ignoreTLS], [false, true, false]);
    const smtps = m.transport.transportOptions({ ...conn, port: 465, security: "smtps" }, pin, "example.org");
    assert.deepEqual([smtps.secure, smtps.requireTLS, smtps.ignoreTLS], [true, false, false]);
    for (const options of [starttls, smtps]) {
      const tls = options.tls as { rejectUnauthorized: boolean; minVersion: string };
      assert.equal(tls.rejectUnauthorized, true);
      assert.equal(tls.minVersion, "TLSv1.2");
      assert.equal(options.disableFileAccess, true);
      assert.equal(options.disableUrlAccess, true);
      assert.equal(options.auth, undefined, "ohne Benutzer keine Anmeldung");
    }
  });

  it("Klartext (none) nur mit Bestätigung, Freigabe UND privatem Ziel – gegen eine öffentliche Adresse wird nie unverschlüsselt verbunden", () => {
    const pub = { address: "93.184.216.34", family: 4 as const, private: false, servername: null };
    const priv = { address: "10.0.0.5", family: 4 as const, private: true, servername: null };
    const conn = { host: "x", port: 25, security: "none" as const, user: "", password: null, allowPrivate: true, plainConfirmed: true };
    assert.throws(() => m.transport.transportOptions(conn, pub, "x.de"), (e: unknown) => e instanceof m.transport.MailError && e.code === "config");
    assert.throws(() => m.transport.transportOptions({ ...conn, plainConfirmed: false }, priv, "x.de"), /config/);
    assert.throws(() => m.transport.transportOptions({ ...conn, allowPrivate: false }, priv, "x.de"), /config/);
    const ok = m.transport.transportOptions(conn, priv, "x.de");
    assert.equal(ok.ignoreTLS, true);
  });
});

/* ================================================================= Vormerken (queueMail) */

describe("Nachricht vormerken", () => {
  it("braucht das Recht mail.send (in keiner Standardrolle), einen eingerichteten Versand und gültige Eingaben", async () => {
    const adminSession = await admin();
    assert.equal((await failureOf(queue(adminSession))).key, "mail.errors.notConfigured");
    await save(adminSession);
    const plain = await signInAs(["mail.manage"]);
    assert.equal((await failureOf(queue(plain))).code, "forbidden", "mail.manage allein erlaubt kein Senden");
    assert.equal((await failureOf(queue(adminSession, { to: [] }))).key, "mail.errors.noRecipient");
    assert.equal((await failureOf(queue(adminSession, { to: ["kaputt"] }))).key, "mail.errors.badRecipient");
    assert.equal((await failureOf(queue(adminSession, { to: Array.from({ length: 11 }, (_, i) => `a${i}@b.de`) }))).key, "mail.errors.tooManyRecipients");
    assert.equal((await failureOf(queue(adminSession, { subject: " \r\n " }))).key, "mail.errors.noSubject");
    assert.equal((await failureOf(queue(adminSession, { text: "   " }))).key, "mail.errors.badBody");
    assert.equal(await env.db.mailMessage.count(), 0, "nichts vorgemerkt");
    assert.equal(await env.db.outboxEvent.count(), 0);
  });

  it("legt Zeile, Ereignis und Audit-Eintrag in einer Transaktion an; die Outbox trägt nur die ID, das Audit den Empfänger", async () => {
    const session = await admin();
    await save(session);
    await env.db.auditLog.deleteMany();
    const { id } = await queue(session, { to: ["Kunde@Example.COM", "zweite@example.com"], subject: "Rechnung RE-2026-0001", purpose: "invoice", entityId: "inv1" });
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.toAddresses, row.subject, row.purpose, row.entityId, row.userId], ["queued", "Kunde@example.com, zweite@example.com", "Rechnung RE-2026-0001", "invoice", "inv1", session.user.id]);
    const events = await env.db.outboxEvent.findMany();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "mail.send");
    assert.deepEqual(JSON.parse(events[0].payload), { mailId: id });
    assert.ok(!events[0].payload.includes("example.com") && !events[0].payload.includes("Rechnung"), "Empfänger und Betreff stehen nicht in der Outbox");
    const audit = await env.db.auditLog.findMany();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "mail.send");
    assert.match(audit[0].target ?? "", /Kunde@example\.com, zweite@example\.com – Rechnung RE-2026-0001/);
  });

  it("Zeilenumbrüche in Betreff und Empfängern werden nicht zu zusätzlichen Kopfzeilen (CRLF-Schutz bei Betreff, Anzeigename und Dateinamen)", async () => {
    const session = await admin();
    await save(session, { fromName: 'Werkstatt "X"\r\nBcc: boese@evil.example' });
    const { id } = await queue(session, { subject: "Hallo\r\nBcc: boese@evil.example\r\nX-Evil: 1" });
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.ok(!/[\r\n]/.test(row.subject), "der Betreff ist einzeilig");
    const bad = await failureOf(queue(session, { to: ["opfer@example.com\r\nBcc: boese@evil.example"] }));
    assert.equal(bad.key, "mail.errors.badRecipient");
    assert.ok(!JSON.stringify(bad).includes("\n"), "auch die Fehlermeldung trägt keine Zeilenumbrüche");
  });

  it("Versandlimits: je Benutzer und gesamt, je Stunde und Tag; Fehlgeschlagenes zählt mit; die Meldung nennt das Limit", async () => {
    const session = await admin();
    await save(session, { limitUserHour: 2, limitUserDay: 5, limitHour: 3, limitDay: 10 });
    await queue(session);
    await queue(session);
    assert.equal((await failureOf(queue(session))).key, "mail.errors.limitUserHour");
    // eine andere Person ist vom Benutzer-Limit der ersten nicht betroffen, wohl aber vom Gesamtlimit
    const other = await signInAs(["mail.send"]);
    await queue(other);
    assert.equal((await failureOf(queue(other))).key, "mail.errors.limitHour");
    // 0 schaltet ein Limit aus
    await save(session, { limitUserHour: 0, limitUserDay: 0, limitHour: 0, limitDay: 0 });
    await queue(session);
    // ältere Nachrichten fallen aus dem Fenster
    await env.db.mailMessage.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    await save(session, { limitUserHour: 1, limitUserDay: 100, limitHour: 100, limitDay: 100 });
    await queue(session);
  });

  it("Anhänge: nur vorhandene Dateien unter files/ (relative Pfade), höchstens 5, nie Pfade außerhalb", async () => {
    const session = await admin();
    await save(session);
    const stored = await m.files.storeFile("rechnungen/2026", "RE-1.pdf", Buffer.from("%PDF-1.4 test"));
    const ok = await queue(session, { attachments: [{ path: stored, filename: "Rechnung RE-1.pdf", contentType: "application/pdf" }] });
    assert.ok((await env.db.mailMessage.findUniqueOrThrow({ where: { id: ok.id } })).attachments?.startsWith(`${stored}|`));
    for (const path of ["../../etc/passwd", "/etc/passwd", "C:/Windows/win.ini", "rechnungen/gibt-es-nicht.pdf", "a/../../b.pdf"]) {
      const failure = await failureOf(queue(session, { attachments: [{ path, filename: "x.pdf", contentType: "application/pdf" }] }));
      assert.ok(failure.key === "mail.errors.attachmentMissing", `${path}: ${failure.key}`);
    }
    const many = Array.from({ length: 6 }, () => ({ path: stored, filename: "x.pdf", contentType: "application/pdf" }));
    assert.equal((await failureOf(queue(session, { attachments: many }))).key, "mail.errors.tooManyAttachments");
  });
});

/* ================================================================= Zustellung gegen den Fake-Server */

describe("Zustellung", () => {
  const start = async (options: FakeSmtpOptions = {}) => (fake = await startFakeSmtp(options));

  it("Ablauf: vormerken → Outbox → Abnehmer mail.send → Nachricht kommt an (Absender, Empfänger, Betreff, Text, Anhang); Zeile „gesendet“, Inhalt gelöscht", async () => {
    const server = await start({ auth: { user: "konto", pass: "pw-123" } });
    await configureFor(server, { user: "konto" }, "pw-123");
    const session = await admin();
    const stored = await m.files.storeFile("rechnungen/2026", "RE-1.pdf", Buffer.from("%PDF-1.4 inhalt"));
    const { id } = await queue(session, { to: ["kunde@example.com", "zweite@example.com"], subject: "Rechnung RE-2026-0001 für Müller", text: "Guten Tag,\nanbei die Rechnung. Grüße", attachments: [{ path: stored, filename: "Rechnung RE-2026-0001.pdf", contentType: "application/pdf" }] });

    const summary = await m.deliverOutbox.deliverOutbox({ handlers: m.jobs.outboxHandlers, activeFeatures: new Set(["admin.mail"]) });
    assert.equal(summary.delivered, 1, JSON.stringify(summary));
    assert.equal(server.messages.length, 1);
    const [received] = server.messages;
    assert.equal(received.from, "werkstatt@example.org");
    assert.deepEqual(received.to, ["kunde@example.com", "zweite@example.com"]);
    const head = headersOf(received.data);
    assert.match(head, /^From: .*<werkstatt@example\.org>/m);
    assert.match(head, /^To: .*kunde@example\.com/m);
    assert.match(head, new RegExp(`^Message-ID: <${id}@example\\.org>`, "m"));
    assert.match(received.data, /Subject: =\?UTF-8\?/, "Umlaute im Betreff sind kodiert");
    assert.match(received.data, /filename="Rechnung RE-2026-0001\.pdf"/);
    assert.match(Buffer.from(received.data.split("\r\n\r\n").slice(1).join("\r\n\r\n"), "utf8").toString("utf8"), /Content-Type: application\/pdf/);
    assert.deepEqual(server.commands.filter((c) => /^(AUTH|STARTTLS)/.test(c)), ["AUTH …"]);

    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.attempts, row.errorCode, row.body, row.attachments], ["sent", 1, null, null, null]);
    assert.ok(row.sentAt);
    assert.equal((await env.db.outboxEvent.findFirstOrThrow()).failedAt, null);
  });

  it("Zeilenumbruch im Betreff oder im Absendernamen schleust bei der Zustellung nichts ein: keine zusätzliche Kopfzeile, kein weiterer Empfänger", async () => {
    const server = await start();
    await configureFor(server, { fromName: 'Werkstatt\r\nBcc: boese@evil.example' });
    const session = await admin();
    await queue(session, { subject: "Rechnung\r\nBcc: boese@evil.example" });
    await m.deliver.deliverQueuedMail((await env.db.mailMessage.findFirstOrThrow()).id, { attempt: 1 });
    const [received] = server.messages;
    assert.deepEqual(received.to, ["kunde@example.com"]);
    const lines = headersOf(received.data).split("\r\n");
    assert.ok(!lines.some((l) => /^Bcc:/i.test(l) || /^X-Evil/i.test(l)), "keine eingeschleuste Kopfzeile");
  });

  it("Wiederholung: ein vorübergehender Fehler (4xx) bleibt „wartet“ und wirft; nach dem letzten Versuch ist die Nachricht „fehlgeschlagen“ (Audit), das Ereignis aufgegeben", async () => {
    let refuse = true;
    const server = await start({ rejectRcpt: () => (refuse ? "451 4.7.1 greylisted, try later" : null) });
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session);
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "rejected");
    let row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.attempts, row.errorCode], ["queued", 1, "rejected"]);
    assert.equal(row.body !== null, true, "der Inhalt bleibt für die Wiederholung");
    refuse = false;
    // beim nächsten Versuch geht es durch
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 2 }), "sent");
    row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.attempts, row.errorCode], ["sent", 2, null]);

    // Aufgabe nach dem letzten Versuch
    refuse = true;
    const second = await queue(session);
    await assert.rejects(m.deliver.deliverQueuedMail(second.id, { attempt: m.queue.MAIL_MAX_ATTEMPTS }));
    const given = await env.db.mailMessage.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(given.status, "failed");
    const audit = await env.db.auditLog.findMany({ where: { action: "mail.sendFailed" } });
    assert.equal(audit.length, 1);
    assert.match(audit[0].target ?? "", /\(rejected\)/);
    // aufgegebene Nachricht wird nicht noch einmal versucht
    assert.equal(await m.deliver.deliverQueuedMail(second.id, { attempt: 1 }), "skipped");
  });

  it("endgültige Absage des Empfängers (550): sofort „fehlgeschlagen“, keine Wiederholung, der Abnehmer meldet „zugestellt“ (das Protokoll sagt es), Audit", async () => {
    const server = await start({ rejectRcpt: () => "550 5.1.1 user unknown" });
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session);
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 1 }), "failed");
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.errorCode], ["failed", "recipient"]);
    assert.equal((await env.db.auditLog.findMany({ where: { action: "mail.sendFailed" } })).length, 1);
    // über die Outbox: das Ereignis gilt als zugestellt (keine endlose Wiederholung)
    const again = await queue(session);
    const summary = await m.deliverOutbox.deliverOutbox({ handlers: m.jobs.outboxHandlers, activeFeatures: new Set(["admin.mail"]) });
    assert.equal(summary.failed + summary.retried, 0, JSON.stringify(summary));
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id: again.id } })).status, "failed");
  });

  it("falsches Passwort: Code „auth“, wird wiederholt (der Fehler liegt in der Einrichtung); die Zugangsdaten stehen in keiner Meldung, keinem Protokoll und keinem Audit", async () => {
    const server = await start({ auth: { user: "konto", pass: "richtig" } });
    await configureFor(server, { user: "konto" }, "falsch-geheim");
    const session = await admin();
    const { id } = await queue(session);
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "auth" && !e.message.includes("falsch-geheim"));
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.errorCode], ["queued", "auth"]);
    assert.equal(server.messages.length, 0);
    assert.ok(!JSON.stringify([await env.db.mailMessage.findMany(), await env.db.auditLog.findMany(), await env.db.outboxEvent.findMany()]).includes("falsch-geheim"));
  });

  it("Server nicht erreichbar: Code „connect“, wird wiederholt", async () => {
    const server = await start();
    await configureFor(server);
    await server.close();
    fake = null;
    const session = await admin();
    const { id } = await queue(session);
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "connect");
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id } })).errorCode, "connect");
  });

  it("nicht eingerichtet (oder ausgeschaltet) zum Zeitpunkt der Zustellung: Code „config“, wird wiederholt, bis jemand den Versand einrichtet", async () => {
    const server = await start();
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session);
    await m.settingsApi.setSetting("mail.enabled", "false");
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "config");
    await m.settingsApi.setSetting("mail.enabled", "true");
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 2 }), "sent");
  });

  it("die Zielsperre gilt auch bei der Zustellung (Einstellungen vor einer Änderung der Regeln oder von Hand in der Datenbank): Loopback im Betrieb – es wird nie verbunden", async () => {
    const server = await start();
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session);
    m.hostPolicy.offsiteNetwork.allowLoopback = false; // „Betrieb“: Loopback gesperrt
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "forbiddenHost");
    assert.equal(server.connections, 0, "keine Verbindung");
  });

  it("STARTTLS: mit vertrauenswürdigem Zertifikat wird verschlüsselt gesendet; ohne Vertrauen scheitert es mit „tls“ – und es gehen weder Anmeldedaten noch Nachricht hinaus", async () => {
    const server = await start({ startTls: true, auth: { user: "konto", pass: "pw" } });
    await configureFor(server, { security: "starttls" }, null);
    await m.settings.saveMailSettings({ ...(await m.settings.getMailSettings()), user: "konto", security: "starttls", plainConfirmed: false }, env.db);
    await m.settings.setMailPassword("pw", env.db);
    const session = await admin();
    const first = await queue(session);
    // Standard: selbst signiertes Zertifikat wird abgelehnt
    await assert.rejects(m.deliver.deliverQueuedMail(first.id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "tls");
    assert.equal(server.messages.length, 0);
    assert.ok(!server.commands.some((c) => c === "AUTH …" || c.startsWith("MAIL FROM")), `Befehle: ${server.commands.join(" | ")}`);
    // mit der Zertifizierungsstelle (nur Tests) klappt es – verschlüsselt
    m.transport.setMailTestHooks({ tls: { ca: server.cert } });
    assert.equal(await m.deliver.deliverQueuedMail(first.id, { attempt: 2 }), "sent");
    assert.equal(server.tlsConnections >= 1, true);
    assert.deepEqual(server.commands.filter((c) => c === "STARTTLS" || c === "AUTH …").slice(-2), ["STARTTLS", "AUTH …"], "erst STARTTLS, dann die Anmeldung");
  });

  it("STARTTLS verlangt, der Server bietet es nicht an: kein Rückfall auf Klartext – Fehler „tls“, nichts wird gesendet", async () => {
    const server = await start({ startTls: false });
    await configureFor(server, { security: "starttls", plainConfirmed: false });
    const session = await admin();
    const { id } = await queue(session);
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "tls");
    assert.equal(server.messages.length, 0);
    assert.ok(!server.commands.some((c) => c.startsWith("MAIL FROM") || c === "AUTH …"), `Befehle: ${server.commands.join(" | ")}`);
  });

  it("SMTPS: ohne Vertrauen in das Zertifikat „tls“, mit der Zertifizierungsstelle (nur Tests) kommt die Nachricht an", async () => {
    const server = await start({ implicitTls: true });
    await configureFor(server, { security: "smtps", plainConfirmed: false });
    const session = await admin();
    const { id } = await queue(session);
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "tls");
    assert.equal(server.messages.length, 0);
    m.transport.setMailTestHooks({ tls: { ca: server.cert } });
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 2 }), "sent");
    assert.equal(server.messages.length, 1);
  });

  it("zweimal zugestellt (Absturz zwischen Senden und Vermerken) sendet nicht noch einmal, wenn die Zeile schon „gesendet“ ist", async () => {
    const server = await start();
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session);
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 1 }), "sent");
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 2 }), "skipped");
    assert.equal(server.messages.length, 1);
    assert.equal(await m.deliver.deliverQueuedMail("gibt-es-nicht", { attempt: 1 }), "skipped");
  });

  it("ist die Funktion ausgeschaltet, bleibt das Ereignis geparkt (kein Versand), und wird nachgeholt, sobald sie wieder an ist", async () => {
    const server = await start();
    await configureFor(server);
    const session = await admin();
    await queue(session);
    const off = await m.deliverOutbox.deliverOutbox({ handlers: m.jobs.outboxHandlers, activeFeatures: new Set() });
    assert.equal(off.parked, 1);
    assert.equal(server.messages.length, 0);
    const later = new Date(Date.now() + 20 * 60_000);
    const on = await m.deliverOutbox.deliverOutbox({ handlers: m.jobs.outboxHandlers, activeFeatures: new Set(["admin.mail"]), now: later });
    assert.equal(on.delivered, 1);
    assert.equal(server.messages.length, 1);
  });

  it("Erneut senden: eine aufgegebene Nachricht mit Inhalt wird wieder vorgemerkt; sonst abgelehnt; nur mit mail.manage", async () => {
    const server = await start({ rejectRcpt: () => "550 5.1.1 unknown" });
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session);
    await m.deliver.deliverQueuedMail(id, { attempt: 1 });
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id } })).status, "failed");
    const plain = await signInAs(["mail.send"]);
    const denied = await m.ops.resendMail.execute(plain, { id });
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
    const adminAgain = await admin();
    const sent = await m.ops.resendMail.execute(adminAgain, { id });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.attempts, row.errorCode], ["queued", 0, null]);
    assert.equal((await env.db.outboxEvent.count({ where: { type: "mail.send", processedAt: null } })) >= 1, true);
    const twice = await m.ops.resendMail.execute(adminAgain, { id });
    assert.equal(!twice.ok && twice.failure.key, "mail.errors.notFailed", "nur Aufgegebenes lässt sich erneut senden");
    await env.db.mailMessage.update({ where: { id }, data: { status: "failed", body: null } });
    assert.equal((await m.ops.resendMail.execute(adminAgain, { id })).ok, false, "ohne Inhalt nicht");
  });
});

describe("Zustellung: teilweise Annahme, Abbruch, Anhänge", () => {
  const start = async (options: FakeSmtpOptions = {}) => (fake = await startFakeSmtp(options));
  const MANY = ["a@example.com", "b@example.com", "c@example.com"];

  it("vorübergehende Absage (451) nur eines Empfängers: die anderen haben die Nachricht, die Wiederholung geht nur an den offenen – nie doppelt", async () => {
    let greylist = true;
    const server = await start({ rejectRcpt: (address) => (address === "b@example.com" && greylist ? "451 4.7.1 greylisted" : null) });
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session, { to: MANY });
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "rejected" && !e.permanent);
    let row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.errorCode, row.deliveredTo], ["queued", "rejected", "a@example.com, c@example.com"]);
    assert.ok(row.body !== null, "der Inhalt bleibt für die Wiederholung");
    assert.equal(server.messages.length, 1);
    assert.deepEqual(server.messages[0].to, ["a@example.com", "c@example.com"]);

    greylist = false;
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 2 }), "sent");
    assert.equal(server.messages.length, 2);
    assert.deepEqual(server.messages[1].to, ["b@example.com"], "nur der noch offene Empfänger");
    row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.errorCode, row.body, row.deliveredTo], ["sent", null, null, "a@example.com, c@example.com, b@example.com"]);
  });

  it("endgültige Absage (550) eines Empfängers: „fehlgeschlagen“ mit den Angenommenen im Protokoll; „Erneut senden“ geht nur an die nicht Zugestellten", async () => {
    let reject = true;
    const server = await start({ rejectRcpt: (address) => (address === "b@example.com" && reject ? "550 5.1.1 unknown" : null) });
    await configureFor(server);
    const session = await admin();
    const { id } = await queue(session, { to: MANY });
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 1 }), "failed");
    let row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.errorCode, row.deliveredTo], ["failed", "recipient", "a@example.com, c@example.com"]);
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "mail.sendFailed" } })).target ?? "", /\(recipient, 2\/3\)/);

    reject = false;
    const resent = await m.ops.resendMail.execute(await admin(), { id });
    assert.equal(resent.ok, true, JSON.stringify(resent));
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 1 }), "sent");
    assert.equal(server.messages.length, 2);
    assert.deepEqual(server.messages[1].to, ["b@example.com"], "die schon Zugestellten bekommen die Nachricht nicht noch einmal");
    row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, "sent");
  });

  it("nach dem letzten Versuch bleibt eine vorübergehende Teilabsage „fehlgeschlagen“ (mit den Angenommenen)", async () => {
    const server = await start({ rejectRcpt: (address) => (address === "b@example.com" ? "451 4.7.1 later" : null) });
    await configureFor(server);
    const { id } = await queue(await admin(), { to: MANY });
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: m.queue.MAIL_MAX_ATTEMPTS }), "failed");
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.errorCode, row.deliveredTo], ["failed", "rejected", "a@example.com, c@example.com"]);
  });

  it("hängender Server: das Abbruchsignal zerstört die Verbindung, der Versand endet mit „timeout“ und die Zeile bleibt „wartet“", async () => {
    const server = await start({ hangData: true });
    await configureFor(server);
    const { id } = await queue(await admin());
    const controller = new AbortController();
    const started = Date.now();
    const run = m.deliver.deliverQueuedMail(id, { attempt: 1, signal: controller.signal });
    const settled = run.then(
      () => null,
      (error: unknown) => error,
    );
    for (let i = 0; i < 100 && server.messages.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(server.messages.length, 1, "die Daten sind beim Server, eine Antwort kommt nie");

    // ein zweiter Versuch (Wiederholung der Outbox) sendet nicht daneben
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 2 }), (e: unknown) => e instanceof m.transport.MailError && e.code === "timeout");
    assert.equal(server.connections, 1, "kein zweiter Versand, solange der erste läuft");

    controller.abort();
    const error = await settled;
    assert.ok(error instanceof m.transport.MailError && error.code === "timeout" && !error.permanent, String(error));
    assert.ok(Date.now() - started < 10_000, "der Abbruch wartet nicht auf das Leerlauf-Zeitlimit von 30 Sekunden");
    for (let i = 0; i < 100 && server.closedConnections === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(server.closedConnections, 1, "die Verbindung ist geschlossen");
    const row = await env.db.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.attempts, row.errorCode], ["queued", 1, "timeout"]);
    // danach ist der Weg für die Wiederholung frei
    assert.equal(server.connections, 1);
  });

  it("schon abgebrochen: es wird gar nicht erst verbunden", async () => {
    const server = await start();
    await configureFor(server);
    const { id } = await queue(await admin());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(m.deliver.deliverQueuedMail(id, { attempt: 1, signal: controller.signal }), (e: unknown) => e instanceof m.transport.MailError && e.code === "timeout");
    assert.equal(server.connections, 0);
  });

  it("Anhang mit Parametern im Inhaltstyp: wird normalisiert und mitgesendet; ein unbrauchbarer Typ wird beim Vormerken abgelehnt", async () => {
    const server = await start();
    await configureFor(server);
    const session = await admin();
    const stored = await m.files.storeFile("rechnungen/2026", "RE-2.pdf", Buffer.from("%PDF-1.4 inhalt"));
    const bad = await failureOf(queue(session, { attachments: [{ path: stored, filename: "x.pdf", contentType: "kein typ" }] }));
    assert.equal(bad.key, "mail.errors.attachmentInvalid");
    assert.equal(await env.db.mailMessage.count(), 0);
    const { id } = await queue(session, { attachments: [{ path: stored, filename: "RE.pdf", contentType: "Application/PDF; charset=binary" }] });
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id } })).attachments?.endsWith("|application/pdf"), true);
    assert.equal(await m.deliver.deliverQueuedMail(id, { attempt: 1 }), "sent");
    assert.match(server.messages[0].data, /name=RE\.pdf/);
  });

  it("eine gespeicherte Anhangzeile, die nicht gelesen werden kann, lässt die Nachricht scheitern – nie ohne Anhang als „gesendet“", async () => {
    const server = await start();
    await configureFor(server);
    const session = await admin();
    const row = await env.db.mailMessage.create({ data: { userId: session.user.id, userName: "x", toAddresses: "kunde@example.com", subject: "s", body: "Text", attachments: "rechnungen/2026/a.pdf|a.pdf|ohne typ" } });
    assert.equal(await m.deliver.deliverQueuedMail(row.id, { attempt: 1 }), "failed");
    assert.equal(server.messages.length, 0);
    assert.deepEqual((await env.db.mailMessage.findUniqueOrThrow({ where: { id: row.id } })).status, "failed");
  });

  it("Schlüssel nicht lesbar: eigener Code „keyUnavailable“, endgültig", async () => {
    const { SecretKeyUnavailableError } = await import("@/server/secrets");
    const failure = m.deliver.asMailError(new SecretKeyUnavailableError("unreadable"));
    assert.deepEqual([failure.code, failure.permanent], ["keyUnavailable", true]);
  });

  it("Aufräumen löscht den Inhalt wartender Nachrichten nicht (sonst ginge später ein leerer Text hinaus)", async () => {
    const session = await admin();
    const old = new Date(Date.now() - 40 * 86_400_000);
    const waiting = await env.db.mailMessage.create({ data: { userId: session.user.id, userName: "x", toAddresses: "a@b.de", subject: "s", status: "queued", body: "Inhalt", createdAt: old } });
    await m.deliver.pruneMail();
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id: waiting.id } })).body, "Inhalt");
  });
});

/* ================================================================= Verbindungstest und Test-Mail */

describe("Verbindungstest und Test-Mail", () => {
  it("der Verbindungstest meldet sich an, sendet aber nichts; Fehler nennen den Grund als Code-Text ohne Geheimnisse", async () => {
    const server = (fake = await startFakeSmtp({ auth: { user: "konto", pass: "pw" } }));
    await configureFor(server, { user: "konto" }, "pw");
    const session = await admin();
    const ok = await m.ops.testConnection.execute(session, {});
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.ok(server.commands.includes("AUTH …"));
    assert.ok(!server.commands.some((c) => c.startsWith("MAIL FROM") || c === "DATA"), "es wird nichts gesendet");
    assert.equal(server.messages.length, 0);
    assert.equal(await env.db.mailMessage.count(), 0, "der Test hinterlässt keinen Protokolleintrag");
    assert.equal((await env.db.auditLog.findMany({ where: { action: "mail.test" } })).length, 1);

    await m.settings.setMailPassword("falsches-pw-999", env.db);
    const bad = await m.ops.testConnection.execute(session, {});
    assert.ok(!bad.ok);
    assert.equal(!bad.ok && bad.failure.key, "mail.errors.code.auth");
    assert.ok(!JSON.stringify(bad).includes("falsches-pw-999"));
    const denied = await m.ops.testConnection.execute(await signInAs(["mail.send"]), {});
    assert.equal(!denied.ok && denied.failure.code, "forbidden");
  });

  it("Test-Mail geht nur an die eigene Adresse des Kontos (es gibt kein Eingabefeld dafür), steht ohne Inhalt im Protokoll und im Audit", async () => {
    const server = (fake = await startFakeSmtp());
    await configureFor(server);
    const session = await signInAs([], { isAdmin: true, email: "Ich@Werkstatt.example" });
    const result = await m.ops.sendTest.execute(session, { to: "fremder@evil.example", recipient: "fremder@evil.example" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(server.messages.length, 1);
    assert.deepEqual(server.messages[0].to, ["Ich@werkstatt.example"]);
    const row = await env.db.mailMessage.findFirstOrThrow();
    assert.deepEqual([row.status, row.purpose, row.body, row.userId], ["sent", "test", null, session.user.id]);
    const audit = await env.db.auditLog.findMany({ where: { action: "mail.testSend" } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].target, "Ich@werkstatt.example");
  });

  it("ohne eigene Adresse im Konto keine Test-Mail; Fehler beim Senden stehen im Protokoll als „fehlgeschlagen“ mit Code", async () => {
    const server = (fake = await startFakeSmtp({ rejectRcpt: () => "550 5.1.1 nope" }));
    await configureFor(server);
    const noAddress = await signInAs([], { isAdmin: true, email: null });
    const none = await m.ops.sendTest.execute(noAddress, {});
    assert.equal(!none.ok && none.failure.key, "mail.errors.noOwnAddress");
    assert.equal(server.connections, 0);
    const withAddress = await signInAs([], { isAdmin: true });
    const failed = await m.ops.sendTest.execute(withAddress, {});
    assert.equal(!failed.ok && failed.failure.key, "mail.errors.code.recipient");
    const row = await env.db.mailMessage.findFirstOrThrow();
    assert.deepEqual([row.status, row.errorCode], ["failed", "recipient"]);
  });
});

/* ================================================================= Aufräumen und Geheimnis */

describe("Aufräumen und Geheimnis", () => {
  it("Aufräumen: Inhalt aufgegebener Nachrichten nach 30 Tagen weg, Protokolleinträge nach einem Jahr gelöscht, Frisches bleibt", async () => {
    const session = await admin();
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    const make = (createdAt: Date, extra: Record<string, unknown> = {}) =>
      env.db.mailMessage.create({ data: { userId: session.user.id, userName: "x", toAddresses: "a@b.de", subject: "s", status: "failed", body: "Inhalt", attachments: "p|n|application/pdf", createdAt, ...extra } });
    const fresh = await make(days(2));
    const month = await make(days(40));
    const year = await make(days(400));
    const removed = await m.deliver.pruneMail();
    assert.equal(removed, 1);
    assert.equal((await env.db.mailMessage.findUnique({ where: { id: year.id } })), null);
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id: month.id } })).body, null);
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id: fresh.id } })).body, "Inhalt");
  });

  it("nicht lesbares Passwort (Backup ohne passenden Schlüssel): wird entfernt und der Versand ausgeschaltet; lesbares bleibt", async () => {
    const session = await admin();
    await save(session, { user: "konto", password: "pw-1" });
    const [consumer] = m.secrets.secretConsumers;
    assert.equal(consumer.id, "mail.password");
    assert.equal(await consumer.resetUnreadable(), 0);
    assert.equal(await m.settings.mailConfigured(), true);
    // ein fremder Schlüssel: gültige Form, andere Verschlüsselung
    await env.db.appSetting.update({ where: { key: "mail.password" }, data: { value: `v1:${Buffer.alloc(12, 1).toString("base64")}:${Buffer.alloc(16, 2).toString("base64")}:${Buffer.alloc(8, 3).toString("base64")}` } });
    assert.equal(await consumer.resetUnreadable(), 1);
    assert.equal(await m.settingsApi.hasSecret("mail.password"), false);
    assert.equal((await m.settings.getMailSettings()).enabled, false);
    assert.equal(await m.settings.mailConfigured(), false);
  });
});
