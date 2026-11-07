import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { browser, createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Härtung des Passwort- und Geräte-Pfads (R2-SEC-01 bis 04, 05): Eigentümer-Pfad bei einer Flut von Geräte-Anmeldungen, Gerät nur auf Wunsch, benutzte Geräte werden nie
 * von neuen verdrängt, Fehlversuche vom Gerät zählen auch in der Datenbank, der Erfolg der Besitzerin schenkt einem Cookie-Dieb nichts, und gleichzeitiges Widerrufen
 * macht eine geglückte Anmeldung nicht zu einem Fehler.
 */
let env: TestEnv;
let session: typeof import("./session");
let devices: typeof import("./devices");
let throttleMod: typeof import("./throttle");
let passwordMod: typeof import("./password");
let clock = Date.now();

const PW = "richtiges-passwort-1";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

before(async () => {
  env = await createTestEnv();
  session = await import("./session");
  devices = await import("./devices");
  throttleMod = await import("./throttle");
  passwordMod = await import("./password");
  const runtime = await import("./runtime");
  runtime.authRuntime.now = () => clock;
  runtime.authRuntime.sleep = async () => undefined;
  runtime.authRuntime.random = () => 0.5;
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.twoFactorBackupCode.deleteMany();
  await env.db.twoFactor.deleteMany();
  await env.db.knownDevice.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  clock = Date.now();
  browser.reset();
  throttleMod.resetLoginThrottle();
});

const makeUser = async (username = "anna") => {
  const user = await env.user({ username, password: PW });
  passwordMod.hashStats.computed = 0;
  return user;
};
/** Meldet mit „Dieses Gerät merken“ an und gibt das Geräte-Cookie zurück – wie das Gerät der Person, danach ohne Cookies im Browser. */
const rememberedDevice = async (name = "anna") => {
  assert.equal((await session.login(name, PW, { rememberDevice: true })).ok, true);
  const token = browser.cookies.get("so_device");
  assert.ok(token, "nach „Gerät merken“ gibt es ein Geräte-Cookie");
  browser.reset();
  throttleMod.resetLoginThrottle();
  return token;
};
const withDevice = (name: string, pw: string, deviceToken: string | undefined) => session.login(name, pw, { deviceToken });

describe("R2-SEC-01: Flut von Geräte-Anmeldungen", () => {
  it("parallele Anmeldungen mit gültigem Geräte-Cookie belegen höchstens zwei Plätze des Kontos; der Rest wird sofort abgewiesen (busy) oder gedrosselt", async () => {
    const user = await makeUser();
    const token = await rememberedDevice();
    passwordMod.hashStats.computed = 0;
    const results = await Promise.all(Array.from({ length: 60 }, () => withDevice("anna", "geraten-123456", token)));
    const kinds = results.map((r) => (r.ok ? "ok" : r.reason));
    assert.ok(kinds.filter((k) => k === "busy").length >= 1, `Überlast wird abgewiesen: ${kinds.join(",")}`);
    assert.ok(passwordMod.hashStats.computed <= 5, `gerechnet: ${passwordMod.hashStats.computed}`);
    assert.equal(passwordMod.ownerLane.active + passwordMod.ownerLane.waiting, 0, "alle Plätze sind danach wieder frei");
    void user;
  });

  it("die Flut eines Kontos belegt höchstens zwei Plätze und wartet nicht unbegrenzt – auch wenn der Eigentümer-Pfad gerade belegt ist", async () => {
    await makeUser("anna");
    const bob = await makeUser("bob");
    const token = await rememberedDevice("anna");
    // Der Eigentümer-Pfad ist belegt: eine Berechnung läuft (Platz von Bob), eine wartet
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => (release = resolve));
    const held = [passwordMod.ownerLane.run(`${passwordMod.accountOwner(bob.id)}:1`, () => blocker), passwordMod.ownerLane.run(`${passwordMod.accountOwner(bob.id)}:2`, () => blocker)];
    const results: string[] = [];
    const flood = Array.from({ length: 40 }, () => withDevice("anna", PW, token).then((r) => results.push(r.ok ? "ok" : r.reason)));
    await new Promise((resolve) => setTimeout(resolve, 200));
    // sofort beantwortet (abgewiesen oder gedrosselt) ist alles bis auf die höchstens zwei Anmeldungen, die in der Warteschlange stehen
    assert.ok(results.length >= 38, `sofort beantwortet: ${results.length} von 40`);
    assert.ok(results.every((r) => r === "busy" || r === "throttled"), results.join(","));
    assert.ok(passwordMod.ownerLane.waiting <= 3, `wartend: ${passwordMod.ownerLane.waiting}`);
    release();
    await Promise.all([...held, ...flood]);
    assert.equal(passwordMod.ownerLane.waiting + passwordMod.ownerLane.active, 0);
  });

  it("Passwort setzen (Konto) kommt trotz einer Flut von Geräte-Anmeldungen eines anderen Kontos durch", async () => {
    await makeUser("anna");
    const bob = await makeUser("bob");
    const token = await rememberedDevice("anna");
    const flood = Array.from({ length: 40 }, () => withDevice("anna", PW, token));
    const hash = passwordMod.hashPassword("neues-passwort-123", passwordMod.accountOwner(bob.id));
    const [hashed] = await Promise.all([hash, ...flood]);
    assert.ok(hashed.startsWith("scrypt$"));
  });
});

describe("R2-SEC-02: Gerät nur auf Wunsch, Liste, Widerruf, Abmelden", () => {
  it("ohne „Dieses Gerät merken“ entsteht kein Gerät und kein Cookie", async () => {
    await makeUser();
    assert.equal((await session.login("anna", PW)).ok, true);
    assert.equal(browser.cookies.has("so_device"), false);
    assert.equal(await env.db.knownDevice.count(), 0);
  });

  it("ein bereits bekanntes Gerät wird bei jeder Anmeldung aufgefrischt (auch ohne Häkchen) und zählt hoch", async () => {
    await makeUser();
    const token = await rememberedDevice();
    clock += 3_600_000;
    assert.equal((await withDevice("anna", PW, token)).ok, true);
    const row = await env.db.knownDevice.findFirstOrThrow();
    assert.equal(row.useCount, 2);
    assert.equal(row.lastUsedAt.getTime(), clock);
    assert.equal(browser.cookies.get("so_device"), token, "das Cookie wird erneuert, bleibt aber dasselbe");
  });

  it("Abmelden mit „Gerät vergessen“ löscht die Zeile und das Cookie; gewöhnliches Abmelden lässt das Gerät bestehen", async () => {
    await makeUser();
    await session.login("anna", PW, { rememberDevice: true });
    await session.logout();
    assert.equal(await env.db.knownDevice.count(), 1);
    assert.ok(browser.cookies.has("so_device"));
    await session.login("anna", PW, { deviceToken: browser.cookies.get("so_device") });
    await session.logout({ forgetDevice: true });
    assert.equal(await env.db.knownDevice.count(), 0);
    assert.equal(browser.cookies.has("so_device"), false);
    assert.equal(browser.cookies.has("so_session"), false);
  });

  it("die Geräteliste kennt das Gerät dieses Browsers; ein anderes Konto sieht fremde Geräte nicht", async () => {
    const anna = await makeUser("anna");
    const bob = await makeUser("bob");
    await session.login("anna", PW, { rememberDevice: true });
    await env.db.knownDevice.create({ data: { tokenHash: sha("anderer-browser"), userId: anna.id, userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0" } });
    const rows = await devices.listDevices(anna.id);
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((r) => r.current).length, 1);
    assert.equal((await devices.listDevices(bob.id)).length, 0);
  });

  it("private Sitzungen verdrängen echte Geräte nicht: benutzte Geräte bleiben, nur nie wieder benutzte weichen", async () => {
    const anna = await makeUser();
    // 10 echte Geräte, alle schon wieder benutzt (useCount > 1)
    for (let i = 0; i < 10; i++) {
      await env.db.knownDevice.create({ data: { tokenHash: sha(`echt-${i}`), userId: anna.id, useCount: 3, lastUsedAt: new Date(clock - i * 1000) } });
    }
    // viele private Sitzungen („Gerät merken“, aber jedes Mal ein frischer Browser): erstes Anmelden – nichts wird verdrängt
    for (let i = 0; i < 15; i++) {
      browser.reset();
      throttleMod.resetLoginThrottle();
      clock += 1_000;
      assert.equal((await session.login("anna", PW, { rememberDevice: true })).ok, true, "die Anmeldung selbst gelingt");
      assert.equal(browser.cookies.has("so_device"), false, "ein elftes Gerät wird nicht gemerkt");
    }
    const left = await env.db.knownDevice.findMany({ where: { userId: anna.id } });
    assert.equal(left.length, 10);
    assert.ok(left.every((row) => row.useCount === 3), "alle echten Geräte sind noch da");
  });

  it("ist ein Platz mit einem nie wieder benutzten Gerät belegt, weicht genau dieses (das älteste) dem neuen", async () => {
    const anna = await makeUser();
    for (let i = 0; i < 9; i++) await env.db.knownDevice.create({ data: { tokenHash: sha(`echt-${i}`), userId: anna.id, useCount: 4, lastUsedAt: new Date(clock - 100_000 - i) } });
    const privateOne = await env.db.knownDevice.create({ data: { tokenHash: sha("privat"), userId: anna.id, useCount: 1, lastUsedAt: new Date(clock - 500_000) } });
    assert.equal((await session.login("anna", PW, { rememberDevice: true })).ok, true);
    assert.ok(browser.cookies.has("so_device"));
    const rows = await env.db.knownDevice.findMany({ where: { userId: anna.id } });
    assert.equal(rows.length, 10);
    assert.equal(rows.some((r) => r.id === privateOne.id), false, "das nie wieder benutzte Gerät wurde verdrängt");
    assert.equal(rows.filter((r) => r.useCount === 4).length, 9);
  });

  it("abgelaufene Geräte (180 Tage) räumt das Anlegen eines neuen Geräts weg", async () => {
    const anna = await makeUser();
    for (let i = 0; i < 10; i++) await env.db.knownDevice.create({ data: { tokenHash: sha(`alt-${i}`), userId: anna.id, useCount: 5, lastUsedAt: new Date(clock - 200 * 86_400_000) } });
    assert.equal((await session.login("anna", PW, { rememberDevice: true })).ok, true);
    assert.equal(await env.db.knownDevice.count({ where: { userId: anna.id } }), 1);
  });
});

describe("R2-SEC-03: Fehlversuche vom Gerät zählen auch in der Datenbank", () => {
  it("nach den freien Fehlversuchen steht die Wartezeit in der Datenbank – ein Neustart (leerer Speicher) hebt sie nicht auf", async () => {
    const anna = await makeUser();
    const token = await rememberedDevice();
    for (let i = 0; i < 6; i++) await withDevice("anna", "geraten-123456", token);
    const row = await env.db.knownDevice.findFirstOrThrow({ where: { userId: anna.id } });
    assert.ok(row.failedLogins >= 5, `gezählt: ${row.failedLogins}`);
    assert.ok(row.lockedUntil && row.lockedUntil.getTime() > clock);
    // „Neustart“: der Speicher ist leer, das richtige Passwort muss trotzdem warten
    throttleMod.resetLoginThrottle();
    const waiting = await withDevice("anna", PW, token);
    assert.equal(!waiting.ok && waiting.reason, "throttled");
    // nach Ablauf der Wartezeit geht es wieder
    clock += 100_000;
    assert.equal((await withDevice("anna", PW, token)).ok, true);
  });

  it("Fehlversuche vom Gerät zählen nicht gegen das Konto (kein Aussperren für andere Geräte)", async () => {
    const anna = await makeUser();
    const token = await rememberedDevice();
    for (let i = 0; i < 8; i++) await withDevice("anna", "geraten-123456", token);
    const user = await env.db.user.findUniqueOrThrow({ where: { id: anna.id } });
    assert.equal(user.failedLogins, 0);
    assert.equal(user.lockedUntil, null);
    assert.equal((await session.login("anna", PW)).ok, true);
  });

  it("Cookie-Dieb mit zwei Spuren: Die Anmeldungen der Besitzerin verschaffen ihm keine neuen freien Versuche", async () => {
    await makeUser();
    const token = await rememberedDevice();
    let thiefTried = 0;
    let throttledAt = 0;
    // abwechselnd: der Dieb rät, die Besitzerin meldet sich mit demselben Cookie richtig an (jedes Mal ohne Wartezeit dazwischen)
    for (let round = 0; round < 12 && !throttledAt; round++) {
      const guess = await withDevice("anna", "geraten-123456", token);
      if (!guess.ok && guess.reason === "throttled") throttledAt = round + 1;
      else thiefTried++;
      const owner = await withDevice("anna", PW, token);
      if (!owner.ok) assert.equal(owner.reason, "throttled");
    }
    // Ohne Erfolgs-Zurücksetzen wäre die Wartezeit nie erreicht worden (nach jeweils zwei Versuchen wieder bei null)
    assert.ok(throttledAt > 0, "irgendwann greift die Wartezeit trotz der Erfolge der Besitzerin");
    assert.ok(thiefTried <= 8, `der Dieb kam auf ${thiefTried} Versuche`);
  });
});

describe("R2-SEC-04: Gleichzeitiges Widerrufen lässt die Anmeldung nicht scheitern", () => {
  it("das Gerät verschwindet zwischen Erkennen und Auffrischen: kein Fehler, die Anmeldung gelingt, das Cookie wird geräumt", async () => {
    const anna = await makeUser();
    const token = await rememberedDevice();
    const presented = { token, device: await devices.findKnownDevice(token) };
    assert.ok(presented.device);
    await devices.revokeDevices(anna.id); // gleichzeitig durch die Administration
    await assert.doesNotReject(devices.rememberDevice(anna.id, presented, false));
    assert.equal(await env.db.knownDevice.count(), 0);
    // mit Wunsch zum Merken entsteht ein frisches Gerät
    await devices.rememberDevice(anna.id, presented, true);
    assert.equal(await env.db.knownDevice.count(), 1);
  });

  it("Anmeldungen und Widerrufe gleichzeitig: nie ein Fehler, nie mehr als 10 Geräte", async () => {
    const anna = await makeUser();
    const token = await rememberedDevice();
    const work: Array<Promise<unknown>> = [];
    for (let i = 0; i < 30; i++) {
      work.push(session.login("anna", PW, { deviceToken: token, rememberDevice: true }));
      work.push(devices.revokeDevices(anna.id));
    }
    const settled = await Promise.allSettled(work);
    assert.deepEqual(settled.filter((r) => r.status === "rejected"), []);
    assert.ok((await env.db.knownDevice.count({ where: { userId: anna.id } })) <= 10);
  });

  it("ein Fehler beim Merken macht eine geglückte Anmeldung nicht zum Fehler", async () => {
    await makeUser();
    await env.db.$executeRawUnsafe('CREATE TRIGGER "test_block_device_insert" BEFORE INSERT ON "KnownDevice" BEGIN SELECT RAISE(ABORT, "kaputt"); END');
    const log = console.error;
    console.error = () => undefined;
    try {
      const result = await session.login("anna", PW, { rememberDevice: true });
      assert.equal(result.ok, true);
      assert.equal(await env.db.session.count(), 1, "die Sitzung steht");
    } finally {
      console.error = log;
      await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_device_insert"');
    }
  });
});
