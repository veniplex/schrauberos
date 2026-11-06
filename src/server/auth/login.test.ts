import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { browser, createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Anmeldung und Sitzung gegen eine echte Datenbank: Cookie-Namen, Drosselung (auch bei Schwung paralleler Versuche), einheitliche
 * Meldungen, Audit-Hygiene, dauerhafte Zähler, Rücksprungziel. Die Uhr und das Warten sind ersetzt (kein echtes Abwarten).
 */
let env: TestEnv;
let session: typeof import("./session");
let runtimeMod: typeof import("./runtime");
let throttleMod: typeof import("./throttle");
let passwordMod: typeof import("./password");
let loginActions: typeof import("@/app/login/actions");
let accountActions: typeof import("@/platform/account/actions");
let networkMod: typeof import("./network");

let clock = Date.now();
let sleeps: number[] = [];

before(async () => {
  env = await createTestEnv();
  session = await import("./session");
  runtimeMod = await import("./runtime");
  throttleMod = await import("./throttle");
  passwordMod = await import("./password");
  loginActions = await import("@/app/login/actions");
  accountActions = await import("@/platform/account/actions");
  networkMod = await import("./network");
  runtimeMod.authRuntime.now = () => clock;
  runtimeMod.authRuntime.sleep = async (ms) => void sleeps.push(ms);
  runtimeMod.authRuntime.random = () => 0.5;
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.appSetting.deleteMany();
  clock = Date.now();
  sleeps = [];
  browser.reset();
  throttleMod.resetLoginThrottle();
});

const makeUser = async (username = "anna", password = "richtiges-passwort-1", extra: { active?: boolean } = {}) => {
  const user = await env.user({ username, password, ...extra });
  passwordMod.hashStats.computed = 0;
  return user;
};
const attempt = (name: string, pw = "falsches-passwort", ip: string | null = null) => session.login(name, pw, { ip });
const reasonOf = (r: { ok: boolean } & Record<string, unknown>) => (r.ok ? "ok" : (r.reason as string));
const loginForm = (name: string, pw: string, next?: string) => form({ username: name, password: pw, next });

describe("Cookie", () => {
  it("meldet im HTTP-LAN mit Klartext-Cookie an, über HTTPS mit __Host- und Secure", async () => {
    await makeUser();
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
    const plain = browser.writes.find((w) => w.name.endsWith("so_session"))!;
    assert.equal(plain.name, "so_session");
    assert.equal(plain.options.secure, false);
    assert.ok((await session.getSession())?.user.username === "anna");

    browser.reset();
    browser.setHeaders({ "x-forwarded-proto": "https" });
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
    const secure = browser.writes.find((w) => w.name.endsWith("so_session"))!;
    assert.equal(secure.name, "__Host-so_session");
    assert.equal(secure.options.secure, true);
    assert.equal(secure.options.path, "/");
    assert.ok((await session.getSession())?.user.username === "anna");
  });

  it("Abmelden im HTTP-LAN löscht das Klartext-Cookie und die Sitzung", async () => {
    await makeUser();
    await attempt("anna", "richtiges-passwort-1");
    await session.logout();
    assert.equal(browser.cookies.has("so_session"), false);
    assert.equal(browser.cookies.has("so_device"), true, "das Geräte-Cookie bleibt über das Abmelden hinaus bestehen");
    assert.equal(await env.db.session.count(), 0);
  });

  it("Abmelden unter HTTPS löscht __Host-so_session mit Secure, Pfad / und Max-Age=0 – sonst verwirft der Browser das Löschen", async () => {
    await makeUser();
    browser.setHeaders({ "x-forwarded-proto": "https" });
    await attempt("anna", "richtiges-passwort-1");
    assert.ok(browser.cookies.has("__Host-so_session"));
    browser.writes.length = 0;
    await session.logout();
    const clear = browser.writes.find((w) => w.name === "__Host-so_session")!;
    assert.equal(clear.value, "");
    assert.equal(clear.options.secure, true);
    assert.equal(clear.options.path, "/");
    assert.equal(clear.options.maxAge, 0);
    assert.equal(clear.options.httpOnly, true);
    assert.equal(browser.cookies.has("__Host-so_session"), false, "der (nachgebildete) Browser hat das Cookie wirklich entfernt");
    assert.equal(await env.db.session.count(), 0);
    assert.equal(await session.getSession(), null);
  });

  it("Sitzungs-Cookie unter HTTPS: Attribute HttpOnly, Secure, SameSite=Lax, Pfad / (Voraussetzung für __Host-)", async () => {
    await makeUser();
    browser.setHeaders({ "x-forwarded-proto": "https" });
    await attempt("anna", "richtiges-passwort-1");
    const w = browser.writes.find((x) => x.name === "__Host-so_session")!;
    assert.deepEqual({ h: w.options.httpOnly, s: w.options.secure, l: w.options.sameSite, p: w.options.path }, { h: true, s: true, l: "lax", p: "/" });
    assert.ok(w.options.expires && !("domain" in w.options));
  });

  it("unter HTTPS zählt ein untergeschobenes Klartext-Cookie nicht (Cookie Tossing) – umgekehrt im HTTP-LAN auch nicht", async () => {
    await makeUser();
    await attempt("anna", "richtiges-passwort-1");
    const token = browser.cookies.get("so_session")!;
    assert.ok((await session.getSession())?.user.username === "anna");
    // gleiche, gültige Sitzung, aber unter HTTPS nur im Klartext-Cookie: abgelehnt
    browser.setHeaders({ "x-forwarded-proto": "https" });
    assert.equal(await session.getSession(), null);
    // im Cookie mit __Host- ist sie unter HTTPS gültig, im HTTP-LAN dagegen nicht
    browser.cookies.clear();
    browser.cookies.set("__Host-so_session", token);
    assert.ok((await session.getSession())?.user.username === "anna");
    browser.setHeaders({});
    assert.equal(await session.getSession(), null);
  });
});

describe("Drosselung", () => {
  it("Parallel-Burst: von 40 gleichzeitigen falschen Versuchen kommen nur die freien durch, es wird nur so oft gehasht", async () => {
    await makeUser();
    const results = await Promise.all(Array.from({ length: 40 }, () => attempt("anna")));
    assert.equal(results.filter((r) => reasonOf(r) === "invalid").length, 3);
    assert.equal(results.filter((r) => reasonOf(r) === "throttled").length, 37);
    assert.equal(passwordMod.hashStats.computed, 3);
    // auch das richtige Passwort muss jetzt warten – ohne Hash
    assert.equal(reasonOf(await attempt("anna", "richtiges-passwort-1")), "throttled");
    assert.equal(passwordMod.hashStats.computed, 3);
    clock += 2_100;
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
  });

  it("Wartezeit wächst bis zur Obergrenze von höchstens 90 Sekunden und steht in der Meldung", async () => {
    await makeUser();
    const waits: number[] = [];
    for (let round = 0; round < 12; round++) {
      let r = await attempt("anna");
      if (reasonOf(r) === "invalid") {
        r = await attempt("anna"); // sofort wieder: gedrosselt (oder noch frei)
        while (reasonOf(r) === "invalid") r = await attempt("anna");
      }
      assert.equal(reasonOf(r), "throttled");
      const seconds = (r as { retryAfterSeconds: number }).retryAfterSeconds;
      waits.push(seconds);
      clock += seconds * 1000 + 1;
    }
    assert.deepEqual(waits.slice(0, 7), [2, 4, 8, 16, 32, 64, 90]);
    assert.ok(waits.every((w) => w <= 90));
    const state = await loginActions.loginAction({}, loginForm("anna", "falsch-und-wieder"));
    assert.ok(state.error);
  });

  it("gedrosselte Anmeldungen kosten nur einen Timer – kein Hash, 300–700 ms Wartezeit", async () => {
    await makeUser();
    for (let i = 0; i < 3; i++) await attempt("anna");
    const computed = passwordMod.hashStats.computed;
    sleeps = [];
    for (let i = 0; i < 100; i++) assert.equal(reasonOf(await attempt("anna")), "throttled");
    assert.equal(passwordMod.hashStats.computed, computed);
    assert.ok(sleeps.length === 100 && sleeps.every((ms) => ms >= 300 && ms <= 700));
  });

  it("unbekannte Namen verhalten sich genau wie bekannte (kein Existenz-Orakel) – rechnen aber keinen Hash, sondern warten per Timer", async () => {
    await makeUser("anna");
    const script = async (name: string) => {
      const out: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await attempt(name);
        out.push(reasonOf(r) + (r.ok === false && r.reason === "throttled" ? `:${r.retryAfterSeconds}` : ""));
      }
      return out;
    };
    const known = await script("anna");
    assert.equal(passwordMod.hashStats.computed, 3, "bekannte Namen werden gerechnet");
    passwordMod.hashStats.computed = 0;
    sleeps = [];
    const unknown = await script("gespenst");
    assert.deepEqual(unknown, known);
    assert.equal(passwordMod.hashStats.computed, 0, "unbekannte Namen rechnen keinen Hash (sonst ließen sich die Hash-Plätze mit erfundenen Namen belegen)");
    assert.equal(passwordMod.hashSemaphore.active + passwordMod.hashSemaphore.waiting, 0);
    // Stattdessen füllt ein Timer die Antwort auf die typische Hash-Dauer auf
    const typical = passwordMod.hashStats.typicalMs;
    assert.equal(sleeps.filter((ms) => ms >= typical * 0.9 && ms <= typical * 1.2).length, 3, `drei Auffüll-Timer um ${typical} ms: ${sleeps}`);
    // gleiche Meldung für falsches Passwort und unbekannten Namen
    throttleMod.resetLoginThrottle();
    await env.db.user.updateMany({ data: { failedLogins: 0, lockedUntil: null } });
    const a = await loginActions.loginAction({}, loginForm("anna", "falsch-123456"));
    const b = await loginActions.loginAction({}, loginForm("gespenst", "falsch-123456"));
    assert.equal(a.error, b.error);
  });

  it("eine Flut erfundener Namen verdrängt keine laufende Wartezeit: das gedrosselte Konto bleibt gedrosselt (gleiche Antwort wie ein gedrosselter erfundener Name)", async () => {
    await makeUser("admin", "admin-passwort-1");
    for (let i = 0; i < 3; i++) await attempt("admin");
    for (let i = 0; i < 3; i++) await attempt("ghost-throttled");
    const known = await attempt("admin", "admin-passwort-1");
    const unknown = await attempt("ghost-throttled", "admin-passwort-1");
    assert.equal(reasonOf(known), "throttled");
    assert.deepEqual(known, unknown, "bekanntes gedrosseltes Konto und gedrosselter erfundener Name geben dieselbe Antwort");
    for (let i = 0; i < 5_300; i++) await attempt(`flut-${i}`);
    assert.equal(reasonOf(await attempt("admin", "admin-passwort-1")), "throttled", "die Flut hat die Wartezeit nicht aus dem Speicher gedrängt");
    assert.equal(reasonOf(await attempt("ghost-throttled")), "throttled");
    assert.ok(throttleMod.loginThrottle.accounts.size <= 10_000);
  });

  it("Dauerbeschuss des Kontos verlängert die Wartezeit nicht: danach kommt der Administrator nach höchstens 90 s durch", async () => {
    await makeUser("admin", "admin-passwort-1");
    const attacker: string[] = [];
    // 10 Minuten lang alle 250 ms ein falscher Versuch
    for (let t = 0; t < 600_000; t += 250) {
      clock += 250;
      attacker.push(reasonOf(await attempt("admin", "geraten-123456")));
    }
    assert.ok(attacker.filter((r) => r === "invalid").length < 30, "nur wenige Versuche kommen zur Passwortprüfung");
    assert.ok(passwordMod.hashStats.computed < 30);
    const remaining = throttleMod.loginThrottle.accounts.check("admin");
    assert.ok(remaining <= 90_000, `Wartezeit ${remaining} ms`);
    clock += remaining + 1;
    assert.equal((await attempt("admin", "admin-passwort-1")).ok, true);
  });

  it("die dauerhaften Zähler überstehen einen Neustart (Speicher leer, Datenbank gedrosselt) – ohne Hash", async () => {
    await makeUser();
    for (let i = 0; i < 3; i++) await attempt("anna");
    assert.equal((await env.db.user.findFirstOrThrow()).failedLogins, 3);
    throttleMod.resetLoginThrottle(); // wie nach einem Neustart
    const computed = passwordMod.hashStats.computed;
    assert.equal(reasonOf(await attempt("anna", "richtiges-passwort-1")), "throttled");
    assert.equal(passwordMod.hashStats.computed, computed);
    clock += 2_100;
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
    assert.equal((await env.db.user.findFirstOrThrow()).failedLogins, 0);
  });

  it("Administration hebt die Wartezeit auf", async () => {
    const user = await makeUser();
    for (let i = 0; i < 3; i++) await attempt("anna");
    assert.equal(reasonOf(await attempt("anna", "richtiges-passwort-1")), "throttled");
    await session.resetAccountThrottle(user.id);
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
  });

  it("das globale Fehlversuchs-Budget verlangsamt nur – ein richtiges Passwort wird immer angenommen", async () => {
    await makeUser();
    for (let i = 0; i < 60; i++) await attempt(`ratename-${i}`);
    sleeps = [];
    const result = await attempt("anna", "richtiges-passwort-1");
    assert.equal(result.ok, true);
    assert.ok(sleeps.some((ms) => ms > 0 && ms <= 3_000), `Verzögerung erwartet: ${sleeps}`);
  });

  it("inaktive Konten werden erst nach richtigem Passwort als solche gemeldet", async () => {
    await makeUser("anna", "richtiges-passwort-1", { active: false });
    assert.equal(reasonOf(await attempt("anna", "falsch")), "invalid");
    assert.equal(reasonOf(await attempt("anna", "richtiges-passwort-1")), "inactive");
  });
});

describe("Bekanntes Gerät: Dauerbeschuss sperrt den Besitzer nicht aus", () => {
  const ADMIN_PW = "admin-passwort-1";
  /** Meldet an, merkt sich das Geräte-Cookie und gibt es zurück (so, wie es der Browser des Administrators hätte). */
  const knownDevice = async (name = "admin", pw = ADMIN_PW) => {
    assert.equal((await attempt(name, pw)).ok, true);
    const token = browser.cookies.get("so_device");
    assert.ok(token, "nach der Anmeldung gibt es ein Geräte-Cookie");
    browser.reset(); // der Angreifer hat dieses Cookie nicht
    throttleMod.resetLoginThrottle();
    return token;
  };
  const withDevice = (name: string, pw: string, deviceToken: string | undefined, ip: string | null = null) => session.login(name, pw, { ip, deviceToken });

  it("setzt nach der Anmeldung ein langes, zufälliges Cookie (HttpOnly, SameSite=Lax, 180 Tage); in der Datenbank steht nur sein Hash", async () => {
    await makeUser("admin", ADMIN_PW);
    assert.equal((await attempt("admin", ADMIN_PW)).ok, true);
    const w = browser.writes.find((x) => x.name === "so_device")!;
    assert.ok(w.value && w.value.length >= 40);
    assert.deepEqual({ h: w.options.httpOnly, l: w.options.sameSite, p: w.options.path, s: w.options.secure, a: w.options.maxAge }, { h: true, l: "lax", p: "/", s: false, a: 180 * 86_400 });
    const rows = await env.db.knownDevice.findMany();
    assert.equal(rows.length, 1);
    assert.match(rows[0].tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(rows[0]).includes(w.value!), false);
    // eine zweite Anmeldung mit demselben Cookie legt kein weiteres Gerät an
    assert.equal((await withDevice("admin", ADMIN_PW, w.value!)).ok, true);
    assert.equal(await env.db.knownDevice.count(), 1);
  });

  it("unter HTTPS heißt es __Host-so_device (Secure, Pfad /); ein Klartext-Cookie wird dort nicht gelesen", async () => {
    await makeUser("admin", ADMIN_PW);
    browser.setHeaders({ "x-forwarded-proto": "https" });
    await attempt("admin", ADMIN_PW);
    const w = browser.writes.find((x) => x.name === "__Host-so_device")!;
    assert.deepEqual({ s: w.options.secure, p: w.options.path, h: w.options.httpOnly }, { s: true, p: "/", h: true });
    const devices = await import("./devices");
    assert.equal(await devices.readDeviceToken(), w.value);
    browser.cookies.set("so_device", "untergeschoben".padEnd(50, "x"));
    browser.cookies.delete("__Host-so_device");
    assert.equal(await devices.readDeviceToken(), undefined);
  });

  it("der Angreifer schießt ohne Pause weiter, der Administrator kommt mit seinem Gerät jedes Mal durch – auch gleichzeitig mit dem Beschuss", async () => {
    await makeUser("admin", ADMIN_PW);
    const token = await knownDevice();
    const attackerResults: string[] = [];
    let adminOk = 0;
    // 10 Minuten lang alle 250 ms ein falscher Versuch ohne Cookie – dazwischen und gleichzeitig der Administrator
    for (let t = 0, round = 0; t < 600_000; t += 250, round++) {
      clock += 250;
      if (round % 20 === 0) {
        // gleichzeitig: ein Schwung Angriffsversuche und die echte Anmeldung
        const [mine, ...attack] = await Promise.all([withDevice("admin", ADMIN_PW, token), ...Array.from({ length: 10 }, () => attempt("admin", "geraten-123456"))]);
        assert.equal(mine.ok, true, `Administrator mit Gerät muss durchkommen (Runde ${round}): ${JSON.stringify(mine)}`);
        adminOk++;
        attackerResults.push(...attack.map(reasonOf));
      } else {
        attackerResults.push(reasonOf(await attempt("admin", "geraten-123456")));
      }
    }
    assert.ok(adminOk >= 100);
    assert.ok(attackerResults.includes("throttled"), "der Beschuss lief in die Konto-Wartezeit");
    // Kein Vorteil für den Angreifer: Es kommen nur wenige Versuche zur Passwortprüfung
    const reachedCheck = attackerResults.filter((r) => r === "invalid").length;
    assert.ok(reachedCheck < 40, `Versuche bis zur Passwortprüfung: ${reachedCheck}`);
    // Ohne Cookie (neues Gerät) bleibt die Wartezeit bestehen – auch mit dem richtigen Passwort
    for (let i = 0; i < 4; i++) await attempt("admin", "geraten-123456");
    assert.equal(reasonOf(await attempt("admin", ADMIN_PW)), "throttled");
  });

  it("ohne Geräte-Cookie greift die Drosselung weiter: auch das richtige Passwort muss warten, bis zu 90 s", async () => {
    await makeUser("admin", ADMIN_PW);
    for (let i = 0; i < 4; i++) await attempt("admin", "geraten-123456");
    const r = await attempt("admin", ADMIN_PW);
    assert.equal(reasonOf(r), "throttled");
    assert.ok((r as { retryAfterSeconds: number }).retryAfterSeconds <= 90);
    // ein falsches, zufälliges oder abgelaufenes Cookie hilft nicht
    assert.equal(reasonOf(await withDevice("admin", ADMIN_PW, "zufaellig".padEnd(50, "z"))), "throttled");
  });

  it("das Cookie gilt nur für das eigene Konto und nur, solange es in der Datenbank steht", async () => {
    const admin = await makeUser("admin", ADMIN_PW);
    await makeUser("bob", "bobs-passwort-12");
    const adminToken = await knownDevice();
    for (let i = 0; i < 4; i++) await attempt("bob", "geraten-123456");
    // Cookie eines anderen Kontos hebt Bobs Wartezeit nicht auf
    assert.equal(reasonOf(await withDevice("bob", "bobs-passwort-12", adminToken)), "throttled");
    // ... aber das eigene Konto des Cookies kommt durch, selbst wenn es gedrosselt wäre
    for (let i = 0; i < 4; i++) await attempt("admin", "geraten-123456");
    assert.equal((await withDevice("admin", ADMIN_PW, adminToken)).ok, true);
    // Widerruf: Gerät aus der Datenbank -> wieder gedrosselt
    await env.db.knownDevice.deleteMany({ where: { userId: admin.id } });
    assert.equal(reasonOf(await withDevice("admin", ADMIN_PW, adminToken)), "throttled");
  });

  it("Gerät läuft nach 180 Tagen ohne Anmeldung ab", async () => {
    const admin = await makeUser("admin", ADMIN_PW);
    const token = await knownDevice();
    for (let i = 0; i < 4; i++) await attempt("admin", "geraten-123456");
    await env.db.knownDevice.updateMany({ where: { userId: admin.id }, data: { lastUsedAt: new Date(clock - 181 * 86_400_000) } });
    assert.equal(reasonOf(await withDevice("admin", ADMIN_PW, token)), "throttled");
  });

  it("vom bekannten Gerät aus wird das Raten trotzdem gebremst (eigene Drosselung je Gerät) – und es sperrt das Konto für andere nicht", async () => {
    await makeUser("admin", ADMIN_PW);
    const token = await knownDevice();
    const results: string[] = [];
    for (let i = 0; i < 12; i++) results.push(reasonOf(await withDevice("admin", "geraten-123456", token)));
    assert.deepEqual(results.slice(0, 5), ["invalid", "invalid", "invalid", "invalid", "invalid"]);
    assert.ok(results.slice(5).every((r) => r === "throttled"), `ab dem 6. Fehlversuch Wartezeit: ${results}`);
    const row = await env.db.user.findUniqueOrThrow({ where: { username: "admin" } });
    assert.equal(row.failedLogins, 0, "Fehlversuche vom bekannten Gerät zählen nicht gegen das Konto");
    assert.equal(throttleMod.loginThrottle.accounts.attemptsOf("admin"), 0);
    // das Gerät selbst muss warten (auch mit richtigem Passwort), ein anderes Gerät ohne Wartezeit des Kontos nicht
    assert.equal(reasonOf(await withDevice("admin", ADMIN_PW, token)), "throttled");
    assert.equal((await attempt("admin", ADMIN_PW)).ok, true);
  });

  it("die Administration (Passwort ändern, deaktivieren) und der Notzugang vergessen die bekannten Geräte; das eigene Gerät bleibt beim Wechsel im Konto", async () => {
    const admin = await makeUser("admin", ADMIN_PW);
    await knownDevice();
    assert.equal(await env.db.knownDevice.count(), 1);
    const devices = await import("./devices");
    await devices.revokeDevices(admin.id);
    assert.equal(await env.db.knownDevice.count(), 0);
    // Wechsel im Konto: das eigene Gerät behalten, andere vergessen
    await attempt("admin", ADMIN_PW);
    await env.db.knownDevice.create({ data: { tokenHash: "x".repeat(64), userId: admin.id } });
    await devices.revokeDevices(admin.id, true);
    const left = await env.db.knownDevice.findMany();
    assert.equal(left.length, 1);
    assert.notEqual(left[0].tokenHash, "x".repeat(64));
  });

  it("je Konto bleiben höchstens 10 Geräte (die zuletzt benutzten)", async () => {
    const admin = await makeUser("admin", ADMIN_PW);
    for (let i = 0; i < 13; i++) {
      browser.reset();
      clock += 1_000;
      throttleMod.resetLoginThrottle();
      assert.equal((await attempt("admin", ADMIN_PW)).ok, true);
    }
    assert.equal(await env.db.knownDevice.count({ where: { userId: admin.id } }), 10);
  });

  it("Fehlversuche und Anmeldungen ändern die „Version“ des Benutzers nicht (kein Schein-Konflikt im Benutzerformular)", async () => {
    const user = await makeUser("anna");
    const { versionOf } = await import("@/lib/concurrency");
    const before = versionOf(await env.db.user.findUniqueOrThrow({ where: { id: user.id } }));
    for (let i = 0; i < 4; i++) await attempt("anna");
    assert.ok((await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).failedLogins >= 3);
    clock += 100_000;
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(row.lastLoginAt, "letzte Anmeldung wird festgehalten");
    assert.equal(versionOf(row), before);
  });
});

describe("Flut von Anmeldungen: Administrator und Notzugang kommen durch", () => {
  const ADMIN_PW = "admin-passwort-1";

  it("200 parallele Versuche mit erfundenen Namen rechnen keinen Hash und belegen keinen Platz; eine echte Anmeldung läuft gleichzeitig", async () => {
    await makeUser("admin", ADMIN_PW);
    const flood = Array.from({ length: 200 }, (_, i) => attempt(`flut-${i}`, "falsches-passwort-123"));
    const real = attempt("admin", ADMIN_PW);
    const [mine, ...rest] = await Promise.all([real, ...flood]);
    assert.equal(mine.ok, true);
    assert.equal(rest.filter((r) => reasonOf(r) === "busy").length, 0, "keine Anmeldung wird wegen der Flut abgewiesen");
    assert.equal(passwordMod.hashStats.computed, 1, "nur die echte Anmeldung wurde gerechnet");
  });

  it("selbst bei voller Warteschlange der Anmeldungen: Anmeldung vom bekannten Gerät, Passwort setzen und Einlösen des Notzugangs warten nicht darauf", async () => {
    const role = await env.role({ isAdmin: true });
    const admin = await env.user({ username: "admin", password: ADMIN_PW, roles: [role] });
    passwordMod.hashStats.computed = 0;
    await makeUser("anna");
    assert.equal((await attempt("admin", ADMIN_PW)).ok, true);
    const token = browser.cookies.get("so_device")!;
    browser.reset();
    throttleMod.resetLoginThrottle();
    const recovery = await import("./recovery");
    const code = await env.db.$transaction((tx) => recovery.replaceRecoveryCode(tx, admin.id));

    // Die Hash-Plätze der Anmeldungen sind belegt: 2 laufen, 32 warten
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => (release = resolve));
    const blocked = Array.from({ length: 34 }, () => passwordMod.hashSemaphore.run(() => blocker));
    try {
      assert.equal(passwordMod.hashSemaphore.active, 2);
      assert.equal(passwordMod.hashSemaphore.waiting, 32);
      // eine weitere gewöhnliche Anmeldung wird abgewiesen ...
      assert.equal(reasonOf(await attempt("anna", "richtiges-passwort-1")), "busy");
      // ... die vom bekannten Gerät, das Passwort-Setzen und der Notzugang nicht
      assert.equal((await session.login("admin", ADMIN_PW, { deviceToken: token })).ok, true);
      assert.ok((await passwordMod.hashPassword("neues-passwort-123")).startsWith("scrypt$"));
      const result = await recovery.redeemRecoveryCode({ code, password: "notweg-passwort-456", ip: null });
      assert.equal(result.ok, true);
    } finally {
      release();
      await Promise.all(blocked);
    }
  });
});

describe("IP-Limit und Header", () => {
  it("ohne die Einstellung „Hinter Reverse-Proxy“ wird X-Forwarded-For ignoriert", async () => {
    browser.setHeaders({ "x-forwarded-for": "6.6.6.6" });
    assert.equal(await networkMod.currentClientIp(), null);
  });

  it("mit der Einstellung zählt der letzte Eintrag; gefälschte Einträge davor ändern den Eimer nicht", async () => {
    await env.db.appSetting.create({ data: { key: networkMod.BEHIND_PROXY_KEY, value: "true" } });
    browser.setHeaders({ "x-forwarded-for": "1.1.1.1, 7.7.7.7" });
    assert.equal(await networkMod.currentClientIp(), "7.7.7.7");
    browser.setHeaders({ "x-forwarded-for": "9.9.9.9, 7.7.7.7" });
    assert.equal(await networkMod.currentClientIp(), "7.7.7.7");
  });

  it("pro Adresse wird gebremst, andere Adressen und Konten bleiben unberührt", async () => {
    await makeUser();
    const rs: string[] = [];
    for (let i = 0; i < 25; i++) rs.push(reasonOf(await attempt(`ratename-${i}`, "falsch", "7.7.7.7")));
    assert.equal(rs.slice(0, 20).every((r) => r === "invalid"), true);
    assert.equal(rs.slice(20).every((r) => r === "throttled"), true);
    assert.equal((await attempt("anna", "richtiges-passwort-1", "8.8.8.8")).ok, true, "andere Adresse");
    clock += 2_100;
    assert.equal((await attempt("anna", "richtiges-passwort-1", "7.7.7.7")).ok, true, "nach der Wartezeit auch von der gebremsten Adresse");
  });

  it("ohne Adresse (kein Proxy) gibt es kein IP-Limit: viele Konten von einer Quelle werden nur je Konto gebremst", async () => {
    for (let i = 0; i < 25; i++) assert.equal(reasonOf(await attempt(`ratename-${i}`)), "invalid");
  });
});

describe("Audit", () => {
  it("protokolliert Fehlversuche gedrosselt und ohne Klartext unbekannter Namen", async () => {
    await makeUser("anna");
    for (let i = 0; i < 40; i++) await loginActions.loginAction({}, loginForm("anna", "falsch-123456"));
    for (let i = 0; i < 40; i++) await loginActions.loginAction({}, loginForm("Gespenst", "falsch-123456"));
    const rows = await env.db.auditLog.findMany();
    assert.equal(rows.filter((r) => r.action === "auth.loginFailed" && r.target?.startsWith("anna")).length, 1);
    assert.equal(rows.filter((r) => r.action === "auth.loginThrottled").length, 2);
    const unknown = rows.filter((r) => r.target?.startsWith("#"));
    assert.ok(unknown.length >= 1);
    assert.ok(rows.every((r) => !JSON.stringify(r).toLowerCase().includes("gespenst")), "kein Klartext unbekannter Namen");
    assert.ok(rows.length <= 8, `zu viele Einträge: ${rows.length}`);
  });

  it("protokolliert die erfolgreiche Anmeldung", async () => {
    await makeUser();
    await redirectOf(() => loginActions.loginAction({}, loginForm("anna", "richtiges-passwort-1")));
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.login" } }), 1);
  });
});

describe("Rücksprungziel", () => {
  it("leitet nach der Anmeldung nur auf interne Pfade weiter", async () => {
    await makeUser();
    const go = async (next: string) => {
      browser.reset();
      throttleMod.resetLoginThrottle();
      return redirectOf(() => loginActions.loginAction({}, loginForm("anna", "richtiges-passwort-1", next)));
    };
    assert.equal(await go("/appointments?view=day"), "/appointments?view=day");
    for (const evil of ["/\\evil.example", "//evil.example", "/%5Cevil.example", "javascript:alert(1)", "https://evil.example", "/\t/evil.example"]) {
      const target = await go(evil);
      assert.equal(target, "/", `${JSON.stringify(evil)} → ${target}`);
    }
  });
});

describe("Anmeldeseite", () => {
  it("rendert mit totem Cookie (keine Weiterleitung im Kreis) und leitet mit gültiger Sitzung weiter", async () => {
    await makeUser();
    const { default: LoginPage } = await import("@/app/login/page");
    browser.cookies.set("so_session", "abgelaufen-oder-gefaelscht");
    const element = await LoginPage({ searchParams: Promise.resolve({ next: "/appointments" }) });
    assert.ok(element, "die Anmeldeseite wird angezeigt");
    browser.reset();
    await attempt("anna", "richtiges-passwort-1");
    assert.equal(await redirectOf(() => LoginPage({ searchParams: Promise.resolve({ next: "/appointments" }) })), "/appointments");
    assert.equal(await redirectOf(() => LoginPage({ searchParams: Promise.resolve({ next: "//evil.example" }) })), "/");
    for (const evil of ["/.//evil.example", "/%2e//evil.example", "/a/..//evil.example"]) {
      assert.equal(await redirectOf(() => LoginPage({ searchParams: Promise.resolve({ next: evil }) })), "/", evil);
    }
  });

  it("ohne Benutzer geht es zur Ersteinrichtung", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    assert.equal(await redirectOf(() => LoginPage({ searchParams: Promise.resolve({}) })), "/setup");
  });
});

describe("Passwörter", () => {
  it("scrypt: Hashformat, Kosten im Hash, Anmeldezeit unter einer Sekunde", async () => {
    const user = await makeUser("anna");
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.match(row.passwordHash ?? "", /^scrypt\$32768\$8\$1\$/);
    const started = performance.now();
    assert.equal((await attempt("anna", "richtiges-passwort-1")).ok, true);
    const ms = performance.now() - started;
    console.log(`  Anmeldezeit (scrypt N=2^15) auf diesem Rechner: ${ms.toFixed(0)} ms`);
    assert.ok(ms < 1000, `Anmeldung dauerte ${ms} ms`);
  });

  it("überlange Passwörter werden abgewiesen, ohne zu hashen oder zu zählen", async () => {
    await makeUser();
    const state = await loginActions.loginAction({}, loginForm("anna", "x".repeat(100_000)));
    assert.ok(state.error);
    assert.equal(passwordMod.hashStats.computed, 0);
    assert.equal(throttleMod.loginThrottle.accounts.attemptsOf("anna"), 0);
  });
});

describe("Passwortwechsel im Konto", () => {
  it("hat ein eigenes Limit: nach fünf falschen aktuellen Passwörtern muss man warten", async () => {
    const user = await makeUser();
    await env.signIn(user);
    const change = (current: string) => accountActions.changePassword({}, form({ current, next: "neues-passwort-99", confirm: "neues-passwort-99" }));
    for (let i = 0; i < 5; i++) assert.ok((await change("falsch-falsch")).fieldErrors?.current);
    const blocked = await change("richtiges-passwort-1");
    assert.match(blocked.error ?? "", /Zu viele Versuche/);
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword, false);
    clock += 6_000;
    assert.equal((await change("richtiges-passwort-1")).ok, true);
  });

  it("verlangt 8 bis 128 Zeichen", async () => {
    const user = await makeUser();
    await env.signIn(user);
    const short = await accountActions.changePassword({}, form({ current: "richtiges-passwort-1", next: "kurz", confirm: "kurz" }));
    assert.ok(short.fieldErrors?.next);
    const long = await accountActions.changePassword({}, form({ current: "richtiges-passwort-1", next: "x".repeat(129), confirm: "x".repeat(129) }));
    assert.match(long.fieldErrors?.next ?? "", /128/);
  });
});
