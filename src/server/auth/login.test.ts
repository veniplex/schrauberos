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
  it("meldet im HTTP-LAN mit Klartext-Cookie an, über HTTPS mit __Host- und Secure – beide werden gelesen", async () => {
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

  it("Abmelden löscht beide Cookie-Namen und die Sitzung", async () => {
    await makeUser();
    await attempt("anna", "richtiges-passwort-1");
    await session.logout();
    assert.equal(browser.cookies.size, 0);
    assert.equal(await env.db.session.count(), 0);
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

  it("unbekannte Namen verhalten sich genau wie bekannte (kein Existenz-Orakel)", async () => {
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
    passwordMod.hashStats.computed = 0;
    const unknown = await script("gespenst");
    assert.deepEqual(unknown, known);
    assert.equal(passwordMod.hashStats.computed, 3, "auch unbekannte Namen werden (wie bekannte) gerechnet, damit die Zeit nichts verrät");
    // gleiche Meldung für falsches Passwort und unbekannten Namen
    throttleMod.resetLoginThrottle();
    await env.db.user.updateMany({ data: { failedLogins: 0, lockedUntil: null } });
    const a = await loginActions.loginAction({}, loginForm("anna", "falsch-123456"));
    const b = await loginActions.loginAction({}, loginForm("gespenst", "falsch-123456"));
    assert.equal(a.error, b.error);
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
