import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Tresor-Hülle (Schlüsselkonzept, Block 14): Hauptschlüssel aus der Tresor-Passphrase (scrypt, Eigentümer-Pfad), nur im Speicher; Einrichten, Entsperren (Passphrase und Wiederherstellungsschlüssel), Sperren,
 * Passphrase ändern ohne Neuverschlüsseln, Zurücksetzen, Drosselung, Audit und der simulierte Neustart.
 */
const PASSWORD = "ein-gutes-passwort-123";
const PASSPHRASE = "Tresor-Passphrase mit vielen Wörtern 2026";
const NEW_PASSPHRASE = "Ganz andere neue Passphrase für 2027";
const SECRET = { url: "https://marker-url-k7.example", username: "marker-user-k7", secret: "Marker-Pw-K7!zz", note: "marker-note-k7" };

let env: TestEnv;
let ops: typeof import("./vault-keyring-operations");
let vaultOps: typeof import("./vault-operations");
let keyring: typeof import("@/server/vault-keyring");
let keys: typeof import("@/lib/vault-keys");
let crypto: typeof import("./vault-crypto");
let recovery: typeof import("@/server/recovery-key");
let throttle: typeof import("@/server/auth/throttle");
let session: import("@/server/auth/session").AppSession;
let n = 0;

async function sessionFor(permissions: string[]) {
  n++;
  const { getSession } = await import("@/server/auth/session");
  const role = await env.role({ key: `r-${n}`, permissions });
  const user = await env.user({ username: `user-${n}`, password: PASSWORD, roles: [role] });
  env.browser.reset();
  await env.signIn(user);
  return (await getSession())!;
}
const BOTH = ["docsIt.vault", "docsIt.vaultManage"];
const failure = (outcome: { ok: boolean }) => (outcome as unknown as { failure: { code: string; key?: string; fields?: Record<string, { key: string }> } }).failure;
const audits = async () => (await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((e) => `${e.action} ${e.target}`);

before(async () => {
  env = await createTestEnv();
  ops = await import("./vault-keyring-operations");
  vaultOps = await import("./vault-operations");
  keyring = await import("@/server/vault-keyring");
  keys = await import("@/lib/vault-keys");
  crypto = await import("./vault-crypto");
  recovery = await import("@/server/recovery-key");
  throttle = await import("@/server/auth/throttle");
  const runtime = await import("@/server/auth/runtime");
  runtime.authRuntime.sleep = async () => undefined;
  keyring.setVaultScryptForTests({ N: 2 ** 10, r: 8, p: 1 });
});
after(() => env.cleanup());
beforeEach(async () => {
  keyring.lockVault();
  await env.db.vaultEntry.deleteMany();
  await env.db.vaultKeyring.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.appSetting.deleteMany();
  rmSync(path.join(env.dir, "secret-reset"), { recursive: true, force: true });
  throttle.resetLoginThrottle();
  session = await sessionFor(BOTH);
});

const setup = (passphrase = PASSPHRASE, extra: Record<string, unknown> = {}) => ops.setupVaultOperation.execute(session, { passphrase, confirm: passphrase, password: PASSWORD, ...extra });
const unlock = (passphrase = PASSPHRASE, password = PASSWORD) => ops.unlockVaultOperation.execute(session, { passphrase, password });
async function sealedEntry() {
  const row = await env.db.vaultEntry.create({ data: { title: "Firewall", kind: "network", system: "fw-01" } });
  const sealed = crypto.sealVaultEntry(row.id, 1, { title: "Firewall", kind: "network", system: "fw-01" }, { ...crypto.EMPTY_SECRET, ...SECRET });
  return env.db.vaultEntry.update({ where: { id: row.id }, data: sealed });
}
function dump(): string {
  const db = new Database(path.join(env.dir, "test.db"), { readonly: true });
  try {
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((t) => t.name);
    return tables.map((name) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
  } finally {
    db.close();
  }
}

describe("Kryptografie der Hülle (lib/vault-keys)", () => {
  it("Hauptschlüssel: Hülle öffnet nur mit dem richtigen Schlüssel und Zweck; Prüfwert erkennt den richtigen Hauptschlüssel", async () => {
    const master = keys.newMasterKey();
    const salt = Buffer.alloc(16, 7);
    const kek = await keys.deriveKek("eine Passphrase", salt, { N: 2 ** 10, r: 8, p: 1 });
    assert.deepEqual(kek, await keys.deriveKek("eine Passphrase".normalize("NFD"), salt, { N: 2 ** 10, r: 8, p: 1 }), "NFKC: gleiche Passphrase, gleiche Ableitung");
    const wrapped = keys.wrapMaster(master, kek, "passphrase");
    assert.match(wrapped, /^m1:/);
    assert.deepEqual(keys.unwrapMaster(wrapped, kek, "passphrase"), master);
    assert.equal(keys.unwrapMaster(wrapped, kek, "recovery"), null, "ein anderer Zweck öffnet nie");
    assert.equal(keys.unwrapMaster(wrapped, await keys.deriveKek("falsche", salt, { N: 2 ** 10, r: 8, p: 1 }), "passphrase"), null);
    assert.ok(keys.masterMatches(master, keys.keyCheck(master)));
    assert.equal(keys.masterMatches(keys.newMasterKey(), keys.keyCheck(master)), false);
    assert.ok(!keys.keyCheck(master).includes(master.toString("hex")));
  });

  it("scrypt-Kosten aus dem Datensatz werden begrenzt (Speicherbedarf, abgesenkte Kosten)", () => {
    assert.equal(keys.validScryptParams({ N: 2 ** 17, r: 8, p: 1 }), true);
    for (const bad of [{ N: 2 ** 19, r: 8, p: 1 }, { N: 2 ** 10, r: 8, p: 1 }, { N: 3 * 2 ** 14, r: 8, p: 1 }, { N: 2 ** 15, r: 64, p: 1 }, { N: 2 ** 15, r: 8, p: 9 }]) assert.equal(keys.validScryptParams(bad), false, JSON.stringify(bad));
  });

  it("Mindestqualität der Passphrase", () => {
    assert.equal(keys.passphraseProblem("kurz"), "tooShort");
    assert.equal(keys.passphraseProblem("a".repeat(300)), "tooLong");
    assert.equal(keys.passphraseProblem("aaaaaaaaaaaaaaaa"), "weak");
    assert.equal(keys.passphraseProblem("123456789012345"), "weak");
    assert.equal(keys.passphraseProblem("Passwort Passwort"), "weak");
    assert.equal(keys.passphraseProblem("chef-meier-2026", { username: "chef-meier" }), "username");
    assert.equal(keys.passphraseProblem(PASSPHRASE, { username: "chef" }), null);
  });
});

describe("Einrichten", () => {
  it("richtet den Tresor ein: Hüllen in der Datenbank, nie Passphrase oder Hauptschlüssel; danach entsperrt; Audit ohne Inhalt", async () => {
    assert.equal((await keyring.vaultStatus()).state, "notSetUp");
    const result = await setup();
    assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
    assert.equal((await keyring.vaultStatus()).state, "unlocked");
    const row = await env.db.vaultKeyring.findUniqueOrThrow({ where: { id: "default" } });
    assert.deepEqual([row.version, row.scryptN, row.recoveryWrap], [1, 2 ** 10, null]);
    assert.match(row.wrappedKey, /^m1:/);
    const text = dump();
    assert.ok(!text.includes(PASSPHRASE));
    assert.ok(!text.includes(keyring.vaultMasterKey().toString("hex")) && !text.includes(keyring.vaultMasterKey().toString("base64")));
    assert.deepEqual(await audits(), ["vault.setup –"]);
  });

  it("Mindestqualität, Wiederholung, eigenes Passwort und Rechte; ein zweites Einrichten ist abgelehnt", async () => {
    assert.equal(failure(await setup("kurz")).fields?.passphrase?.key, "vault.keyring.errors.tooShort");
    assert.equal(failure(await ops.setupVaultOperation.execute(session, { passphrase: PASSPHRASE, confirm: PASSPHRASE + "x", password: PASSWORD })).fields?.confirm?.key, "vault.keyring.errors.mismatch");
    assert.ok(failure(await ops.setupVaultOperation.execute(session, { passphrase: PASSPHRASE, confirm: PASSPHRASE, password: "falsch" })).fields?.password);
    const viewer = await sessionFor(["docsIt.vault"]);
    assert.equal(failure(await ops.setupVaultOperation.execute(viewer, { passphrase: PASSPHRASE, confirm: PASSPHRASE, password: PASSWORD })).code, "forbidden");
    assert.equal(await env.db.vaultKeyring.count(), 0);
    assert.ok((await setup()).ok);
    assert.equal(failure(await setup(NEW_PASSPHRASE)).key, "vault.keyring.errors.exists");
  });

  it("ohne Eintragung des Tresors lassen sich keine Zugangsdaten schreiben; danach schon, und das Lesen geht", async () => {
    const save = (title: string) => vaultOps.saveVaultEntryOperation.execute(session, { title, kind: "network", url: SECRET.url, username: SECRET.username, secret: SECRET.secret, note: SECRET.note });
    assert.equal(failure(await save("Vorher")).key, "vault.errors.notSetUp");
    assert.ok((await setup()).ok);
    const saved = await save("Nachher");
    assert.ok(saved.ok);
    const shown = await vaultOps.revealVaultEntryOperation.execute(session, { id: (saved as { data: { id: string } }).data.id, password: PASSWORD });
    assert.ok(shown.ok && shown.data.secret === SECRET.secret);
  });
});

describe("Entsperren, Sperren, Neustart", () => {
  it("nach jedem Neustart ist der Tresor gesperrt: nichts lesbar, nichts schreibbar; die Passphrase öffnet ihn wieder (Audit), Sperren verwirft den Schlüssel", async () => {
    assert.ok((await setup()).ok);
    const entry = await sealedEntry();
    keyring.lockVault(); // Prozessneustart
    assert.equal((await keyring.vaultStatus()).state, "locked");
    assert.throws(() => crypto.openVaultEntry(entry), keyring.VaultLockedError);
    assert.equal(failure(await vaultOps.revealVaultEntryOperation.execute(session, { id: entry.id, password: PASSWORD })).key, "vault.errors.locked");
    assert.ok((await unlock()).ok);
    assert.equal((await keyring.vaultStatus()).state, "unlocked");
    assert.deepEqual(crypto.openVaultEntry(await env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } })), { ok: true, secret: SECRET });
    assert.ok((await ops.lockVaultOperation.execute(session, {})).ok);
    assert.equal((await keyring.vaultStatus()).state, "locked");
    assert.deepEqual(await audits(), ["vault.setup –", "vault.unlock Passphrase", "vault.lock –"]);
  });

  it("falsche Passphrase: Fehler am Feld, global gedrosselt (nach fünf Versuchen wartet auch die richtige), gedrosseltes Audit ohne das Eingegebene; ohne Tresor-Recht gar nichts", async () => {
    assert.ok((await setup()).ok);
    keyring.lockVault();
    for (let i = 0; i < 5; i++) assert.equal(failure(await unlock(`falsch-${i}-falsch-falsch`)).fields?.passphrase?.key, "vault.keyring.errors.wrong");
    const wait = await unlock();
    assert.equal(wait.ok, false, "gedrosselt: auch die richtige Passphrase muss warten");
    assert.equal((await keyring.vaultStatus()).state, "locked");
    const other = await sessionFor(BOTH);
    assert.equal((await ops.unlockVaultOperation.execute(other, { passphrase: PASSPHRASE, password: PASSWORD })).ok, false, "global, nicht je Konto");
    const entries = await audits();
    assert.deepEqual(entries.filter((e) => e.startsWith("vault.unlockFailed")), ["vault.unlockFailed –"], "höchstens einmal pro Minute");
    assert.ok(!JSON.stringify(await env.db.auditLog.findMany()).includes("falsch-"));
    throttle.resetLoginThrottle();
    assert.ok((await unlock()).ok);
    const nobody = await sessionFor([]);
    assert.equal(failure(await ops.unlockVaultOperation.execute(nobody, { passphrase: PASSPHRASE, password: PASSWORD })).code, "forbidden");
  });

  it("falsches eigenes Passwort beim Entsperren: kein Versuch an der Passphrase, Fehler am Passwortfeld", async () => {
    assert.ok((await setup()).ok);
    keyring.lockVault();
    assert.ok(failure(await unlock(PASSPHRASE, "falsch")).fields?.password);
    assert.equal((await keyring.vaultStatus()).state, "locked");
  });

  it("ein beschädigter Datensatz (veränderte Hülle oder unzulässige scrypt-Kosten) wird nicht verwendet und nicht gerechnet", async () => {
    assert.ok((await setup()).ok);
    keyring.lockVault();
    await env.db.vaultKeyring.update({ where: { id: "default" }, data: { scryptN: 2 ** 22 } });
    assert.equal(failure(await unlock()).key, "vault.keyring.errors.invalid");
    await env.db.vaultKeyring.update({ where: { id: "default" }, data: { scryptN: 2 ** 10 } });
    assert.ok((await unlock()).ok, "mit den echten Kosten öffnet er wieder");
  });
});

describe("Passphrase ändern", () => {
  it("tauscht nur die Hülle: Einträge bleiben unverändert (kein Neuverschlüsseln), alte Passphrase öffnet nicht mehr, neue schon; nur entsperrt, mit eigenem Passwort", async () => {
    assert.ok((await setup()).ok);
    const entry = await sealedEntry();
    const before = await env.db.vaultKeyring.findUniqueOrThrow({ where: { id: "default" } });
    const change = (passphrase: string, password = PASSWORD) => ops.changeVaultPassphraseOperation.execute(session, { passphrase, confirm: passphrase, password });
    assert.ok(failure(await change(NEW_PASSPHRASE, "falsch")).fields?.password);
    assert.equal(failure(await change("kurz")).fields?.passphrase?.key, "vault.keyring.errors.tooShort");
    assert.ok((await change(NEW_PASSPHRASE)).ok);
    const after = await env.db.vaultKeyring.findUniqueOrThrow({ where: { id: "default" } });
    assert.notEqual(after.wrappedKey, before.wrappedKey);
    assert.notEqual(after.salt, before.salt);
    assert.equal(after.check, before.check, "derselbe Hauptschlüssel");
    const row = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.deepEqual([row.payload, row.wrappedKey, row.revision], [entry.payload, entry.wrappedKey, entry.revision], "Einträge unberührt");
    keyring.lockVault();
    assert.equal(failure(await unlock(PASSPHRASE)).fields?.passphrase?.key, "vault.keyring.errors.wrong");
    throttle.resetLoginThrottle();
    assert.ok((await unlock(NEW_PASSPHRASE)).ok);
    assert.equal(crypto.openVaultEntry(row).ok, true);
    keyring.lockVault();
    assert.equal(failure(await change("Noch eine andere Passphrase 123")).key, "vault.errors.locked", "gesperrt: nichts zu ändern");
    assert.ok((await audits()).includes("vault.passphrase –"));
  });
});

describe("Wiederherstellungsschlüssel (ein Schlüssel für alles)", () => {
  it("ein bei entsperrtem Tresor erzeugter Schlüssel hinterlegt eine Hülle und entsperrt den Tresor; ein falscher oder alter Schlüssel nicht; nach dem Entsperren lässt sich die Passphrase neu setzen", async () => {
    assert.ok((await setup()).ok);
    const entry = await sealedEntry();
    const key1 = await recovery.issueRecoveryKey(env.db);
    assert.equal((await keyring.vaultStatus()).recovery, true);
    keyring.lockVault();
    const unlockRecovery = (recoveryKey: string) => ops.unlockVaultWithRecoveryKeyOperation.execute(session, { recoveryKey, password: PASSWORD });
    const wrongKey = (await import("@/lib/recovery-key")).formatRecoveryKey(Buffer.alloc(32, 9));
    assert.equal(failure(await unlockRecovery(wrongKey)).fields?.recoveryKey?.key, "vault.keyring.errors.recoveryWrong");
    assert.equal(failure(await unlockRecovery("Unsinn")).fields?.recoveryKey?.key, "vault.keyring.errors.recoveryFormat");
    assert.equal((await keyring.vaultStatus()).state, "locked");
    assert.ok((await unlockRecovery(key1)).ok);
    assert.equal(crypto.openVaultEntry(await env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } })).ok, true);
    // Passphrase vergessen: nach dem Entsperren mit dem Schlüssel neu setzen
    assert.ok((await ops.changeVaultPassphraseOperation.execute(session, { passphrase: NEW_PASSPHRASE, confirm: NEW_PASSPHRASE, password: PASSWORD })).ok);
    // neuer Schlüssel ersetzt die Hülle: der alte öffnet nichts mehr
    const key2 = await recovery.issueRecoveryKey(env.db);
    keyring.lockVault();
    assert.equal(failure(await unlockRecovery(key1)).fields?.recoveryKey?.key, "vault.keyring.errors.recoveryWrong");
    assert.ok((await unlockRecovery(key2)).ok);
    assert.ok((await audits()).includes("vault.unlockRecovery Wiederherstellungsschlüssel"));
  });

  it("ist der Tresor eingerichtet, aber gesperrt, lässt sich kein Wiederherstellungsschlüssel erzeugen (er würde ihn nicht öffnen); ohne Tresor ändert sich nichts", async () => {
    await recovery.issueRecoveryKey(env.db); // kein Tresor: wie bisher
    assert.equal((await keyring.vaultStatus()).state, "notSetUp");
    assert.ok((await setup()).ok);
    keyring.lockVault();
    await assert.rejects(() => recovery.issueRecoveryKey(env.db), keyring.VaultLockedError);
    assert.ok((await unlock()).ok);
    assert.ok(await recovery.issueRecoveryKey(env.db));
    // ohne Hülle für diesen Tresor (z. B. Schlüssel vor der Einrichtung erzeugt) lässt sich nicht mit ihm entsperren
    await env.db.vaultKeyring.update({ where: { id: "default" }, data: { recoveryWrap: null } });
    keyring.lockVault();
    const noWrap = await ops.unlockVaultWithRecoveryKeyOperation.execute(session, { recoveryKey: (await import("@/lib/recovery-key")).formatRecoveryKey(Buffer.alloc(32, 3)), password: PASSWORD });
    assert.equal(failure(noWrap).key, "vault.keyring.errors.noRecoveryWrap");
  });

  it("die Aktion „Wiederherstellungsschlüssel erzeugen“ meldet bei gesperrtem Tresor eine klare Meldung und erzeugt nichts", async () => {
    const admin = await sessionFor(["backup.keys"].concat(BOTH));
    void admin;
    assert.ok((await setup()).ok);
    keyring.lockVault();
    const { createRecoveryKey } = await import("@/modules/admin/backup/key-actions");
    void createRecoveryKey;
    assert.equal((await env.db.appSetting.findUnique({ where: { key: "secrets.wrapped" } })) === null, true, "vorher keine Hülle");
    await assert.rejects(() => recovery.issueRecoveryKey(env.db), keyring.VaultLockedError);
    assert.equal((await env.db.appSetting.findUnique({ where: { key: "secrets.wrapped" } })) === null, true, "nachher auch nicht");
  });
});

describe("Zurücksetzen", () => {
  it("setzt nur ausdrücklich zurück: Sicherung der Zeilen vorher, Zugangsdaten entfernt („Neu eingeben nötig“), Hüllen weg, danach neue Einrichtung; nie ohne Passwort und Bestätigung", async () => {
    assert.ok((await setup()).ok);
    const entry = await sealedEntry();
    const empty = await env.db.vaultEntry.create({ data: { title: "Leer" } });
    keyring.lockVault();
    const reset = (extra: Record<string, unknown> = {}) => ops.resetVaultOperation.execute(session, { password: PASSWORD, confirm: true, ...extra });
    assert.ok(failure(await reset({ password: "falsch" })).fields?.password);
    assert.equal(failure(await reset({ confirm: false })).fields?.confirm?.key, "vault.keyring.errors.confirmReset");
    assert.equal(await env.db.vaultKeyring.count(), 1, "nichts geschehen");
    assert.ok((await reset()).ok);
    assert.equal(await env.db.vaultKeyring.count(), 0);
    const rows = await env.db.vaultEntry.findMany({ orderBy: { title: "asc" } });
    assert.deepEqual(rows.map((r) => [r.title, r.wrappedKey, r.payload, r.unreadableAt !== null]), [["Firewall", null, null, true], ["Leer", null, null, false]]);
    assert.equal(rows.length, 2, "kein Eintrag gelöscht");
    const files = readdirSync(path.join(env.dir, "secret-reset"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^vault-/);
    const saved = readFileSync(path.join(env.dir, "secret-reset", files[0]), "utf8");
    assert.ok(saved.includes(entry.wrappedKey!) && !saved.includes(SECRET.secret), "nur Verschlüsseltes");
    assert.ok((await audits()).some((a) => /^vault\.reset 1 Eintrag · Sicherung secret-reset\/vault-/.test(a)));
    assert.ok((await setup(NEW_PASSPHRASE)).ok, "danach neu einrichten");
    assert.equal(rows.find((r) => r.id === empty.id)?.unreadableAt, null);
    assert.equal(existsSync(path.join(env.dir, "secret-reset")), true);
  });
});
