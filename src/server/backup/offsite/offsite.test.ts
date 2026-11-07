import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import * as tar from "tar";
import { createDecryptStream } from "@/lib/offsite/crypto";
import { OFFSITE_NAME } from "@/lib/offsite/target";
import { deriveOffsiteMasterKey } from "@/lib/secret-wrap";
import { parseRecoveryKey } from "@/lib/recovery-key";
import { startFakeSftp, type FakeSftp } from "@/test/fake-sftp";
import { startFakeWebdav, type FakeWebdav } from "@/test/fake-webdav";
import { startupState } from "@/server/startup-state";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

/**
 * Off-Site-Backup: Einstellungen (Prüfungen, Zugangsdaten als Geheimnis), verschlüsselter Upload per WebDAV und SFTP (Server im Speicher), Aufbewahrung am Ziel,
 * Fehler und Wiederholung über den Job, Rückweg vom Ziel, Zurücksetzen der Geheimnisse nach einem Restore ohne Schlüssel.
 */
let env: TestEnv;
let actions: typeof import("@/modules/admin/backup/offsite-actions");
let keyActions: typeof import("@/modules/admin/backup/key-actions");
let service: typeof import("./service");
let offsiteSettings: typeof import("./settings");
let core: typeof import("../core");
let restore: typeof import("../restore");
let jobs: typeof import("@/modules/admin/backup/jobs");
let secretReset: typeof import("@/server/secret-reset");
let runtime: typeof import("@/server/auth/runtime");
let dav: FakeWebdav;
let sftp: FakeSftp;

const PASSWORD = "ein-gutes-passwort-123";
const TARGET_PASSWORD = "ziel-passwort-geheim";
let recoveryKey = "";

before(async () => {
  env = await createTestEnv();
  startupState().status = "ready";
  actions = await import("@/modules/admin/backup/offsite-actions");
  keyActions = await import("@/modules/admin/backup/key-actions");
  service = await import("./service");
  offsiteSettings = await import("./settings");
  core = await import("../core");
  restore = await import("../restore");
  jobs = await import("@/modules/admin/backup/jobs");
  secretReset = await import("@/server/secret-reset");
  runtime = await import("@/server/auth/runtime");
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  runtime.authRuntime.sleep = async () => undefined;
  dav = await startFakeWebdav();
  sftp = await startFakeSftp();
});
after(async () => {
  await dav.close();
  await sftp.close();
  await env.cleanup();
});

beforeEach(async () => {
  await env.db.appSetting.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.jobState.deleteMany();
  for (const backup of await core.listBackups()) await core.deleteBackup(backup.name);
  dav.files.clear();
  dav.options.collectionExists = false;
  dav.options.failPut = false;
  dav.options.password = "geheim";
  sftp.files.clear();
  const role = await env.role({ key: `admin-${Math.random().toString(36).slice(2)}`, isAdmin: true });
  const user = await env.user({ username: `admin-${Math.random().toString(36).slice(2, 8)}`, password: PASSWORD, roles: [role] });
  env.signOut();
  await env.signIn(user);
  const created = (await keyActions.createRecoveryKey({}, form({ password: PASSWORD }))) as { recoveryKey?: string };
  recoveryKey = created.recoveryKey!;
  await keyActions.confirmRecoveryKeyAction(form({}));
});

const webdavForm = (extra: Record<string, string | number | boolean> = {}) =>
  form({ enabled: true, protocol: "webdav", url: dav.url, username: "sicherung", password: "geheim", keep: 14, ...extra });

async function saveWebdav(extra: Record<string, string | number | boolean> = {}) {
  const state = (await actions.saveOffsite({}, webdavForm(extra))) as { ok?: boolean; error?: string; fieldErrors?: Record<string, string> };
  assert.ok(state.ok, JSON.stringify(state));
}

async function makeBackups(count: number) {
  const names: string[] = [];
  const base = new Date(Date.UTC(2026, 0, 1, 2));
  for (let i = 0; i < count; i++) names.push((await core.createBackup("auto", undefined, new Date(base.getTime() + i * 86_400_000))).name);
  return names;
}

/** Entschlüsselt die Datei am Ziel mit dem Wiederherstellungsschlüssel und liest die Dateinamen des Archivs. */
async function archiveEntries(encrypted: Buffer): Promise<string[]> {
  const parsed = parseRecoveryKey(recoveryKey);
  assert.ok(parsed.ok);
  const entries: string[] = [];
  await pipeline(Readable.from([encrypted]), createDecryptStream(deriveOffsiteMasterKey(parsed.key)), new tar.Parser({ onReadEntry: (entry) => (entries.push(entry.path), entry.resume()) }));
  return entries;
}

describe("Off-Site: Einstellungen", () => {
  it("speichert das Ziel; die Zugangsdaten liegen nur verschlüsselt in der Datenbank und stehen weder im Audit-Log noch in der Anzeige", async () => {
    await saveWebdav({ password: TARGET_PASSWORD });
    const settings = await offsiteSettings.getOffsiteSettings();
    assert.deepEqual({ enabled: settings.enabled, protocol: settings.protocol, url: settings.url, username: settings.username, keep: settings.keep }, { enabled: true, protocol: "webdav", url: dav.url, username: "sicherung", keep: 14 });
    assert.equal((await offsiteSettings.getOffsiteCredentials())?.password, TARGET_PASSWORD);
    const everything = JSON.stringify([await env.db.appSetting.findMany(), await env.db.auditLog.findMany()]);
    assert.ok(!everything.includes(TARGET_PASSWORD));
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.offsiteSettings" } }), 1);
  });

  it("WebDAV nur über HTTPS (Klartext nur für den eigenen Rechner), keine Zugangsdaten in der Adresse, keine Metadaten-Adressen", async () => {
    for (const [url, field] of [
      ["http://nas.example.org/dav", "url"],
      ["https://u:p@nas.example.org/dav", "url"],
      ["https://169.254.169.254/latest", "url"],
      ["ftp://nas/dav", "url"],
    ] as const) {
      const state = (await actions.saveOffsite({}, webdavForm({ url }))) as { fieldErrors?: Record<string, string> };
      assert.ok(state.fieldErrors?.[field], url);
    }
    assert.equal((await offsiteSettings.getOffsiteSettings()).url, "");
  });

  it("Einschalten verlangt den bestätigten Wiederherstellungsschlüssel", async () => {
    await env.db.appSetting.deleteMany({ where: { key: "secrets.keyConfirmedAt" } });
    const state = (await actions.saveOffsite({}, webdavForm())) as { fieldErrors?: Record<string, string> };
    assert.ok(state.fieldErrors?.enabled);
    // ausgeschaltet darf das Ziel schon gespeichert werden
    await saveWebdav({ enabled: false });
  });

  it("gespeicherte Zugangsdaten gehen nie an ein anderes Ziel: bei geändertem Ziel müssen sie neu eingegeben werden", async () => {
    await saveWebdav({ password: TARGET_PASSWORD });
    const moved = (await actions.saveOffsite({}, form({ enabled: true, protocol: "webdav", url: `${dav.url}-neu`, username: "sicherung", keep: 14 }))) as { fieldErrors?: Record<string, string> };
    assert.ok(moved.fieldErrors?.password);
    assert.equal((await offsiteSettings.getOffsiteSettings()).url, dav.url);
    // gleiches Ziel, Passwortfeld leer: behalten
    const again = (await actions.saveOffsite({}, form({ enabled: true, protocol: "webdav", url: dav.url, username: "sicherung", keep: 7 }))) as { ok?: boolean };
    assert.ok(again.ok);
    assert.equal((await offsiteSettings.getOffsiteCredentials())?.password, TARGET_PASSWORD);
    assert.equal((await offsiteSettings.getOffsiteSettings()).keep, 7);
  });

  it("SFTP: der Fingerabdruck des Hostschlüssels ist Pflicht und muss bestätigt werden; er lässt sich vom Server abrufen", async () => {
    const fetched = (await actions.fetchHostKey({}, form({ host: "127.0.0.1", port: sftp.port }))) as { ok?: boolean; hostKey?: string };
    assert.equal(fetched.hostKey, sftp.fingerprint);
    const base = { enabled: true, protocol: "sftp", host: "127.0.0.1", port: sftp.port, path: "/srv/backups", username: "sicherung", password: "geheim", keep: 14 };
    const missing = (await actions.saveOffsite({}, form(base))) as { fieldErrors?: Record<string, string> };
    assert.ok(missing.fieldErrors?.hostKey);
    const unconfirmed = (await actions.saveOffsite({}, form({ ...base, hostKey: sftp.fingerprint }))) as { fieldErrors?: Record<string, string> };
    assert.ok(unconfirmed.fieldErrors?.hostKeyConfirmed);
    const bad = (await actions.saveOffsite({}, form({ ...base, hostKey: "SHA256:zu-kurz", hostKeyConfirmed: true }))) as { fieldErrors?: Record<string, string> };
    assert.ok(bad.fieldErrors?.hostKey);
    const ok = (await actions.saveOffsite({}, form({ ...base, hostKey: sftp.fingerprint, hostKeyConfirmed: true }))) as { ok?: boolean };
    assert.ok(ok.ok);
    assert.equal((await offsiteSettings.getOffsiteSettings()).hostKey, sftp.fingerprint);
    // ein anderer Fingerabdruck ohne Bestätigung ändert den hinterlegten nicht
    const swapped = (await actions.saveOffsite({}, form({ ...base, hostKey: `SHA256:${"B".repeat(43)}` }))) as { fieldErrors?: Record<string, string> };
    assert.ok(swapped.fieldErrors?.hostKeyConfirmed);
    assert.equal((await offsiteSettings.getOffsiteSettings()).hostKey, sftp.fingerprint);
  });

  it("Hostschlüssel abrufen: gesperrte Adressen und unerreichbare Server werden abgewiesen", async () => {
    const forbidden = (await actions.fetchHostKey({}, form({ host: "169.254.169.254", port: 22 }))) as { fieldErrors?: Record<string, string> };
    assert.ok(forbidden.fieldErrors?.host);
    const unreachable = (await actions.fetchHostKey({}, form({ host: "127.0.0.1", port: 9 }))) as { error?: string; hostKey?: string };
    assert.ok(unreachable.error);
    assert.equal(unreachable.hostKey, undefined);
  });
});

describe("Off-Site: Übertragen (WebDAV)", () => {
  it("lädt neue auto/manual-Sicherungen verschlüsselt hoch: am Ziel ist nichts lesbar, mit dem Wiederherstellungsschlüssel lässt sich das Archiv öffnen", async () => {
    await saveWebdav({ password: "geheim" });
    const [first] = await makeBackups(1);
    await core.createBackup("pre-update"); // bleibt lokal
    const result = await service.runOffsite();
    assert.deepEqual(result?.uploaded, [first]);
    assert.deepEqual([...dav.files.keys()], [`${first}.sobk`]);
    assert.ok(OFFSITE_NAME.test(`${first}.sobk`));
    const stored = dav.files.get(`${first}.sobk`)!;
    assert.equal(stored.subarray(0, 4).toString("latin1"), "SOBK");
    const dbArchive = readFileSync(path.join(core.backupPath(first)!, core.DB_ARCHIVE));
    assert.ok(!stored.includes(dbArchive.subarray(0, 64)), "Daten nicht im Klartext");
    assert.ok((await archiveEntries(stored)).some((entry) => entry.endsWith("database.db.gz")));
    // zweiter Lauf: nichts zu tun
    assert.deepEqual((await service.runOffsite())?.uploaded, []);
  });

  it("Aufbewahrung am Ziel: nur die neuesten `keep` eigenen Dateien bleiben – fremde Dateien nie angefasst", async () => {
    await saveWebdav({ keep: 2 });
    const names = await makeBackups(4);
    dav.files.set("urlaubsfotos.zip", Buffer.from("fremd"));
    dav.files.set("schrauberos-notizen.txt", Buffer.from("fremd"));
    dav.files.set("schrauberos-20250101T020000Z-auto.sobk", Buffer.from("alt")); // eigene, ältere Datei
    dav.options.collectionExists = true;
    const result = await service.runOffsite();
    assert.deepEqual(result?.uploaded, [names[3], names[2]]);
    assert.deepEqual([...dav.files.keys()].sort(), ["schrauberos-notizen.txt", `${names[2]}.sobk`, `${names[3]}.sobk`, "urlaubsfotos.zip"].sort());
    assert.ok(result?.deleted.includes("schrauberos-20250101T020000Z-auto"));
  });

  it("scheitert das Hochladen, wirft der Lauf (der Job wiederholt), am Ziel bleibt keine halbe Datei; danach gelingt es", async () => {
    await saveWebdav();
    const [name] = await makeBackups(1);
    dav.options.failPut = true;
    await assert.rejects(service.runOffsite(), /server/);
    assert.ok(![...dav.files.keys()].some((n) => n.includes(name)), "nichts unter dem Namen der Sicherung");
    dav.options.failPut = false;
    assert.deepEqual((await service.runOffsite())?.uploaded, [name]);
  });

  it("falsche Zugangsdaten: Fehler auth; ausgeschaltet oder unvollständig: kein Lauf", async () => {
    await saveWebdav();
    await makeBackups(1);
    dav.options.password = "anders";
    await assert.rejects(service.runOffsite(), /auth/);
    await saveWebdav({ enabled: false });
    assert.equal(await service.runOffsite(), null);
    assert.equal(await service.offsiteWorkPending(), false);
  });

  it("Job: shouldRun nur bei Arbeit; Fehlschlag wird im Audit nur beim ersten Versuch festgehalten; Meldung ohne Geheimnisse", async () => {
    const job = jobs.jobs.find((j) => j.id === "backup.offsite")!;
    assert.ok(job.shouldRun && job.onFailure && job.feature === "admin.backup");
    assert.equal(await job.shouldRun({ now: new Date() }), false, "nicht eingerichtet");
    dav.options.password = TARGET_PASSWORD;
    await saveWebdav({ password: TARGET_PASSWORD });
    await makeBackups(1);
    assert.equal(await job.shouldRun({ now: new Date() }), true, "Sicherung ist noch nicht am Ziel");
    const message = await job.run({ now: new Date(), signal: new AbortController().signal, attempt: 1, manual: false });
    assert.match(String(message), /1 hochgeladen/);
    assert.ok(!String(message).includes(TARGET_PASSWORD));
    // direkt danach: nichts zu tun; erst die tägliche Abstimmung mit dem Ziel macht den Job wieder fällig
    assert.equal(await job.shouldRun({ now: new Date() }), false);
    assert.equal(await job.shouldRun({ now: new Date(Date.now() + 25 * 3600_000) }), true);
    await job.onFailure!({ attempt: 1, timedOut: false });
    await job.onFailure!({ attempt: 2, timedOut: false });
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.offsiteFailed" } }), 1);
  });

  it("„Verbindung testen“ zählt die Sicherungsdateien am Ziel und meldet Fehler lesbar; der Test ändert nichts", async () => {
    await saveWebdav();
    const [name] = await makeBackups(1);
    await service.runOffsite();
    const ok = (await actions.testOffsiteAction({}, form({}))) as { ok?: boolean; files?: number };
    assert.deepEqual({ ok: ok.ok, files: ok.files }, { ok: true, files: 1 });
    dav.options.password = "anders";
    const bad = (await actions.testOffsiteAction({}, form({}))) as { ok?: boolean; error?: string };
    assert.ok(!bad.ok && bad.error);
    assert.ok(dav.files.has(`${name}.sobk`));
  });

  it("Rückweg: eine Sicherung vom Ziel holen, entschlüsseln und als „Hochgeladen“ in die Liste übernehmen", async () => {
    await saveWebdav();
    const [name] = await makeBackups(1);
    await service.runOffsite();
    const remote = await service.listOffsiteBackups();
    assert.deepEqual(remote.map((r) => r.file), [`${name}.sobk`]);
    const before = (await core.listBackups()).length;
    const imported = await service.fetchOffsiteBackup(`${name}.sobk`);
    assert.match(imported, /-upload$/);
    assert.equal((await core.listBackups()).length, before + 1);
    // derselbe Datenbankstand wie das Original
    const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    assert.equal(sha(restore.readDatabaseArchive(imported)), sha(restore.readDatabaseArchive(name)));
    // über die Aktion (mit Audit); fremde oder ungültige Namen werden abgewiesen
    const state = (await actions.fetchOffsiteBackupAction({}, form({ file: `${name}.sobk` }))) as { ok?: boolean };
    assert.ok(state.ok);
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.offsiteFetch" } }), 1);
    const bad = (await actions.fetchOffsiteBackupAction({}, form({ file: "../../etc/passwd" }))) as { error?: string };
    assert.ok(bad.error);
  });

  it("eine veränderte Datei am Ziel wird beim Zurückholen erkannt (nichts wird übernommen)", async () => {
    await saveWebdav();
    const [name] = await makeBackups(1);
    await service.runOffsite();
    const stored = Buffer.from(dav.files.get(`${name}.sobk`)!);
    stored[stored.length - 20] ^= 0x01;
    dav.files.set(`${name}.sobk`, stored);
    const before = (await core.listBackups()).length;
    await assert.rejects(service.fetchOffsiteBackup(`${name}.sobk`), (error) => error instanceof restore.RestoreError && error.code === "wrongKey");
    assert.equal((await core.listBackups()).length, before);
  });
});

describe("Off-Site: Übertragen (SFTP)", () => {
  const sftpForm = (extra: Record<string, string | number | boolean> = {}) =>
    form({ enabled: true, protocol: "sftp", host: "127.0.0.1", port: sftp.port, path: "/srv/backups", username: "sicherung", password: "geheim", hostKey: sftp.fingerprint, hostKeyConfirmed: true, keep: 14, ...extra });

  it("lädt mit dem hinterlegten Hostschlüssel hoch; bei abweichendem Hostschlüssel Abbruch ohne Anmeldung", async () => {
    const saved = (await actions.saveOffsite({}, sftpForm())) as { ok?: boolean };
    assert.ok(saved.ok);
    const [name] = await makeBackups(1);
    assert.deepEqual((await service.runOffsite())?.uploaded, [name]);
    assert.ok(sftp.files.has(`/srv/backups/${name}.sobk`));
    assert.ok((await archiveEntries(sftp.files.get(`/srv/backups/${name}.sobk`)!)).length > 0);

    // der Server hat plötzlich einen anderen Schlüssel (Man-in-the-middle oder Neuinstallation): in den Einstellungen steht weiter der bestätigte
    await env.db.appSetting.update({ where: { key: "offsite.hostKey" }, data: { value: `SHA256:${"C".repeat(43)}` } });
    await makeBackups(1);
    const attempts = sftp.authAttempts;
    await assert.rejects(service.runOffsite(), (error: Error & { code?: string }) => error.code === "hostKey");
    assert.equal(sftp.authAttempts, attempts, "kein Anmeldeversuch bei falschem Hostschlüssel");
  });
});

describe("Off-Site: Fehlerserie", () => {
  it("eine alte Fehlerserie färbt den Systemstatus nicht weiter, sobald Off-Site ausgeschaltet oder das Ziel gewechselt wird", async () => {
    await saveWebdav();
    await env.db.jobState.create({ data: { id: "backup.offsite", failures: 3, lastStatus: "error", lastMessage: "connect: ECONNREFUSED" } });
    await saveWebdav({ enabled: false });
    assert.equal((await env.db.jobState.findUniqueOrThrow({ where: { id: "backup.offsite" } })).failures, 0);
    await env.db.jobState.update({ where: { id: "backup.offsite" }, data: { failures: 2 } });
    await saveWebdav({ password: "geheim" });
    assert.equal((await env.db.jobState.findUniqueOrThrow({ where: { id: "backup.offsite" } })).failures, 2, "gleiches Ziel, eingeschaltet: unverändert");
  });
});

describe("Off-Site: Restore ohne passenden Schlüssel", () => {
  it("Zugangsdaten und Hauptschlüssel sind unlesbar → Off-Site wird ausgeschaltet und im Hinweis/Audit gemeldet; der Lauf lädt nichts mehr hoch", async () => {
    await saveWebdav({ password: TARGET_PASSWORD });
    await makeBackups(1);
    writeFileSync(path.join(env.dir, "secret.key"), "ab".repeat(32)); // anderer Datenträger
    assert.equal(await offsiteSettings.getOffsiteCredentials(), null);
    const items = await secretReset.resetUnreadableSecrets();
    assert.ok(items.some((i) => i.id === "backup.offsite"));
    assert.equal((await offsiteSettings.getOffsiteSettings()).enabled, false);
    assert.equal(await service.runOffsite(), null);
    assert.equal(dav.files.size, 0, "nichts hochgeladen");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "secrets.reset" } });
    assert.match(entry.target ?? "", /backup\.offsite/);
    assert.ok(!JSON.stringify(await env.db.auditLog.findMany()).includes(TARGET_PASSWORD));
  });
});
