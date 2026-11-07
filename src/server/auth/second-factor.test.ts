import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { generateBackupCodes, hashBackupCode, normalizeBackupCode } from "@/lib/backup-codes";
import { base32Decode, base32Encode, generateTotpSecret, timeStep, totp } from "@/lib/totp";
import { browser, createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Zwei-Faktor-Anmeldung (TOTP) und Sicherungscodes gegen eine echte Datenbank: Einrichtung mit Bestätigung, zweiter Schritt der Anmeldung (kein Sitzungs-Cookie vor dem
 * Abschluss), Einmal-Zeitschritte, Drosselung, Sicherungscodes, **das bekannte Gerät ersetzt den zweiten Faktor nie** (R2-SEC-05), Notzugang/Administration setzen zurück,
 * Restore ohne Schlüssel, Pflicht für Administratoren, Leerlauf-Abmeldung, Sitzungen und „überall abmelden“.
 */
let env: TestEnv;
let session: typeof import("./session");
let sf: typeof import("./second-factor");
let throttleMod: typeof import("./throttle");
let pendingMod: typeof import("./pending");
let secrets: typeof import("@/server/secrets");
let loginActions: typeof import("@/app/login/actions");
let verifyActions: typeof import("@/app/login/verify/actions");
let sec: typeof import("@/platform/account/security-actions");
let userActions: typeof import("@/modules/admin/users/actions");
let settingsActions: typeof import("@/modules/admin/settings/actions");
let clock = Date.now();

const PW = "richtiges-passwort-1";
const ADMIN_PW = "admin-passwort-1";

before(async () => {
  env = await createTestEnv();
  session = await import("./session");
  sf = await import("./second-factor");
  throttleMod = await import("./throttle");
  pendingMod = await import("./pending");
  secrets = await import("@/server/secrets");
  loginActions = await import("@/app/login/actions");
  verifyActions = await import("@/app/login/verify/actions");
  sec = await import("@/platform/account/security-actions");
  userActions = await import("@/modules/admin/users/actions");
  settingsActions = await import("@/modules/admin/settings/actions");
  const runtime = await import("./runtime");
  runtime.authRuntime.now = () => clock;
  runtime.authRuntime.sleep = async () => undefined;
  runtime.authRuntime.random = () => 0.5;
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.auditLog.deleteMany();
  await env.db.appSetting.deleteMany();
  await env.db.apiToken.deleteMany();
  await env.db.twoFactorBackupCode.deleteMany();
  await env.db.twoFactor.deleteMany();
  await env.db.knownDevice.deleteMany();
  await env.db.session.deleteMany();
  await env.db.recoveryNotice.deleteMany();
  await env.db.recoveryCode.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  clock = Date.now();
  browser.reset();
  throttleMod.resetLoginThrottle();
  pendingMod.pendingLogins.clear();
});

type TestUser = Awaited<ReturnType<TestEnv["user"]>>;

/** Schaltet den zweiten Faktor direkt in der Datenbank ein (bekanntes Geheimnis); gibt Geheimnis und Sicherungscodes zurück. */
async function enableDirect(user: { id: string }) {
  const secret = generateTotpSecret();
  await env.db.twoFactor.create({ data: { userId: user.id, secret: secrets.encryptSecret(base32Encode(secret)), enabledAt: new Date(clock), lastStep: 0 } });
  const codes = generateBackupCodes();
  await env.db.twoFactorBackupCode.createMany({ data: codes.map((code) => ({ userId: user.id, codeHash: hashBackupCode(user.id, normalizeBackupCode(code)!) })) });
  return { secret, codes, code: () => totp(secret, clock), at: (offsetSeconds: number) => totp(secret, clock + offsetSeconds * 1000) };
}
/** Jede Anmeldung braucht einen neuen Zeitschritt (derselbe Code gilt nur einmal): die Uhr um einen Schritt weiterstellen. */
const nextStep = () => (clock += 30_000);

const admin = async (username = "chef"): Promise<TestUser> => env.user({ username, password: ADMIN_PW, roles: [await env.role({ key: `admin-${username}`, isAdmin: true })] });
const person = async (username = "anna", permissions: string[] = ["customers.view"]): Promise<TestUser> =>
  env.user({ username, password: PW, roles: [await env.role({ key: `r-${username}`, permissions })] });
const sessionCookie = () => browser.cookies.get("so_session");
const pendingCookie = () => browser.cookies.get("so_2fa");
/** Passwort-Schritt: gelingt mit Zwischenzustand, ohne Sitzung */
async function passwordStep(name: string, pw = PW, extra: { deviceToken?: string; rememberDevice?: boolean } = {}) {
  const result = await session.login(name, pw, extra);
  return result;
}

describe("Einrichtung im Konto", () => {
  it("Passwort, QR-Code und Sicherungscodes, Bestätigung mit Code und Häkchen – das Geheimnis steht nur verschlüsselt in der Datenbank", async () => {
    const user = await person();
    await env.signIn(user);

    const wrong = await sec.startTwoFactor({}, form({ password: "falsch-falsch-1" }));
    assert.ok(wrong.fieldErrors?.password && !("setup" in wrong));
    const started = (await sec.startTwoFactor({}, form({ password: PW }))) as import("@/platform/account/security-actions").TwoFactorSetupState;
    assert.ok(started.setup);
    const { secret, codes, qr } = started.setup;
    assert.equal(codes.length, 10);
    assert.ok(qr.size >= 21 && qr.rows.length === qr.size);
    assert.match(secret, /^[A-Z2-7]{32}$/);

    // noch nicht wirksam: die Anmeldung verlangt (noch) keinen zweiten Faktor
    assert.equal(await sf.secondFactorRequired(user.id), false);
    // Klartext steht nirgends in der Datenbank (Geheimnis verschlüsselt, Sicherungscodes nur als Hash)
    const dump = JSON.stringify({ tf: await env.db.twoFactor.findMany(), codes: await env.db.twoFactorBackupCode.findMany(), audit: await env.db.auditLog.findMany(), settings: await env.db.appSetting.findMany() });
    assert.equal(dump.includes(secret), false);
    for (const code of codes) assert.equal(dump.includes(code.replaceAll("-", "")), false);
    const row = await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(secrets.decryptSecret(row.secret!), secret, "verschlüsselt mit dem Schlüssel der Installation (setSecret-Mechanismus)");
    assert.equal(row.enabledAt, null);

    const secretBytes = base32Decode(secret)!;
    // ohne Häkchen, mit falschem Code
    assert.ok((await sec.enableTwoFactor({}, form({ code: totp(secretBytes, clock) }))).fieldErrors?.backupConfirmed);
    assert.ok((await sec.enableTwoFactor({}, form({ code: "000000", backupConfirmed: true }))).fieldErrors?.code);
    assert.equal((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).enabledAt, null);
    // richtig
    const done = await sec.enableTwoFactor({}, form({ code: totp(secretBytes, clock), backupConfirmed: true }));
    assert.equal(done.ok, true);
    const enabled = await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } });
    assert.ok(enabled.enabledAt);
    assert.equal(enabled.lastStep, timeStep(clock), "der Zeitschritt der Bestätigung ist verbraucht");
    assert.equal(await sf.secondFactorRequired(user.id), true);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "auth.twoFactorEnabled" } });
    assert.equal(entry.target, "anna");
    assert.equal(JSON.stringify(await env.db.auditLog.findMany()).includes(secret), false);
  });

  it("die Code-Eingabe bei der Einrichtung hat ein eigenes Limit", async () => {
    const user = await person();
    await env.signIn(user);
    await sec.startTwoFactor({}, form({ password: PW }));
    const results: Array<string | undefined> = [];
    for (let i = 0; i < 8; i++) {
      const state = await sec.enableTwoFactor({}, form({ code: "000000", backupConfirmed: true }));
      results.push(state.error);
    }
    assert.ok(results.slice(0, 4).every((e) => e === undefined), "die ersten Versuche sind frei (nur ein Feldfehler)");
    assert.ok(results.slice(6).every(Boolean), `danach Wartezeit: ${JSON.stringify(results)}`);
  });

  it("Ausschalten und Sicherungscodes erneuern verlangen das Passwort; neue Codes machen die alten ungültig", async () => {
    const user = await person();
    await env.signIn(user);
    const { codes } = await enableDirect(user);
    const bad = await sec.regenerateBackupCodes({}, form({ password: "falsch-falsch-1" }));
    assert.ok(bad.fieldErrors?.password);
    const fresh = (await sec.regenerateBackupCodes({}, form({ password: PW }))) as import("@/platform/account/security-actions").TwoFactorSetupState;
    assert.equal(fresh.backupCodes?.length, 10);
    assert.equal(fresh.backupCodes!.some((c) => codes.includes(c)), false);
    assert.equal(await env.db.twoFactorBackupCode.count({ where: { userId: user.id } }), 10);
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.twoFactorBackupCodes" } }), 1);

    assert.ok((await sec.disableTwoFactor({}, form({ password: "falsch-falsch-1" }))).fieldErrors?.password);
    assert.equal(await sf.secondFactorRequired(user.id), true);
    assert.equal((await sec.disableTwoFactor({}, form({ password: PW }))).ok, true);
    assert.equal(await sf.secondFactorRequired(user.id), false);
    assert.equal(await env.db.twoFactorBackupCode.count({ where: { userId: user.id } }), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.twoFactorDisabled" } }), 1);
  });
});

describe("Anmeldung in zwei Schritten", () => {
  it("nach dem Passwort gibt es noch keine Sitzung und kein Sitzungs-Cookie – nur ein kurzes Cookie für den Zwischenzustand", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    const first = await passwordStep("anna");
    assert.deepEqual(first.ok === false && first.reason, "secondFactor");
    assert.equal(await env.db.session.count(), 0);
    assert.equal(sessionCookie(), undefined);
    assert.equal(await session.getSession(), null);
    const write = browser.writes.find((w) => w.name === "so_2fa")!;
    assert.ok(write.value && write.value.length >= 40);
    assert.deepEqual({ h: write.options.httpOnly, l: write.options.sameSite, p: write.options.path, a: write.options.maxAge }, { h: true, l: "lax", p: "/", a: 300 });
    assert.equal(await session.hasPendingLogin(), true);
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: anna.id } })).lastLoginAt, null, "als angemeldet gilt erst der Abschluss");

    const second = await session.verifySecondFactor(tf.code());
    assert.equal(second.ok, true);
    assert.equal(await env.db.session.count(), 1);
    assert.ok(sessionCookie());
    assert.equal(pendingCookie(), undefined, "der Zwischenzustand ist verbraucht");
    assert.equal(pendingMod.pendingLogins.size, 0);
    assert.equal((await session.getSession())?.user.username, "anna");
    assert.ok((await env.db.user.findUniqueOrThrow({ where: { id: anna.id } })).lastLoginAt);
  });

  it("unter HTTPS heißt das Cookie __Host-so_2fa (Secure, Pfad /); ein Klartext-Cookie wird dort nicht gelesen", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    browser.setHeaders({ "x-forwarded-proto": "https" });
    await passwordStep("anna");
    const write = browser.writes.find((w) => w.name === "__Host-so_2fa")!;
    assert.deepEqual({ s: write.options.secure, p: write.options.path }, { s: true, p: "/" });
    // ein untergeschobenes Klartext-Cookie mit gültiger Kennung zählt nicht
    const token = browser.cookies.get("__Host-so_2fa")!;
    browser.cookies.delete("__Host-so_2fa");
    browser.cookies.set("so_2fa", token);
    assert.equal(await session.hasPendingLogin(), false);
    assert.deepEqual(await session.verifySecondFactor(tf.code()), { ok: false, reason: "expired" });
  });

  it("falsches Passwort, unbekannter Name und Konto mit zweitem Faktor sind vor dem Code nicht zu unterscheiden (kein Benutzerorakel)", async () => {
    const anna = await person();
    await enableDirect(anna);
    await person("bob");
    const wrongPassword = await passwordStep("anna", "falsch-falsch-123");
    const unknown = await passwordStep("niemand", "falsch-falsch-123");
    const plain = await passwordStep("bob", "falsch-falsch-123");
    assert.deepEqual([wrongPassword.ok === false && wrongPassword.reason, unknown.ok === false && unknown.reason, plain.ok === false && plain.reason], ["invalid", "invalid", "invalid"]);
    assert.equal(pendingCookie(), undefined, "ohne richtiges Passwort kein Zwischenzustand");
    assert.equal(pendingMod.pendingLogins.size, 0);
  });

  it("falsche Codes: dieselbe Antwort für falsch, alt und Müll; ein Sicherungscode ist kein Passwort-Ersatz", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    for (const bad of ["000000", "12345", "abcdef", tf.at(-120), "ABCD-EFGH-JKMN-PQRS"]) {
      const result = await session.verifySecondFactor(bad);
      assert.equal(result.ok === false && result.reason, "invalid", bad);
    }
    assert.equal(await env.db.session.count(), 0);
  });

  it("±1 Zeitschritt wird toleriert, mehr nicht", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    assert.equal((await session.verifySecondFactor(tf.at(-60))).ok, false);
    assert.equal((await session.verifySecondFactor(tf.at(60))).ok, false);
    assert.equal((await session.verifySecondFactor(tf.at(30))).ok, true);
  });

  it("ein Code gilt nur einmal: derselbe Zeitschritt (und frühere) lässt sich in keiner zweiten Anmeldung wiederverwenden", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    const used = tf.code();
    assert.equal((await session.verifySecondFactor(used)).ok, true);
    await session.logout();
    // gleiche Sekunde: der Code ist verbraucht
    await passwordStep("anna");
    assert.equal((await session.verifySecondFactor(used)).ok, false);
    // der vorige Schritt zählt nicht mehr (kein Zurückspulen), der nächste schon
    assert.equal((await session.verifySecondFactor(tf.at(-30))).ok, false);
    assert.equal((await session.verifySecondFactor(tf.at(30))).ok, true);
  });

  it("zwei gleichzeitige Eingaben desselben Codes: genau eine gewinnt, es entsteht genau eine Sitzung", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    const code = tf.code();
    const results = await Promise.all([session.verifySecondFactor(code), session.verifySecondFactor(code), session.verifySecondFactor(code)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await env.db.session.count(), 1);
  });

  it("fünf falsche Codes verbrauchen den Zwischenzustand: danach muss das Passwort neu eingegeben werden", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    for (let i = 0; i < 5; i++) assert.equal((await session.verifySecondFactor("000000")).ok, false);
    assert.equal(pendingMod.pendingLogins.size, 0);
    assert.deepEqual(await session.verifySecondFactor(tf.code()), { ok: false, reason: "expired" });
    assert.equal(pendingCookie(), undefined, "das Cookie wird geräumt");
  });

  it("der Zwischenzustand läuft nach 5 Minuten ab", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    clock += 5 * 60_000 + 1;
    assert.deepEqual(await session.verifySecondFactor(tf.code()), { ok: false, reason: "expired" });
    assert.equal(await session.hasPendingLogin(), false);
  });

  it("Drosselung je Konto: nach den freien Fehlversuchen Wartezeit – auch über mehrere Anmeldungen hinweg und über einen Neustart (Datenbank)", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    const outcomes: string[] = [];
    for (let round = 0; round < 3; round++) {
      await passwordStep("anna");
      for (let i = 0; i < 3; i++) {
        const r = await session.verifySecondFactor("000000");
        outcomes.push(r.ok ? "ok" : r.reason);
      }
    }
    assert.ok(outcomes.includes("throttled"), outcomes.join(","));
    // auch der richtige Code muss warten – ohne Prüfung
    await passwordStep("anna");
    const waiting = await session.verifySecondFactor(tf.code());
    assert.equal(waiting.ok === false && waiting.reason, "throttled");
    // „Neustart“: der Speicher ist leer, die Datenbank hält die Wartezeit
    throttleMod.resetLoginThrottle();
    const row = await env.db.twoFactor.findUniqueOrThrow({ where: { userId: anna.id } });
    assert.ok(row.failedAttempts >= 5 && row.lockedUntil && row.lockedUntil.getTime() > clock);
    await passwordStep("anna");
    const afterRestart = await session.verifySecondFactor(tf.code());
    assert.equal(afterRestart.ok === false && afterRestart.reason, "throttled");
    clock += 100_000;
    await passwordStep("anna");
    assert.equal((await session.verifySecondFactor(tf.code())).ok, true);
  });

  it("die Erfolge der Besitzerin schenken dem Raterat keine freien Versuche (Erfolg gleicht nur den eigenen Versuch aus)", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    let throttled = false;
    for (let round = 0; round < 10 && !throttled; round++) {
      await passwordStep("anna");
      const guess = await session.verifySecondFactor("000000");
      throttled = guess.ok === false && guess.reason === "throttled";
      if (!throttled) {
        nextStep();
        await passwordStep("anna");
        const owner = await session.verifySecondFactor(tf.code());
        if (!owner.ok) assert.equal(owner.reason, "throttled");
        await session.logout();
      }
    }
    assert.ok(throttled, "die Wartezeit greift trotz der Erfolge dazwischen");
  });

  it("das Passwort-Limit des Kontos bleibt eigenständig: Fehlversuche beim Code zählen nicht als falsche Passwörter", async () => {
    const anna = await person();
    await enableDirect(anna);
    await passwordStep("anna");
    for (let i = 0; i < 4; i++) await session.verifySecondFactor("000000");
    const user = await env.db.user.findUniqueOrThrow({ where: { id: anna.id } });
    assert.equal(user.failedLogins, 0);
  });
});

describe("Sicherungscodes", () => {
  it("ein Sicherungscode ersetzt den Code der App – genau einmal; Schreibweise ist egal; fremde Codes gelten nicht", async () => {
    const anna = await person();
    const bob = await person("bob");
    const tfA = await enableDirect(anna);
    const tfB = await enableDirect(bob);
    await passwordStep("anna");
    // Code eines anderen Kontos
    assert.equal((await session.verifySecondFactor(tfB.codes[0])).ok, false);
    const result = await session.verifySecondFactor(tfA.codes[0].toLowerCase().replaceAll("-", " "));
    assert.ok(result.ok && result.via === "backup" && result.backupCodesLeft === 9);
    await session.logout();
    // verbraucht
    await passwordStep("anna");
    assert.equal((await session.verifySecondFactor(tfA.codes[0])).ok, false);
    assert.equal((await session.verifySecondFactor(tfA.codes[1])).ok, true);
    assert.equal(await env.db.twoFactorBackupCode.count({ where: { userId: anna.id, usedAt: null } }), 8);
  });

  it("gleichzeitige Eingaben desselben Sicherungscodes: genau einer gewinnt", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna");
    const results = await Promise.all([session.verifySecondFactor(tf.codes[3]), session.verifySecondFactor(tf.codes[3]), session.verifySecondFactor(tf.codes[3])]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await env.db.session.count(), 1);
  });

  it("die Aktionen auf den Seiten: Anmeldung leitet zum zweiten Schritt, Erfolg zurück auf die Seite, Audit ohne Code-Material", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    const target = await redirectOf(() => loginActions.loginAction({}, form({ username: "anna", password: PW, next: "/customers?q=x" })));
    assert.equal(target, "/login/verify?next=%2Fcustomers%3Fq%3Dx");
    assert.equal(await env.db.session.count(), 0);
    // falscher Code: Fehlermeldung, kein Audit-Spam
    const bad = await verifyActions.verifyAction({}, form({ code: "000000", next: "/customers?q=x" }));
    assert.ok(bad.error);
    assert.equal(await redirectOf(() => verifyActions.verifyAction({}, form({ code: tf.codes[0], next: "/customers?q=x" }))), "/customers?q=x");
    const actions = (await env.db.auditLog.findMany()).map((e) => e.action);
    assert.ok(actions.includes("auth.login") && actions.includes("auth.backupCodeUsed") && actions.includes("auth.secondFactorFailed"));
    assert.equal(JSON.stringify(await env.db.auditLog.findMany()).includes(tf.codes[0].replaceAll("-", "")), false);
    // ohne Zwischenzustand: zurück zur Anmeldung
    await session.logout();
    assert.equal(await redirectOf(() => verifyActions.verifyAction({}, form({ code: "123456" }))), "/login?notice=twoFactorExpired");
  });

  it("ein unsicheres Rücksprungziel wird nie übernommen", async () => {
    const anna = await person();
    await enableDirect(anna);
    assert.equal(await redirectOf(() => loginActions.loginAction({}, form({ username: "anna", password: PW, next: "//evil.example" }))), "/login/verify");
  });
});

describe("R2-SEC-05: Das bekannte Gerät ersetzt nie den zweiten Faktor", () => {
  it("mit gültigem Geräte-Cookie und richtigem Passwort verlangt die Anmeldung trotzdem den Code – es entsteht keine Sitzung", async () => {
    const anna = await person();
    assert.equal((await session.login("anna", PW, { rememberDevice: true })).ok, true);
    const deviceToken = browser.cookies.get("so_device")!;
    await session.logout();
    const tf = await enableDirect(anna);
    browser.cookies.delete("so_2fa");
    throttleMod.resetLoginThrottle();

    nextStep();
    const viaDevice = await passwordStep("anna", PW, { deviceToken });
    assert.equal(viaDevice.ok === false && viaDevice.reason, "secondFactor");
    assert.equal(sessionCookie(), undefined);
    assert.equal(await env.db.session.count(), 0);
    // ohne Code geht nichts; mit dem Code der App gelingt es
    assert.equal((await session.verifySecondFactor("000000")).ok, false);
    assert.equal((await session.verifySecondFactor(tf.code())).ok, true);
    assert.equal(await env.db.session.count(), 1);
  });

  it("das Gerät befreit weiter von der Konto-Wartezeit, aber nie vom Code – und es wird erst mit dem Abschluss aufgefrischt", async () => {
    const anna = await person();
    assert.equal((await session.login("anna", PW, { rememberDevice: true })).ok, true);
    const deviceToken = browser.cookies.get("so_device")!;
    await session.logout();
    const tf = await enableDirect(anna);
    throttleMod.resetLoginThrottle();
    for (let i = 0; i < 5; i++) await passwordStep("anna", "falsch-falsch-123"); // Dauerbeschuss ohne Cookie
    assert.equal((await passwordStep("anna", PW)).ok === false, true);
    nextStep();
    const viaDevice = await passwordStep("anna", PW, { deviceToken });
    assert.equal(viaDevice.ok === false && viaDevice.reason, "secondFactor", "das Gerät kommt am Passwort-Schritt durch");
    const before = (await env.db.knownDevice.findFirstOrThrow()).useCount;
    assert.equal((await session.verifySecondFactor(tf.code())).ok, true);
    assert.equal((await env.db.knownDevice.findFirstOrThrow()).useCount, before + 1);
  });

  it("„Dieses Gerät merken“ aus dem Passwort-Schritt gilt erst nach dem zweiten Faktor", async () => {
    const anna = await person();
    const tf = await enableDirect(anna);
    await passwordStep("anna", PW, { rememberDevice: true });
    assert.equal(await env.db.knownDevice.count(), 0);
    assert.equal(browser.cookies.has("so_device"), false);
    assert.equal((await session.verifySecondFactor(tf.code())).ok, true);
    assert.equal(await env.db.knownDevice.count(), 1);
    assert.ok(browser.cookies.has("so_device"));
  });
});

describe("Zurücksetzen", () => {
  it("die Administration setzt den zweiten Faktor zurück: Passwort der handelnden Person, Rechte-Hierarchie, Audit, Sitzungen des Kontos enden", async () => {
    const chef = await admin();
    const anna = await person();
    await enableDirect(anna);
    await env.signIn(anna);
    await env.signIn(chef); // aktuelle Sitzung: die Administration
    // falsches eigenes Passwort
    assert.ok((await userActions.resetTwoFactor({}, form({ id: anna.id, password: "falsch-falsch-1" }))).fieldErrors?.password);
    assert.equal(await sf.secondFactorRequired(anna.id), true);
    // das eigene Konto nicht
    assert.ok((await userActions.resetTwoFactor({}, form({ id: chef.id, password: ADMIN_PW }))).error);
    assert.equal(await redirectOf(() => userActions.resetTwoFactor(form({ id: anna.id, password: ADMIN_PW }))), `/admin/users/${anna.id}?twoFactorReset=1`);
    const row = await env.db.twoFactor.findUniqueOrThrow({ where: { userId: anna.id } });
    assert.deepEqual({ s: row.secret, e: row.enabledAt, r: row.resetReason }, { s: null, e: null, r: "admin" });
    assert.equal(await env.db.twoFactorBackupCode.count({ where: { userId: anna.id } }), 0);
    assert.equal(await env.db.session.count({ where: { userId: anna.id } }), 0);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "auth.twoFactorReset" } });
    assert.equal(entry.target, "anna");
    // ein zweites Mal gibt es nichts zurückzusetzen
    assert.ok((await userActions.resetTwoFactor({}, form({ id: anna.id, password: ADMIN_PW }))).error);
  });

  it("Rechte-Hierarchie: wer die Rechte des Kontos nicht vollständig hat, darf seinen zweiten Faktor nicht zurücksetzen", async () => {
    const chef = await admin();
    await enableDirect(chef);
    const manager = await env.user({ username: "verwalter", password: PW, roles: [await env.role({ key: "verwalter", permissions: ["users.view", "users.manage"] })] });
    await env.signIn(manager);
    const state = await userActions.resetTwoFactor({}, form({ id: chef.id, password: PW }));
    assert.ok(state.error);
    assert.equal(await sf.secondFactorRequired(chef.id), true);
  });

  it("ein ungültiger Notzugang-Code ändert nichts – das Einlösen eines gültigen setzt den zweiten Faktor zurück (siehe recovery.test.ts)", async () => {
    const chef = await admin();
    await enableDirect(chef);
    const recovery = await import("./recovery");
    assert.equal((await recovery.redeemRecoveryCode({ code: "falsch", password: "neues-passwort-456", ip: null })).ok, false);
    assert.equal(await sf.secondFactorRequired(chef.id), true);
  });

  it("Restore ohne passenden Schlüssel (secret.key): der zweite Faktor wird für ALLE Konten zurückgesetzt, beim ersten Login erscheint der Hinweis, das Audit hält es fest", async () => {
    const anna = await person();
    const bob = await person("bob");
    await enableDirect(anna);
    await enableDirect(bob);
    // Backup von einer anderen Installation: der Schlüssel dieser Installation passt nicht zu den Geheimnissen
    writeFileSync(path.join(process.env.DATA_DIR!, "secret.key"), randomBytes(32).toString("hex"));
    const first = await passwordStep("anna");
    assert.equal(first.ok, true, "Anna meldet sich nur mit dem Passwort an");
    for (const user of [anna, bob]) {
      const row = await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } });
      assert.deepEqual({ s: row.secret, e: row.enabledAt, r: row.resetReason }, { s: null, e: null, r: "key" }, user.username);
      assert.equal(await env.db.twoFactorBackupCode.count({ where: { userId: user.id } }), 0);
    }
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "auth.twoFactorReset" } });
    assert.match(entry.target ?? "", /2 Konten/);
    const status = await sf.twoFactorStatus(anna.id);
    assert.equal(status.resetReason, "key");
    assert.equal(status.enabled, false);
    // Bob: ebenfalls nur Passwort, Hinweis vorhanden; nach Bestätigung verschwindet er
    browser.reset();
    assert.equal((await passwordStep("bob")).ok, true);
    assert.equal((await sf.twoFactorStatus(bob.id)).resetReason, "key");
    await env.signIn(bob);
    const { acknowledgeTwoFactorResetNotice } = sec;
    await acknowledgeTwoFactorResetNotice(form({}));
    assert.equal((await sf.twoFactorStatus(bob.id)).resetReason, null);
    assert.equal((await sf.twoFactorStatus(anna.id)).resetReason, "key");
  });

  it("beim Start (nach einem Restore) werden unlesbare zweite Faktoren sofort zurückgesetzt, lesbare nie – ohne dass sich jemand anmelden muss", async () => {
    const anna = await person();
    const bob = await person("bob");
    await enableDirect(anna);
    assert.equal(await sf.resetUnreadableSecondFactors(), 0, "mit passendem Schlüssel passiert nichts");
    assert.equal(await sf.secondFactorRequired(anna.id), true);
    await enableDirect(bob);
    writeFileSync(path.join(process.env.DATA_DIR!, "secret.key"), randomBytes(32).toString("hex"));
    assert.equal(await sf.resetUnreadableSecondFactors(), 2);
    assert.equal(await sf.resetUnreadableSecondFactors(), 0, "idempotent");
    assert.equal((await sf.twoFactorStatus(bob.id)).resetReason, "key");
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.twoFactorReset" } }), 1);
  });

  it("Konten mit Pflicht-2FA müssen sie nach dem Zurücksetzen sofort neu einrichten (nur die Kontoseite ist erreichbar)", async () => {
    const chef = await admin();
    const tf = await enableDirect(chef);
    void tf;
    await env.db.appSetting.create({ data: { key: "auth.require2faAdmins", value: "true" } });
    writeFileSync(path.join(process.env.DATA_DIR!, "secret.key"), randomBytes(32).toString("hex"));
    assert.equal((await passwordStep("chef", ADMIN_PW)).ok, true);
    const current = await session.getSession();
    assert.equal(current?.user.mustSetupTwoFactor, true);
    assert.equal(await redirectOf(() => session.requireSession()), "/account");
    assert.ok(await session.requireSession({ allowPasswordChange: true }));
    assert.equal(await session.sessionIfAllowed("users.view"), null, "auch die Metadaten fremder Seiten bleiben dicht");
  });
});

describe("Richtlinie: Pflicht für Administratoren und Leerlauf-Abmeldung", () => {
  it("Pflicht-2FA (Standard aus): Administratoren ohne zweiten Faktor kommen nur zur Kontoseite, andere Konten nicht betroffen, Ausschalten ist gesperrt", async () => {
    const chef = await admin();
    const anna = await person();
    await env.signIn(chef);
    assert.equal((await session.getSession())?.user.mustSetupTwoFactor, false, "Standard: aus");

    await settingsActions.saveSecurity({}, form({ behindProxy: false, requireTwoFactorAdmins: true }));
    assert.equal((await env.db.appSetting.findUniqueOrThrow({ where: { key: "auth.require2faAdmins" } })).value, "true");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "settings.security" } });
    assert.match(entry.target ?? "", /2FA für Administratoren freiwillig → Pflicht/);

    assert.equal((await session.getSession())?.user.mustSetupTwoFactor, true);
    assert.equal(await redirectOf(() => session.requireSession()), "/account");
    // auch die Datenwege der Seiten (JSON/Dateien mit Cookie-Sitzung) bleiben bis zur Einrichtung zu
    const status = await import("@/app/api/backups/status/route");
    assert.equal((await status.GET()).status, 401);
    env.signOut();
    await env.signIn(anna);
    assert.equal((await session.getSession())?.user.mustSetupTwoFactor, false);

    // nach der Einrichtung ist der Administrator frei, kann den zweiten Faktor aber nicht mehr ausschalten
    env.signOut();
    await env.signIn(chef);
    await enableDirect(chef);
    assert.equal((await session.getSession())?.user.mustSetupTwoFactor, false);
    assert.equal(await redirectOf(() => session.requireSession()), null);
    assert.equal((await (await import("@/app/api/backups/status/route")).GET()).status, 200);
    const refused = await sec.disableTwoFactor({}, form({ password: ADMIN_PW }));
    assert.ok(refused.error);
    assert.equal(await sf.secondFactorRequired(chef.id), true);
  });

  it("Leerlauf-Abmeldung: Standard aus; mit Frist endet eine Sitzung ohne Anfragen (und wird gelöscht), eine benutzte nicht", async () => {
    const anna = await person();
    await env.signIn(anna);
    const setIdle = (ageHours: number) => env.db.session.updateMany({ data: { lastUsedAt: new Date(clock - ageHours * 3_600_000) } });
    await setIdle(40);
    assert.ok(await session.getSession(), "Standard aus: keine Leerlauf-Abmeldung");

    await env.db.appSetting.create({ data: { key: "auth.idleTimeoutHours", value: "12" } });
    await setIdle(11);
    assert.ok(await session.getSession(), "innerhalb der Frist");
    const touched = await env.db.session.findFirstOrThrow();
    assert.ok(clock - touched.lastUsedAt.getTime() < 60_000, "die Nutzung wird festgehalten (auf die Minute genau)");

    await setIdle(13);
    assert.equal(await session.getSession(), null, "länger als 12 Stunden ohne Anfrage");
    assert.equal(await env.db.session.count(), 0, "die Sitzung ist gelöscht");
    // zurück zur selben Seite: der Proxy reicht den Pfad weiter
    env.browser.setHeaders({ "x-so-path": "/customers/abc?tab=2" });
    assert.equal(await redirectOf(() => session.requireSession()), "/login?expired=1&next=%2Fcustomers%2Fabc%3Ftab%3D2");
  });

  it("die Einstellungen werden geprüft und protokolliert: Leerlauf 0 bis 720 Stunden", async () => {
    const chef = await admin();
    await env.signIn(chef);
    assert.ok((await settingsActions.saveSecurity({}, form({ behindProxy: false, idleTimeoutHours: 999 }))).fieldErrors?.idleTimeoutHours);
    assert.equal((await settingsActions.saveSecurity({}, form({ behindProxy: false, idleTimeoutHours: 8 }))).ok, true);
    assert.equal((await env.db.appSetting.findUniqueOrThrow({ where: { key: "auth.idleTimeoutHours" } })).value, "8");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "settings.security" } });
    assert.match(entry.target ?? "", /Leerlauf-Abmeldung aus → 8 h/);
  });

  it("Rücksprungziel nach abgelaufener Sitzung: gleiche Seite per safeNext, unsichere oder Anmeldeseiten werden nicht übernommen", async () => {
    env.browser.setHeaders({ "x-so-path": "/customers?q=m%C3%BCller" });
    assert.equal(await redirectOf(() => session.requireSession()), "/login?expired=1&next=%2Fcustomers%3Fq%3Dm%25C3%25BCller");
    env.browser.setHeaders({ "x-so-path": "//evil.example/x" });
    assert.equal(await redirectOf(() => session.requireSession()), "/login?expired=1");
    env.browser.setHeaders({ "x-so-path": "/login/verify" });
    assert.equal(await redirectOf(() => session.requireSession()), "/login?expired=1");
    env.browser.setHeaders({});
    assert.equal(await redirectOf(() => session.requireSession()), "/login");
  });
});

describe("Sitzungen und „überall abmelden“", () => {
  it("die Liste markiert die eigene Sitzung; andere lassen sich beenden, die eigene nicht; Fremde nie", async () => {
    const anna = await person();
    const bob = await person("bob");
    await env.signIn(anna); // andere Sitzung
    await env.db.session.updateMany({ where: { userId: anna.id }, data: { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", ipHint: "10.0.0.x" } });
    env.signOut();
    await env.signIn(anna); // aktuelle Sitzung
    await env.signIn(bob);
    env.signOut();
    await env.signIn(anna);
    const bobsSession = await env.db.session.findFirstOrThrow({ where: { userId: bob.id } });

    const rows = await session.listSessions(anna.id);
    assert.equal(rows.length, 3);
    assert.equal(rows.filter((r) => r.current).length, 1);
    const current = rows.find((r) => r.current)!;
    const other = rows.find((r) => !r.current)!;

    assert.ok((await sec.revokeSession({}, form({ id: current.id }))).error, "die eigene Sitzung beendet man mit Abmelden");
    assert.equal((await sec.revokeSession({}, form({ id: bobsSession.id }))).error !== undefined, true, "fremde Sitzungen sind unberührbar");
    assert.equal(await env.db.session.count({ where: { userId: bob.id } }), 1);
    assert.equal((await sec.revokeSession({}, form({ id: other.id }))).ok, true);
    assert.equal(await env.db.session.count({ where: { userId: anna.id } }), 2);
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.sessionRevoked" } }), 1);
  });

  it("überall abmelden: Sitzungen, bekannte Geräte und API-Tokens des Kontos enden, die Cookies werden geräumt, die anderen Konten bleiben unberührt", async () => {
    const anna = await person();
    const bob = await person("bob");
    await session.login("anna", PW, { rememberDevice: true });
    await env.signIn(bob);
    await env.db.session.deleteMany({ where: { userId: bob.id } });
    await env.signIn(anna); // zweite Sitzung des Kontos
    const bobDevice = await env.db.knownDevice.create({ data: { tokenHash: "b".repeat(64), userId: bob.id } });
    const token = await env.db.apiToken.create({ data: { name: "t", tokenHash: "t".repeat(64), hint: "sos_", userId: anna.id, expiresAt: new Date(clock + 86_400_000) } });
    assert.equal(await env.db.knownDevice.count({ where: { userId: anna.id } }), 1);

    assert.equal(await redirectOf(() => sec.logoutEverywhere(form({}))), "/login");
    assert.equal(await env.db.session.count({ where: { userId: anna.id } }), 0);
    assert.equal(await env.db.knownDevice.count({ where: { userId: anna.id } }), 0);
    assert.ok((await env.db.apiToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt);
    assert.equal(browser.cookies.has("so_session"), false);
    assert.equal(browser.cookies.has("so_device"), false);
    assert.ok(await env.db.knownDevice.findUnique({ where: { id: bobDevice.id } }), "fremde Geräte bleiben");
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.logoutEverywhere" } }), 1);
  });

  it("ein Gerät widerrufen: andere Geräte des Kontos ja, fremde nie; das eigene Gerät räumt auch das Cookie", async () => {
    const anna = await person();
    const bob = await person("bob");
    await session.login("anna", PW, { rememberDevice: true });
    const mine = (await devicesOf(anna.id)).find((d) => d.current)!;
    const other = await env.db.knownDevice.create({ data: { tokenHash: "o".repeat(64), userId: anna.id } });
    const foreign = await env.db.knownDevice.create({ data: { tokenHash: "f".repeat(64), userId: bob.id } });
    assert.equal((await sec.revokeDevice({}, form({ id: foreign.id }))).error !== undefined, true);
    assert.ok(await env.db.knownDevice.findUnique({ where: { id: foreign.id } }));
    assert.equal((await sec.revokeDevice({}, form({ id: other.id }))).ok, true);
    assert.ok(browser.cookies.has("so_device"));
    assert.equal((await sec.revokeDevice({}, form({ id: mine.id }))).ok, true);
    assert.equal(browser.cookies.has("so_device"), false);
    assert.equal(await env.db.knownDevice.count({ where: { userId: anna.id } }), 0);
  });
});

async function devicesOf(userId: string) {
  return (await import("./devices")).listDevices(userId);
}

describe("Zeitschritte und Hilfsfunktionen", () => {
  it("Sicherungscode-Hash und Normalisierung sind konsistent mit der Prüfung", () => {
    const [code] = generateBackupCodes(1);
    assert.equal(hashBackupCode("u", normalizeBackupCode(code)!), hashBackupCode("u", normalizeBackupCode(code.toLowerCase())!));
  });
});
