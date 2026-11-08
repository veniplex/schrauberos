import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { base32Encode, generateTotpSecret } from "@/lib/totp";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

/**
 * Zustandsmodell des Geheimnisschlüssels (ZP5-2, Fehlerklasse „Datenverlust“): fehlt / nicht lesbar / lesbar. Ein Schlüssel, den die Anwendung nur nicht lesen kann, ist
 * kein fremder Schlüssel: Dann wird nichts gelöscht, kein neuer angelegt, die Anmeldung bleibt zu, und es gibt einen Weg zurück (Wiederherstellungsschlüssel).
 */
let env: TestEnv;
let secrets: typeof import("./secrets");
let secretReset: typeof import("./secret-reset");
let issueMod: typeof import("./secret-key-issue");
let recoveryKey: typeof import("./recovery-key");
let recoveryMod: typeof import("./secret-key-recovery");
let settings: typeof import("./settings");
let session: typeof import("./auth/session");
let runtime: typeof import("./auth/runtime");
let throttle: typeof import("./auth/throttle");
let keyActions: typeof import("@/modules/admin/backup/key-actions");
let publicActions: typeof import("@/platform/account/key-recovery-actions");

const PASSWORD = "ein-gutes-passwort-123";
const keyPath = () => path.join(env.dir, "secret.key");
const resetDir = () => path.join(env.dir, "secret-reset");
const realConsole = { error: console.error };
const logged: string[] = [];

before(async () => {
  env = await createTestEnv();
  secrets = await import("./secrets");
  secretReset = await import("./secret-reset");
  issueMod = await import("./secret-key-issue");
  recoveryKey = await import("./recovery-key");
  recoveryMod = await import("./secret-key-recovery");
  settings = await import("./settings");
  session = await import("./auth/session");
  runtime = await import("./auth/runtime");
  throttle = await import("./auth/throttle");
  keyActions = await import("@/modules/admin/backup/key-actions");
  publicActions = await import("@/platform/account/key-recovery-actions");
  runtime.authRuntime.sleep = async () => undefined;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});
after(async () => {
  console.error = realConsole.error;
  await env.cleanup();
});

const writeKey = (hex = randomBytes(32).toString("hex")) => {
  rmSync(keyPath(), { recursive: true, force: true });
  writeFileSync(keyPath(), hex);
  return hex;
};

beforeEach(async () => {
  rmSync(keyPath(), { recursive: true, force: true });
  rmSync(resetDir(), { recursive: true, force: true });
  rmSync(path.join(env.dir, "restore"), { recursive: true, force: true });
  for (const f of readdirSync(env.dir).filter((n) => n.startsWith("secret.key."))) rmSync(path.join(env.dir, f), { recursive: true, force: true });
  await env.db.appSetting.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.twoFactorBackupCode.deleteMany();
  await env.db.twoFactor.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  throttle.resetLoginThrottle();
  browserReset();
  logged.length = 0;
  writeKey();
});

const browserReset = () => void import("@/test/harness").then(({ browser }) => browser.reset());

async function adminUser(name = "chef") {
  const role = await env.role({ key: `admin-${name}`, isAdmin: true });
  return env.user({ username: name, password: PASSWORD, roles: [role] });
}

/** Zweiter Faktor mit dem aktuellen Schlüssel eingerichtet (Geheimnis verschlüsselt, Sicherungscodes). */
async function withTwoFactor(userId: string) {
  await env.db.twoFactor.create({ data: { userId, secret: secrets.encryptSecret(base32Encode(generateTotpSecret())), enabledAt: new Date(), lastStep: 0 } });
  await env.db.twoFactorBackupCode.create({ data: { userId, codeHash: randomBytes(16).toString("hex") } });
}

const markRestoreApplied = () => {
  mkdirSync(path.join(env.dir, "restore"), { recursive: true });
  writeFileSync(path.join(env.dir, "restore", "applied.json"), JSON.stringify({ from: "backup", at: new Date().toISOString(), files: false }));
};

describe("Zustand des Schlüssels", () => {
  it("lesbar / fehlt / nicht lesbar werden unterschieden", () => {
    assert.equal(secrets.readSecretKey().state, "readable");
    rmSync(keyPath());
    assert.equal(secrets.readSecretKey().state, "missing");
    mkdirSync(keyPath());
    assert.deepEqual(secrets.readSecretKey(), { state: "unreadable", reason: "EISDIR" });
    rmSync(keyPath(), { recursive: true });
    writeFileSync(keyPath(), "abc");
    assert.deepEqual(secrets.readSecretKey(), { state: "unreadable", reason: "content" });
  });

  it("Verzeichnis statt Schlüsseldatei: ver- und entschlüsseln werfen (nie null, nie ein neuer Schlüssel), Lesen eines Einstellungs-Geheimnisses ist folgenlos", async () => {
    const blob = secrets.encryptSecret("ghp_geheim");
    rmSync(keyPath());
    mkdirSync(keyPath());
    assert.throws(() => secrets.secretKeyHex(), secrets.SecretKeyUnavailableError);
    assert.throws(() => secrets.encryptSecret("x"), secrets.SecretKeyUnavailableError);
    assert.throws(() => secrets.decryptSecret(blob), secrets.SecretKeyUnavailableError);
    assert.equal(secrets.ensureSecretKey().state, "unreadable");
    assert.ok(statSync(keyPath()).isDirectory(), "das Verzeichnis ist unangetastet, nichts wurde angelegt");
    await env.db.appSetting.create({ data: { key: "update.token", value: blob } });
    assert.equal(await settings.getSecret("update.token"), null);
    assert.equal((await env.db.appSetting.findUniqueOrThrow({ where: { key: "update.token" } })).value, blob, "der Wert bleibt in der Datenbank");
    assert.equal((await issueMod.secretKeyIssue())?.kind, "unreadable");
  });

  it("abgeschnittener oder fremder Inhalt: nicht lesbar, die Datei wird nie überschrieben", () => {
    writeFileSync(keyPath(), "abcdef");
    assert.throws(() => secrets.secretKeyHex(), secrets.SecretKeyUnavailableError);
    assert.equal(readFileSync(keyPath(), "utf8"), "abcdef");
  });

  it("fehlende Datei bei frischer Datenbank: ein neuer Schlüssel wird angelegt", () => {
    rmSync(keyPath());
    const hex = secrets.secretKeyHex();
    assert.match(hex, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(keyPath(), "utf8"), hex);
  });

  it("fehlende Datei, aber die Datenbank enthält Geheimnisse: nie still ein neuer Schlüssel", async () => {
    const user = await adminUser();
    await withTwoFactor(user.id);
    rmSync(keyPath());
    assert.throws(() => secrets.secretKeyHex(), (error) => error instanceof secrets.SecretKeyUnavailableError && error.state === "missing");
    assert.throws(() => secrets.encryptSecret("x"), secrets.SecretKeyUnavailableError);
    assert.equal(secrets.ensureSecretKey().state, "missing");
    assert.equal(existsSync(keyPath()), false, "es wurde nichts angelegt");
    assert.equal((await issueMod.secretKeyIssue())?.kind, "missing");
  });

  it("auch eine Einstellung mit Geheimnis oder eine Hülle genügt, um das Anlegen zu verbieten", async () => {
    await env.db.appSetting.create({ data: { key: "update.token", value: secrets.encryptSecret("x") } });
    rmSync(keyPath());
    assert.equal(secrets.databaseHoldsSecrets(), true);
    await env.db.appSetting.deleteMany();
    assert.equal(secrets.databaseHoldsSecrets(), false);
    await env.db.appSetting.create({ data: { key: "secrets.wrapped", value: "w1:x:y:z:u" } });
    assert.equal(secrets.databaseHoldsSecrets(), true);
  });
});

describe("Anmeldung und Start bei nicht verfügbarem Schlüssel", () => {
  it("Verzeichnis statt Schlüsseldatei: die Anmeldung bleibt zu (fail-closed), der Start löscht nichts, es entsteht keine Sicherungsdatei", async () => {
    const user = await adminUser();
    await withTwoFactor(user.id);
    await env.db.appSetting.create({ data: { key: "update.token", value: secrets.encryptSecret("ghp_geheim") } });
    rmSync(keyPath());
    mkdirSync(keyPath());

    const result = await session.login("chef", PASSWORD, {});
    assert.equal(result.ok, false);
    assert.equal((result as { reason?: string }).reason, "secondFactor", "mit dem Passwort allein kommt niemand hinein");
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    markRestoreApplied(); // auch nach einer Wiederherstellung: ohne lesbaren Schlüssel wird nie etwas zurückgesetzt
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.deepEqual(await secretReset.resetUnreadableSecrets(undefined, { force: true }), []);
    assert.ok((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret);
    assert.equal(await env.db.twoFactorBackupCode.count(), 1);
    assert.ok(await env.db.appSetting.findUnique({ where: { key: "update.token" } }));
    assert.equal(existsSync(resetDir()), false);
    assert.equal(await env.db.auditLog.count({ where: { action: { in: ["secrets.reset", "secrets.resetForced", "auth.twoFactorReset"] } } }), 0);
    assert.ok(statSync(keyPath()).isDirectory());
  });

  it("die Administration kann bei nicht lesbarem Schlüssel nichts zurücksetzen und nichts überschreiben", async () => {
    const user = await adminUser();
    await withTwoFactor(user.id);
    rmSync(keyPath());
    mkdirSync(keyPath());
    await assert.rejects(() => secretReset.resetSecretsByAdministrator(), secrets.SecretKeyUnavailableError);
    assert.ok(statSync(keyPath()).isDirectory());
    assert.ok((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret);
  });
});

/** Schlüssel erzeugen (Hülle in der Datenbank) und ein Geheimnis ablegen; liefert Wiederherstellungsschlüssel und den ursprünglichen Schlüssel. */
async function setupWithWrap() {
  const user = await adminUser();
  const original = secrets.secretKeyHex();
  const key = await recoveryKey.issueRecoveryKey(env.db);
  await settings.setSecret("update.token", "ghp_geheim");
  await withTwoFactor(user.id);
  return { user, key, original };
}

describe("Fehlende Datei mit Hülle des Wiederherstellungsschlüssels", () => {
  it("nichts wird gelöscht; der Wiederherstellungsschlüssel rekonstruiert secret.key, danach ist alles wieder lesbar", async () => {
    const { user, key, original } = await setupWithWrap();
    rmSync(keyPath());

    assert.deepEqual(await issueMod.secretKeyIssue(), { kind: "missing", recoverable: true });
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    markRestoreApplied();
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), [], "auch mit Wiederherstellungsvermerk: ohne Schlüssel kein Zurücksetzen");
    assert.equal(existsSync(keyPath()), false);
    assert.ok((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret);
    assert.ok(await env.db.appSetting.findUnique({ where: { key: "secrets.wrapped" } }), "die Hülle bleibt");
    assert.equal((await session.login("chef", PASSWORD, {})).ok, false, "Konto mit zweitem Faktor bleibt zu");

    // falscher und fehlerhafter Schlüssel
    const other = (await import("@/lib/recovery-key")).formatRecoveryKey(randomBytes(32));
    assert.deepEqual(await recoveryMod.reconstructSecretKey(other), { ok: false, reason: "wrong" });
    assert.deepEqual(await recoveryMod.reconstructSecretKey("abc"), { ok: false, reason: "format" });
    assert.equal(existsSync(keyPath()), false);

    assert.deepEqual(await recoveryMod.reconstructSecretKey(key), { ok: true });
    assert.equal(readFileSync(keyPath(), "utf8"), original);
    assert.equal(await settings.getSecret("update.token"), "ghp_geheim");
    assert.equal(await issueMod.secretKeyIssue(), null);
    assert.equal(await env.db.auditLog.count({ where: { action: "secrets.keyReconstructed" } }), 1);
    assert.ok(!JSON.stringify(await env.db.auditLog.findMany()).includes(key));
    assert.deepEqual(await recoveryMod.reconstructSecretKey(key), { ok: false, reason: "notNeeded" }, "ohne Störung tut die Funktion nichts");
  });

  it("die öffentliche Aktion „Schlüssel wiederherstellen“ meldet Tippfehler, falschen Schlüssel und Erfolg", async () => {
    const { key } = await setupWithWrap();
    assert.match((await publicActions.reconstructKey({}, form({ key: "" }))).error ?? "", /./);
    rmSync(keyPath());
    assert.ok((await publicActions.reconstructKey({}, form({ key: "abc" }))).error);
    assert.ok((await publicActions.reconstructKey({}, form({ key: (await import("@/lib/recovery-key")).formatRecoveryKey(randomBytes(32)) }))).error);
    assert.equal(existsSync(keyPath()), false);
    const done = await publicActions.reconstructKey({}, form({ key }));
    assert.equal(done.ok, true);
    assert.equal(existsSync(keyPath()), true);
    assert.ok((await publicActions.reconstructKey({}, form({ key }))).error, "ohne Störung: nicht nötig");
  });
});

describe("Fremder, lesbarer Schlüssel (fremdes Volume)", () => {
  it("mit Hülle: ohne Wiederherstellung wird nichts zurückgesetzt, die Rekonstruktion stellt den richtigen Schlüssel her (der falsche wandert zur Seite)", async () => {
    const { user, key, original } = await setupWithWrap();
    const foreign = writeKey();
    assert.deepEqual(await issueMod.secretKeyIssue(), { kind: "mismatch", recoverable: true });

    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.ok(logged.some((line) => line.includes("passt nicht zur Datenbank")));
    assert.ok((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret);
    assert.ok(await env.db.appSetting.findUnique({ where: { key: "update.token" } }));
    assert.ok(await env.db.appSetting.findUnique({ where: { key: "secrets.wrapped" } }));
    assert.equal(existsSync(resetDir()), false);
    assert.equal((await session.login("chef", PASSWORD, {})).ok, false);

    assert.deepEqual(await recoveryMod.reconstructSecretKey(key), { ok: true });
    assert.equal(readFileSync(keyPath(), "utf8"), original);
    const aside = readdirSync(env.dir).filter((n) => n.startsWith("secret.key.replaced-"));
    assert.equal(aside.length, 1);
    assert.equal(readFileSync(path.join(env.dir, aside[0]), "utf8"), foreign, "der fremde Schlüssel wurde nicht gelöscht");
    assert.equal(await settings.getSecret("update.token"), "ghp_geheim");
  });

  it("nach einer Wiederherstellung ohne Schlüssel (Vermerk): Zurücksetzen – aber erst nach Sicherung der Zeilen (Datei, 0600, nur verschlüsselte Blobs)", async () => {
    const { user } = await setupWithWrap();
    const encrypted = (await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret!;
    writeKey();
    markRestoreApplied();
    const items = await secretReset.resetUnreadableSecrets();
    assert.deepEqual(items.map((i) => i.id).sort(), ["auth.totp", "updates.token"]);
    assert.equal(await env.db.appSetting.count({ where: { key: "secrets.wrapped" } }), 0, "die veraltete Hülle ist entfernt");

    const files = readdirSync(resetDir());
    assert.equal(files.length, 1);
    const file = path.join(resetDir(), files[0]);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    const content = readFileSync(file, "utf8");
    assert.ok(content.includes(encrypted), "der verschlüsselte Blob ist gesichert");
    assert.ok(!content.includes("ghp_geheim"), "kein Klartext");
    const body = JSON.parse(content) as { settings: Array<{ key: string }>; twoFactor: unknown[]; backupCodes: unknown[] };
    assert.ok(body.settings.some((s) => s.key === "update.token") && body.settings.some((s) => s.key === "secrets.wrapped"));
    assert.equal(body.twoFactor.length, 1);
    assert.equal(body.backupCodes.length, 1);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "secrets.reset" } });
    assert.match(entry.target ?? "", new RegExp(`secret-reset/${files[0]}`));
    assert.equal((await secretReset.readResetNotice())?.backup, files[0]);
  });

  it("ohne Hülle: lesbarer fremder Schlüssel – nichts zu retten, der Start setzt zurück (mit Sicherung)", async () => {
    const user = await adminUser();
    await withTwoFactor(user.id);
    await settings.setSecret("update.token", "ghp_geheim");
    writeKey();
    assert.equal(await issueMod.secretKeyIssue(), null);
    const items = await secretReset.resetUnreadableSecrets();
    assert.equal(items.length, 2);
    assert.equal(readdirSync(resetDir()).length, 1);
    assert.equal((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret, null);
  });

  it("Formatversionen (Z7): ein künftiges v2 (Einstellung und zweiter Faktor) und beschädigte Werte werden nie zurückgesetzt – nur gut geformte v1-Werte eines fremden Schlüssels", async () => {
    const user = await adminUser();
    const foreignKey = randomBytes(32).toString("hex");
    // gut geformtes v1, mit einem anderen Schlüssel verschlüsselt
    const foreignV1 = secrets.encryptSecret("fremd");
    writeKey(foreignKey);
    const future = "v2:" + "A".repeat(16) + ":" + "B".repeat(22) + "==:" + "Zm9v";
    await env.db.appSetting.createMany({ data: [{ key: "update.token", value: foreignV1 }, { key: "mail.password", value: future }, { key: "webhooks.secret", value: "keine-geheimnisform" }] });
    await env.db.twoFactor.create({ data: { userId: user.id, secret: future, enabledAt: new Date(), lastStep: 0 } });

    assert.equal(secrets.secretBlobShape(foreignV1), "ok");
    assert.equal(secrets.secretBlobShape(future), "unsupported");
    assert.equal(secrets.secretBlobShape("v10:x"), "unsupported");
    assert.equal(secrets.secretBlobShape("keine-geheimnisform"), "damaged");
    assert.equal(secrets.isForeignSecret(foreignV1), true);
    assert.equal(secrets.isForeignSecret(future), false, "höhere Version: nicht lesbar für diesen Code, aber nie „fremd“");
    assert.equal(secrets.decryptSecret(future), null, "Lesen liefert nichts (die Funktion gilt als nicht eingerichtet) …");

    const consumers = await import("./secret-consumers");
    // … zurückgesetzt wird es trotzdem nie: weder durch den Einstellungs-Helfer noch durch den Start-Reset
    assert.equal(await consumers.resetUnreadableSettingSecrets(["mail.password", "webhooks.secret"]), 0);
    assert.equal(await env.db.appSetting.count({ where: { key: { in: ["mail.password", "webhooks.secret"] } } }), 2);
    await secretReset.resetUnreadableSecrets(undefined, { force: true });
    assert.equal((await env.db.appSetting.findUniqueOrThrow({ where: { key: "mail.password" } })).value, future);
    assert.equal((await env.db.appSetting.findUniqueOrThrow({ where: { key: "webhooks.secret" } })).value, "keine-geheimnisform");
    assert.equal((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret, future, "der künftige zweite Faktor bleibt");
    assert.equal(await env.db.appSetting.count({ where: { key: "update.token" } }), 0, "das fremde v1 wurde (mit Sicherung) zurückgesetzt");
  });

  it("ein Fehler beim Sichern verhindert das Zurücksetzen", async () => {
    const user = await adminUser();
    await withTwoFactor(user.id);
    writeKey();
    writeFileSync(resetDir(), "ich bin eine Datei, kein Ordner");
    await assert.rejects(() => secretReset.resetUnreadableSecrets());
    assert.ok((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret, "nichts wurde zurückgesetzt");
  });

  it("lesbare, passende Schlüssel: nichts zu tun, keine Sicherungsdatei", async () => {
    await setupWithWrap();
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.equal(existsSync(resetDir()), false);
  });
});

describe("Fehlende Datei ohne Hülle: Neuanfang nur durch die Administration", () => {
  it("der Start legt nichts an und setzt nichts zurück; die Aktion (Passwort, Administrator) legt einen neuen Schlüssel an, sichert die Zeilen und setzt zurück", async () => {
    const user = await adminUser();
    await withTwoFactor(user.id);
    await settings.setSecret("update.token", "ghp_geheim");
    rmSync(keyPath());
    assert.deepEqual(await issueMod.secretKeyIssue(), { kind: "missing", recoverable: false });
    assert.deepEqual(await recoveryMod.reconstructSecretKey("x"), { ok: false, reason: "noWrappedKey" });
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.equal(existsSync(keyPath()), false);

    await env.signIn(user);
    const wrong = await keyActions.resetSecrets({}, form({ password: "falsch-falsch-1" }));
    assert.ok(wrong.error || wrong.fieldErrors);
    assert.equal(existsSync(keyPath()), false, "falsches Passwort: nichts geschieht");
    const done = await keyActions.resetSecrets({}, form({ password: PASSWORD }));
    assert.equal(done.ok, true, done.error);
    assert.match(readFileSync(keyPath(), "utf8"), /^[0-9a-f]{64}$/);
    assert.equal(readdirSync(resetDir()).length, 1);
    assert.equal((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } })).secret, null);
    assert.equal(await settings.getSecret("update.token"), null);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "secrets.resetForced" } });
    assert.match(entry.target ?? "", /neuer Schlüssel/);
    assert.equal(await issueMod.secretKeyIssue(), null);
  });

  it("nur Administratoren mit Passwort", async () => {
    const role = await env.role({ key: "kein-admin", permissions: ["backup.keys"] });
    const user = await env.user({ username: "bediener", password: PASSWORD, roles: [role] });
    await env.signIn(user);
    const state = await keyActions.resetSecrets({}, form({ password: PASSWORD }));
    assert.ok(state.error);
  });
});
