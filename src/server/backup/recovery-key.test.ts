import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import * as tar from "tar";
import { NextRequest } from "next/server";
import { formatRecoveryKey } from "@/lib/recovery-key";
import { applyPendingRestore, readPending, restoreDir } from "@/lib/updates/restore";
import { startupState } from "@/server/startup-state";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

/**
 * Wiederherstellungsschlüssel (P1b-4a): erzeugen und bestätigen (nur Administratoren mit Passwort), der Klartext nirgends gespeichert, Restore mit und ohne Schlüssel,
 * falscher Schlüssel (gedrosselt, global), Zurücksetzen nicht lesbarer Geheimnisse mit Hinweis und Audit, Wiederherstellung in der Einrichtung (nur mit Token).
 */
let env: TestEnv;
let keyActions: typeof import("@/modules/admin/backup/key-actions");
let backupActions: typeof import("@/modules/admin/backup/actions");
let core: typeof import("./core");
let restore: typeof import("./restore");
let recoveryKey: typeof import("@/server/recovery-key");
let secretReset: typeof import("@/server/secret-reset");
let secrets: typeof import("@/server/secrets");
let settings: typeof import("@/server/settings");
let throttle: typeof import("@/server/auth/throttle");
let runtime: typeof import("@/server/auth/runtime");
let setupToken: typeof import("@/server/setup-token");
let setupRoute: typeof import("@/app/api/setup/restore/route");
let uploadRoute: typeof import("@/app/api/backups/upload/route");

const PASSWORD = "ein-gutes-passwort-123";
const realExit = process.exit;
const logged: string[] = [];
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let sleeps: number[] = [];

before(async () => {
  env = await createTestEnv();
  startupState().status = "ready";
  keyActions = await import("@/modules/admin/backup/key-actions");
  backupActions = await import("@/modules/admin/backup/actions");
  core = await import("./core");
  restore = await import("./restore");
  recoveryKey = await import("@/server/recovery-key");
  secretReset = await import("@/server/secret-reset");
  secrets = await import("@/server/secrets");
  settings = await import("@/server/settings");
  throttle = await import("@/server/auth/throttle");
  runtime = await import("@/server/auth/runtime");
  setupToken = await import("@/server/setup-token");
  setupRoute = await import("@/app/api/setup/restore/route");
  uploadRoute = await import("@/app/api/backups/upload/route");
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  runtime.authRuntime.sleep = async (ms) => void sleeps.push(ms);
  // Der Neustart nach einer vorgemerkten Wiederherstellung (`scheduleRestart`) darf den Testlauf nicht beenden
  process.exit = (() => undefined) as never;
  for (const name of ["log", "error", "warn", "info"] as const) console[name] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});
after(async () => {
  // Ein angestoßener Neustart (`scheduleRestart`, 1,5 s) soll noch ins Leere laufen, bevor `process.exit` wieder echt ist
  await new Promise((resolve) => setTimeout(resolve, 1700));
  process.exit = realExit;
  Object.assign(console, realConsole);
  await env.cleanup();
});

let adminId = "";
async function signInAdmin() {
  const role = await env.role({ key: `admin-${Math.random().toString(36).slice(2)}`, isAdmin: true });
  const user = await env.user({ username: `admin-${Math.random().toString(36).slice(2, 8)}`, password: PASSWORD, roles: [role] });
  adminId = user.id;
  env.signOut();
  await env.signIn(user);
}

const dataDirectory = () => env.dir;
const secretKeyPath = () => path.join(dataDirectory(), "secret.key");
const newSecretKey = () => writeFileSync(secretKeyPath(), randomBytes(32).toString("hex"));

async function resetState() {
  await env.db.appSetting.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.twoFactorBackupCode.deleteMany();
  await env.db.twoFactor.deleteMany();
  for (const backup of await core.listBackups()) await core.deleteBackup(backup.name);
  const { cancelPending } = await import("@/lib/updates/restore");
  cancelPending(dataDirectory());
  rmSync(path.join(restoreDir(), "applied.json"), { force: true }); // Journal einer früheren Wiederherstellung (die Tests bestätigen sie nie)
  newSecretKey();
  sleeps = [];
  logged.length = 0;
  throttle.resetLoginThrottle();
  runtime.authRuntime.sleep = async (ms) => void sleeps.push(ms);
}

/** Erzeugt den Schlüssel über die Aktion und liefert den Klartext. */
async function createKey(): Promise<string> {
  const state = (await keyActions.createRecoveryKey({}, form({ password: PASSWORD }))) as { ok?: boolean; recoveryKey?: string; error?: string };
  assert.ok(state.ok && state.recoveryKey, state.error ?? "Schlüssel erwartet");
  return state.recoveryKey;
}

beforeEach(async () => {
  await resetState();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await signInAdmin();
});

describe("Wiederherstellungsschlüssel erzeugen", () => {
  it("nur mit richtigem Passwort; der Klartext steht nur in der Antwort – nie in Datenbank, Audit oder Log", async () => {
    const wrong = (await keyActions.createRecoveryKey({}, form({ password: "falsch" }))) as { fieldErrors?: Record<string, string>; recoveryKey?: string };
    assert.ok(wrong.fieldErrors?.password);
    assert.equal(wrong.recoveryKey, undefined);
    assert.equal((await recoveryKey.recoveryKeyStatus()).exists, false);

    const key = await createKey();
    assert.match(key, /^([0-9A-Z]{5}-){12}[0-9A-Z]{5}$/);
    const normalized = key.replace(/-/g, "");
    const data = normalized.replace(/(.{4}).(?=.)/g, "$1").slice(0, 52); // ohne Prüfzeichen
    const everything = JSON.stringify([await env.db.appSetting.findMany(), await env.db.auditLog.findMany(), await env.db.session.findMany(), logged]);
    for (const needle of [key, normalized, key.toLowerCase(), data, secrets.secretKeyHex()]) assert.ok(!everything.includes(needle), `Klartext gefunden: ${needle.slice(0, 8)}…`);
    assert.ok(!everything.includes(PASSWORD));

    const audit = await env.db.auditLog.findMany({ where: { action: "secrets.keyCreated" } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, adminId);
    const status = await recoveryKey.recoveryKeyStatus();
    assert.deepEqual({ exists: status.exists, confirmed: status.confirmed, stale: status.stale }, { exists: true, confirmed: false, stale: false });
    assert.equal(await recoveryKey.recoveryKeyConfirmed(), false);
  });

  it("die Bestätigung „gesichert“ wird serverseitig vermerkt – erst danach gilt der Schlüssel als bestätigt", async () => {
    assert.equal(await recoveryKey.recoveryKeyConfirmed(), false);
    await keyActions.confirmRecoveryKeyAction(form({})); // ohne Schlüssel: nichts zu bestätigen
    assert.equal(await recoveryKey.recoveryKeyConfirmed(), false);
    await createKey();
    assert.equal(await recoveryKey.recoveryKeyConfirmed(), false, "erzeugt ist noch nicht bestätigt");
    await keyActions.confirmRecoveryKeyAction(form({}));
    assert.equal(await recoveryKey.recoveryKeyConfirmed(), true);
    assert.equal(await env.db.auditLog.count({ where: { action: "secrets.keyConfirmed" } }), 1);
  });

  it("Neu-Erzeugen ersetzt die Hülle (der alte Schlüssel öffnet sie nicht mehr) und setzt die Bestätigung zurück", async () => {
    const first = await createKey();
    await keyActions.confirmRecoveryKeyAction(form({}));
    const wrapped1 = (await env.db.appSetting.findUniqueOrThrow({ where: { key: "secrets.wrapped" } })).value;
    const second = await createKey();
    assert.notEqual(first, second);
    assert.equal(await recoveryKey.recoveryKeyConfirmed(), false);
    const wrapped2 = (await env.db.appSetting.findUniqueOrThrow({ where: { key: "secrets.wrapped" } })).value;
    assert.notEqual(wrapped1, wrapped2);
    const { parseRecoveryKey } = await import("@/lib/recovery-key");
    const { unwrapSecretKey } = await import("@/lib/secret-wrap");
    const parse = (text: string) => {
      const parsed = parseRecoveryKey(text);
      assert.ok(parsed.ok);
      return parsed.key;
    };
    assert.equal(unwrapSecretKey(wrapped2, parse(first)), null);
    assert.equal(unwrapSecretKey(wrapped2, parse(second)), secrets.secretKeyHex());
  });

  it("nur Administratoren: auch mit dem Recht backup.keys lehnt ein Konto ohne Administratorrolle ab", async () => {
    const role = await env.role({ key: "nur-keys", permissions: ["backup.keys"] });
    const user = await env.user({ username: "kein-admin", password: PASSWORD, roles: [role] });
    env.signOut();
    await env.signIn(user);
    const state = (await keyActions.createRecoveryKey({}, form({ password: PASSWORD }))) as { error?: string; recoveryKey?: string };
    assert.ok(state.error);
    assert.equal(state.recoveryKey, undefined);
    assert.equal((await recoveryKey.recoveryKeyStatus()).exists, false);
  });
});

/** Ein Backup mit Schlüssel-Hülle und einem Geheimnis; danach „neuer Datenträger“ (anderer secret.key). */
async function backupWithKey() {
  const key = await createKey();
  await settings.setSecret("update.token", "ghp_geheim");
  const info = await core.createBackup("manual");
  return { key, backup: info.name };
}

describe("Restore mit und ohne Schlüssel", () => {
  it("mit Schlüssel: secret.key wird im selben Schritt wiederhergestellt, alle Geheimnisse bleiben lesbar, nichts wird zurückgesetzt", async () => {
    const original = secrets.secretKeyHex();
    const { key, backup } = await backupWithKey();
    newSecretKey(); // Volume verloren: neuer Schlüssel
    assert.notEqual(secrets.secretKeyHex(), original);
    assert.equal(await settings.getSecret("update.token"), null, "mit dem neuen Schlüssel unlesbar");

    const staged = await restore.stageRestore(backup, { recoveryKey: key });
    assert.equal(staged.secretKeyRestored, true);
    assert.equal(readPending()?.secretKey, true);
    assert.equal(readFileSync(path.join(restoreDir(), "pending-secret.key"), "utf8"), original);

    // Der Launcher tauscht aus (hier: Platzhalter-Datenbankdatei, die laufende bleibt unberührt)
    writeFileSync(path.join(dataDirectory(), "dummy.db"), "x");
    applyPendingRestore(path.join(dataDirectory(), "dummy.db"));
    assert.equal(secrets.secretKeyHex(), original);
    assert.equal(await settings.getSecret("update.token"), "ghp_geheim");
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.equal(await secretReset.readResetNotice(), null);
    assert.equal(await env.db.auditLog.count({ where: { action: "secrets.reset" } }), 0);
    assert.ok(!logged.join("\n").includes(key));
  });

  it("ohne Schlüssel: secret.key bleibt, nicht lesbare Geheimnisse werden zurückgesetzt – im Audit-Log und als Hinweis für Administratoren", async () => {
    const { backup } = await backupWithKey();
    await env.db.twoFactor.create({ data: { userId: adminId, secret: secrets.encryptSecret("totp-geheimnis") /* gut geformt, vom alten Schlüssel – ein unförmiger Wert wäre „beschädigt“ und wird nie zurückgesetzt */, enabledAt: new Date() } });
    newSecretKey();
    const current = secrets.secretKeyHex();

    const staged = await restore.stageRestore(backup);
    assert.equal(staged.secretKeyRestored, false);
    assert.equal(existsSyncSafe(path.join(restoreDir(), "pending-secret.key")), false);
    assert.equal(readPending()?.secretKey, undefined);
    writeFileSync(path.join(dataDirectory(), "dummy.db"), "x");
    applyPendingRestore(path.join(dataDirectory(), "dummy.db"));
    assert.equal(secrets.secretKeyHex(), current, "secret.key unverändert");

    const items = await secretReset.resetUnreadableSecrets();
    assert.deepEqual(items.map((i) => i.id).sort(), ["auth.totp", "updates.token"], "Off-Site war nicht eingerichtet: nichts zu melden");
    assert.equal(await env.db.appSetting.count({ where: { key: "update.token" } }), 0);
    assert.equal((await env.db.twoFactor.findUniqueOrThrow({ where: { userId: adminId } })).secret, null);

    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "secrets.reset" } });
    assert.match(entry.target ?? "", /updates\.token: 1/);
    assert.match(entry.target ?? "", /Wiederherstellungsschlüssel veraltet/);
    assert.ok(!(entry.target ?? "").includes("ghp_"));
    const notice = await secretReset.readResetNotice();
    assert.equal(notice?.keyDropped, true);
    assert.deepEqual(notice?.items.map((i) => i.id).sort(), ["auth.totp", "updates.token"]);
    // Die Hülle gehörte zum alten Schlüssel: veraltet, entfernt – ein neuer Schlüssel ist nötig
    assert.equal((await recoveryKey.recoveryKeyStatus()).exists, false);
    // Erneuter Start: nichts mehr zu tun, der Hinweis bleibt bis zur Bestätigung
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.ok(await secretReset.readResetNotice());
  });

  it("der Hinweis ist nur für Administratoren sichtbar und lässt sich nur von ihnen bestätigen", async () => {
    await backupWithKey();
    newSecretKey();
    mkdirSync(restoreDir(), { recursive: true }); // eine Wiederherstellung ohne Schlüssel wurde eingesetzt (Journal)
    writeFileSync(path.join(restoreDir(), "applied.json"), JSON.stringify({ from: "backup", at: new Date().toISOString(), files: false }));
    await secretReset.resetUnreadableSecrets();
    const { acknowledgeSecretsReset } = await import("@/platform/account/secrets-actions");
    const role = await env.role({ key: "kein-admin-ack", permissions: [] });
    const user = await env.user({ username: "bediener", password: PASSWORD, roles: [role] });
    env.signOut();
    await env.signIn(user);
    await acknowledgeSecretsReset(form({}));
    assert.ok(await secretReset.readResetNotice(), "ein Nicht-Administrator kann den Hinweis nicht wegklicken");
    await signInAdmin();
    await acknowledgeSecretsReset(form({}));
    assert.equal(await secretReset.readResetNotice(), null);
  });

  it("falscher Schlüssel: Fehler, nichts wird vorgemerkt, kein Stand „vor Wiederherstellung“ angelegt", async () => {
    const { backup } = await backupWithKey();
    const before = (await core.listBackups()).length;
    const other = formatRecoveryKey(randomBytes(32));
    await assert.rejects(restore.stageRestore(backup, { recoveryKey: other }), (error) => error instanceof restore.RestoreError && error.code === "wrongKey");
    await assert.rejects(restore.stageRestore(backup, { recoveryKey: other.slice(0, -2) }), (error) => error instanceof restore.RestoreError && error.code === "keyFormat");
    assert.equal(readPending(), null);
    assert.equal(existsSyncSafe(path.join(restoreDir(), "pending-secret.key")), false);
    assert.equal((await core.listBackups()).length, before);
    // über die Aktion: Feldfehler am Schlüsselfeld, Audit des Fehlschlags (nur Backup-Name, nie der Schlüssel)
    const state = (await backupActions.restoreBackup({}, form({ name: backup, recoveryKey: other }))) as { fieldErrors?: Record<string, string> };
    assert.ok(state.fieldErrors?.recoveryKey);
    const failed = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.restoreFailed" } });
    assert.equal(failed.target, backup);
    assert.ok(!JSON.stringify(await env.db.auditLog.findMany()).includes(other));
  });

  it("Backup ohne Hülle (älter oder ohne Schlüssel erstellt): noWrappedKey", async () => {
    const old = await core.createBackup("manual"); // ohne Wiederherstellungsschlüssel
    await assert.rejects(restore.stageRestore(old.name, { recoveryKey: formatRecoveryKey(randomBytes(32)) }), (error) => error instanceof restore.RestoreError && error.code === "noWrappedKey");
    assert.equal(readPending(), null);
  });

  it("die Aktion „Wiederherstellen“ mit Schlüssel merkt secret.key vor und protokolliert „mit Wiederherstellungsschlüssel“", async () => {
    const { key, backup } = await backupWithKey();
    newSecretKey();
    const outcome = await backupActions.restoreBackup({}, form({ name: backup, recoveryKey: key }));
    assert.ok((outcome as { ok?: boolean }).ok);
    assert.equal(readPending()?.secretKey, true);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.restore" } });
    assert.match(entry.target ?? "", /mit Wiederherstellungsschlüssel/);
    assert.ok(!(entry.target ?? "").includes(key));
  });

  it("Eingabe des Schlüssels ist global gedrosselt (verlangsamt, weist nie ab) – ohne die scrypt-Semaphoren der Anmeldung", async () => {
    const { backup } = await backupWithKey();
    const other = formatRecoveryKey(randomBytes(32));
    for (let i = 0; i < 9; i++) {
      await assert.rejects(restore.stageRestore(backup, { recoveryKey: other }), (error) => error instanceof restore.RestoreError && error.code === "wrongKey");
    }
    // die ersten sechs Versuche pro Minute sind frei, danach wächst die Wartezeit (500 ms je Versuch über dem Budget), höchstens 8 s
    assert.deepEqual(sleeps, [500, 1000, 1500]);
    // ein richtiger Schlüssel kommt trotzdem durch (kein Sperren), und ein Erfolg gibt seinen Versuch zurück
    const { key } = { key: await createKey() };
    const good = await core.createBackup("manual");
    newSecretKey();
    await restore.stageRestore(good.name, { recoveryKey: key });
    assert.equal(readPending()?.secretKey, true);
  });
});

function existsSyncSafe(file: string): boolean {
  return existsSync(file);
}

/* ───────────── Wiederherstellung in der Einrichtung ───────────── */

async function archiveOf(name: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const pack = tar.c({ cwd: core.backupPath(name)!, portable: true }, ["."]);
    pack.on("data", (c: Buffer) => chunks.push(c));
    pack.on("end", resolve);
    pack.on("error", reject);
  });
  return Buffer.concat(chunks);
}

describe("Stand „Vor Wiederherstellung“ bleibt lesbar (ZP5-8)", () => {
  const previousKeyFile = () => path.join(restoreDir(), "previous-secret-20260102T110000Z.key");
  const keepKey = (hex: string) => {
    mkdirSync(restoreDir(), { recursive: true });
    writeFileSync(previousKeyFile(), hex, { mode: 0o600 });
  };
  afterEach(() => rmSync(previousKeyFile(), { force: true }));

  it("ein Backup, das zu einem aufgehobenen früheren Schlüssel gehört, bringt diesen Schlüssel mit zurück – ohne dass jemand einen Schlüssel eingibt", async () => {
    const old = secrets.secretKeyHex();
    await settings.setSecret("update.token", "ghp_alt");
    const backup = (await core.createBackup("manual")).name; // Geheimnis unter dem alten Schlüssel, keine Hülle
    newSecretKey(); // inzwischen läuft der Server mit einem anderen Schlüssel (nach einer Wiederherstellung mit Wiederherstellungsschlüssel)
    keepKey(old);

    const staged = await restore.stageRestore(backup);
    assert.equal(staged.secretKeyRestored, true);
    assert.equal(readFileSync(path.join(restoreDir(), "pending-secret.key"), "utf8"), old);
    assert.equal(readPending()?.secretKey, true);
    writeFileSync(path.join(dataDirectory(), "dummy.db"), "x");
    applyPendingRestore(path.join(dataDirectory(), "dummy.db"));
    assert.equal(secrets.secretKeyHex(), old);
    assert.equal(await settings.getSecret("update.token"), "ghp_alt", "der Stand ist mit allen Geheimnissen lesbar");
  });

  it("ein Backup, das schon zum laufenden Schlüssel passt, oder eines ohne passenden aufgehobenen Schlüssel ändert am Schlüssel nichts", async () => {
    await settings.setSecret("update.token", "ghp_jetzt");
    const backup = (await core.createBackup("manual")).name;
    keepKey("e".repeat(64)); // passt zu nichts
    assert.equal((await restore.stageRestore(backup)).secretKeyRestored, false, "der laufende Schlüssel passt");
    assert.equal(existsSyncSafe(path.join(restoreDir(), "pending-secret.key")), false);
    const { cancelPending } = await import("@/lib/updates/restore");
    cancelPending();

    newSecretKey(); // jetzt passt der laufende nicht mehr, der aufgehobene aber auch nicht
    assert.equal((await restore.stageRestore(backup)).secretKeyRestored, false);
    assert.equal(existsSyncSafe(path.join(restoreDir(), "pending-secret.key")), false);
  });
});

describe("Wiederherstellung in der Einrichtung (frisches Volume)", () => {
  const post = (body: Buffer, headers: Record<string, string> = {}) =>
    setupRoute.POST(
      new NextRequest("http://localhost/api/setup/restore", {
        method: "POST",
        headers: { "x-requested-with": "schrauberos", host: "localhost", ...headers },
        body: new Uint8Array(body),
        ...({ duplex: "half" } as object),
      }),
    );
  let archive: Buffer;
  let key: string;
  let token: string;

  beforeEach(async () => {
    // Das Backup stammt von „einem anderen Server“ (mit Benutzern und Schlüssel); dieser Server ist frisch: keine Benutzer
    const made = await backupWithKey();
    key = made.key;
    archive = await archiveOf(made.backup);
    for (const backup of await core.listBackups()) await core.deleteBackup(backup.name);
    await env.db.session.deleteMany();
    await env.db.user.deleteMany();
    newSecretKey();
    setupToken.resetSetupGate();
    token = setupToken.ensureSetupToken(true, { log: () => undefined })!;
  });

  it("ohne Token, mit falschem Token: abgewiesen, nichts übernommen oder vorgemerkt", async () => {
    for (const headers of [{}, { "x-setup-token": "falsch-falsch" }, { "x-setup-token": "" }] as Array<Record<string, string>>) {
      const res = await post(archive, { ...headers, "x-recovery-key": key });
      assert.equal(res.status, 403, JSON.stringify(headers));
      assert.deepEqual(await res.json(), { error: "token" });
    }
    assert.equal(readPending(), null);
    assert.equal((await core.listBackups()).length, 0);
  });

  it("falsches Token wird gedrosselt (global); das richtige Token danach geht erst nach der Wartezeit", async () => {
    let throttled = false;
    for (let i = 0; i < 8 && !throttled; i++) throttled = (await post(archive, { "x-setup-token": "falsch" })).status === 429;
    assert.ok(throttled, "nach einigen Fehlversuchen 429");
    assert.equal((await post(archive, { "x-setup-token": token })).status, 429, "während der Wartezeit auch das richtige Token nicht");
    assert.equal(readPending(), null);
  });

  it("mit Token und Schlüssel: wird übernommen, vorgemerkt (samt secret.key), Neustart angestoßen", async () => {
    const res = await post(archive, { "x-setup-token": token, "x-recovery-key": key });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const pending = readPending();
    assert.ok(pending);
    assert.equal(pending.secretKey, true);
    assert.ok(readFileSync(path.join(restoreDir(), "pending-secret.key"), "utf8").length === 64);
    assert.ok(!logged.join("\n").includes(key));
    assert.ok(!JSON.stringify(await env.db.auditLog.findMany()).includes(key));
  });

  it("mit Token, aber ohne Schlüssel: Wiederherstellung ohne secret.key (Geheimnisse werden beim Start zurückgesetzt)", async () => {
    const res = await post(archive, { "x-setup-token": token });
    assert.equal(res.status, 200);
    assert.equal(readPending()?.secretKey, undefined);
  });

  it("falscher Schlüssel: 422, nichts vorgemerkt", async () => {
    const res = await post(archive, { "x-setup-token": token, "x-recovery-key": formatRecoveryKey(randomBytes(32)) });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: "wrongKey" });
    assert.equal(readPending(), null);
  });

  it("nach der Einrichtung (es gibt Benutzer): 409, auch mit gültigem Token", async () => {
    await env.user({ username: "schon-da" });
    const res = await post(archive, { "x-setup-token": token, "x-recovery-key": key });
    assert.equal(res.status, 409);
    assert.equal(readPending(), null);
  });

  it("Fremdaufruf ohne den eigenen Kopf: 403", async () => {
    const res = await setupRoute.POST(new NextRequest("http://localhost/api/setup/restore", { method: "POST", headers: { host: "localhost", "x-setup-token": token }, body: new Uint8Array(archive), ...({ duplex: "half" } as object) }));
    assert.equal(res.status, 403);
  });
});

describe("Verschlüsselte Datei (.sobk) hochladen und vom Ziel einlesen", () => {
  it("Hochladen in der Verwaltung: .sobk mit dem Schlüssel wird entschlüsselt und übernommen; ohne/mit falschem Schlüssel abgewiesen", async () => {
    const { key, backup } = await backupWithKey();
    const plain = await archiveOf(backup);
    const { createEncryptStream } = await import("@/lib/offsite/crypto");
    const { deriveOffsiteMasterKey } = await import("@/lib/secret-wrap");
    const { parseRecoveryKey } = await import("@/lib/recovery-key");
    const parsed = parseRecoveryKey(key);
    assert.ok(parsed.ok);
    const { Readable } = await import("node:stream");
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.from([plain]).pipe(createEncryptStream(deriveOffsiteMasterKey(parsed.key)))) chunks.push(Buffer.from(chunk));
    const sobk = Buffer.concat(chunks);
    assert.ok(!sobk.includes(plain.subarray(0, 512)), "nicht lesbar");

    const post = (headers: Record<string, string>) =>
      uploadRoute.POST(new NextRequest("http://localhost/api/backups/upload", { method: "POST", headers: { "x-requested-with": "schrauberos", host: "localhost", ...headers }, body: new Uint8Array(sobk), ...({ duplex: "half" } as object) }));
    const before = (await core.listBackups()).length;
    assert.equal((await post({})).status, 422);
    assert.deepEqual(await (await post({})).json(), { error: "keyRequired" });
    assert.deepEqual(await (await post({ "x-recovery-key": formatRecoveryKey(randomBytes(32)) })).json(), { error: "wrongKey" });
    assert.deepEqual(await (await post({ "x-recovery-key": "abc" })).json(), { error: "keyFormat" });
    assert.equal((await core.listBackups()).length, before);
    const ok = await post({ "x-recovery-key": key });
    assert.equal(ok.status, 200);
    const { name } = (await ok.json()) as { name: string };
    assert.match(name, /-upload$/);
    assert.equal((await core.listBackups()).length, before + 1);
    // Nach dem Import bleibt keine entschlüsselte Zwischendatei liegen
    const { readdirSync } = await import("node:fs");
    assert.deepEqual(readdirSync(core.backupsDir()).filter((f) => f.startsWith(".decrypt-") || f.startsWith(".upload-")), []);
  });
});
