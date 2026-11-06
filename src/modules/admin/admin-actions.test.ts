import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Verwaltung im Aktions-Rahmen: Module, Backup-Plan, Backups, Update-Token, Aufbewahrung des Audit-Logs. */
let env: TestEnv;
let modules: typeof import("./modules/actions");
let backup: typeof import("./backup/actions");
let updates: typeof import("./updates/actions");
let settings: typeof import("./settings/actions");
let retention: typeof import("@/server/audit-retention");
let decodeFlash: typeof import("@/server/operations/flash").decodeFlash;

before(async () => {
  env = await createTestEnv();
  process.env.UPDATE_API_URL = "http://127.0.0.1:9"; // nichts erreichbar: die Update-Prüfung scheitert sofort
  modules = await import("./modules/actions");
  backup = await import("./backup/actions");
  updates = await import("./updates/actions");
  settings = await import("./settings/actions");
  retention = await import("@/server/audit-retention");
  ({ decodeFlash } = await import("@/server/operations/flash"));
});
after(() => env.cleanup());

const lastFlash = () => {
  const write = env.browser.writes.filter((w) => w.name === "so_flash").at(-1);
  return write ? decodeFlash(write.value) : null;
};

beforeEach(async () => {
  await env.db.user.deleteMany();
  await env.db.featureSetting.deleteMany();
  await env.db.appSetting.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
  const admin = await env.user({ username: "chef", roles: [await env.role({ key: `admin-${Math.random()}`, isAdmin: true })] });
  await env.signIn(admin);
});

const signInWith = async (...permissions: string[]) => {
  await env.signIn(await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] }));
};

describe("setEnabled (Module & Funktionen)", () => {
  it("schaltet eine Funktion aus und wieder ein, protokolliert und meldet es", async () => {
    assert.equal(await modules.setEnabled(form({ key: "office.fleet", enabled: "false" })), undefined);
    assert.equal((await env.db.featureSetting.findUniqueOrThrow({ where: { key: "office.fleet" } })).enabled, false);
    assert.equal(lastFlash()?.key, "common.saved");
    assert.ok(env.browser.revalidated.includes("/"));
    await modules.setEnabled(form({ key: "office.fleet", enabled: "true" }));
    assert.equal((await env.db.featureSetting.findUniqueOrThrow({ where: { key: "office.fleet" } })).enabled, true);
    const entries = await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(entries.map((e) => [e.action, e.target]), [["module.disable", "office.fleet"], ["module.enable", "office.fleet"]]);
  });

  it("Pflichtfunktionen und unbekannte Schlüssel lassen sich nicht schalten – mit Rückmeldung statt Schweigen", async () => {
    await modules.setEnabled(form({ key: "admin.users", enabled: "false" }));
    assert.equal(lastFlash()?.key, "modules.errors.required");
    await modules.setEnabled(form({ key: "gibt.es.nicht", enabled: "false" }));
    assert.equal(lastFlash()?.key, "modules.errors.unknown");
    assert.equal(await env.db.featureSetting.count(), 0);
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("verlangt modules.manage", async () => {
    await signInWith("settings.manage");
    assert.equal(await redirectOf(() => modules.setEnabled(form({ key: "office.fleet", enabled: "false" }))), "/forbidden");
    assert.equal(await env.db.featureSetting.count(), 0);
  });
});

describe("Backup-Plan und Backups", () => {
  it("speichert den Plan, protokolliert ihn und prüft die Eingaben", async () => {
    const { getBackupSettings } = await import("@/server/backup/settings");
    assert.deepEqual(await backup.saveBackupPlan({}, form({ enabled: true, hour: 4, keep: 7 })), { ok: true, message: "Gespeichert." });
    assert.deepEqual(await getBackupSettings(), { enabled: true, hour: 4, keep: 7 });
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.backupPlan" } }), 1);
    assert.ok((await backup.saveBackupPlan({}, form({ enabled: true, hour: 25, keep: 7 }))).fieldErrors?.hour);
    assert.ok((await backup.saveBackupPlan({}, form({ enabled: true, keep: 7 }))).fieldErrors?.hour, "leeres Feld = Pflichtfeld");
    assert.deepEqual(await getBackupSettings(), { enabled: true, hour: 4, keep: 7 });
  });

  it("legt ein Backup an und löscht es wieder – beides im Audit", async () => {
    const state = await backup.createManualBackup({}, form({}));
    assert.equal(state.ok, true);
    const created = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.create" } });
    const name = created.target!;
    assert.ok(existsSync(path.join(env.dir, "backups", name)));
    await backup.removeBackup(form({ name }));
    assert.equal(existsSync(path.join(env.dir, "backups", name)), false);
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.delete" } }), 1);
    await backup.removeBackup(form({ name: "../../etc" }));
    assert.equal(lastFlash()?.key, "backup.errors.notFound");
  });

  it("eine fehlgeschlagene Wiederherstellung wird gemeldet und im Audit festgehalten", async () => {
    const state = await backup.restoreBackup({}, form({ name: "schrauberos-20200101T000000Z-manual" }));
    assert.ok(state.error);
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.restoreFailed" } }), 1);
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.restore" } }), 0);
  });

  it("der Backup-Plan gehört zu settings.manage, Backups zu backup.manage", async () => {
    await signInWith("backup.manage");
    assert.equal(await redirectOf(() => backup.saveBackupPlan({}, form({ enabled: true, hour: 3, keep: 5 }))), "/forbidden");
    await signInWith("settings.manage");
    assert.equal(await redirectOf(() => backup.createManualBackup({}, form({}))), "/forbidden");
  });
});

describe("Update-Token", () => {
  it("speichert das Token verschlüsselt und schreibt es nie ins Audit-Log", async () => {
    const { getSecret } = await import("@/server/settings");
    const secret = "ghp_geheimes-token-123";
    assert.equal((await updates.saveUpdateToken({}, form({ token: secret }))).ok, true);
    assert.equal(await getSecret("update.token"), secret);
    const stored = (await env.db.appSetting.findUniqueOrThrow({ where: { key: "update.token" } })).value;
    assert.ok(!stored.includes(secret), "nur verschlüsselt gespeichert");
    const entries = await env.db.auditLog.findMany({ where: { action: "settings.updateToken" } });
    assert.equal(entries.length, 1);
    assert.ok(!JSON.stringify(entries).includes(secret));
    await updates.saveUpdateToken({}, form({ remove: true }));
    assert.equal(await getSecret("update.token"), null);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.updateToken" } }), 2);
  });

  it("eine fehlgeschlagene Installation wird gemeldet und protokolliert", async () => {
    const state = await updates.installUpdate({}, form({ version: "9.9.9" }));
    assert.ok(state.error);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "system.updateFailed" } });
    assert.match(entry.target ?? "", /^9\.9\.9: /);
  });
});

describe("Aufbewahrung des Audit-Logs", () => {
  const entry = (daysAgo: number) => env.db.auditLog.create({ data: { action: "user.create", actorName: "x", createdAt: new Date(Date.now() - daysAgo * 86_400_000) } });

  it("löscht Einträge außerhalb der Frist (Standard 2 Jahre) und hält das selbst fest", async () => {
    await entry(10);
    await entry(729);
    await entry(731);
    await entry(2000);
    assert.equal(await retention.pruneAuditLog(), 2);
    const left = await env.db.auditLog.findMany();
    assert.equal(left.filter((e) => e.action === "user.create").length, 2);
    assert.equal(left.filter((e) => e.action === "system.auditPruned").length, 1);
    assert.equal(await retention.pruneAuditLog(), 0, "nichts mehr zu löschen -> kein weiterer Eintrag");
    assert.equal(await env.db.auditLog.count({ where: { action: "system.auditPruned" } }), 1);
  });

  it("richtet sich nach der Einstellung; 0 bewahrt alles auf", async () => {
    await entry(40);
    await entry(5);
    assert.equal((await settings.saveSecurity({}, form({ behindProxy: false, auditRetentionDays: 30 }))).ok, true);
    assert.equal(await retention.getAuditRetentionDays(), 30);
    assert.equal(await retention.pruneAuditLog(), 1);
    await settings.saveSecurity({}, form({ auditRetentionDays: 0 }));
    await entry(5000);
    assert.equal(await retention.pruneAuditLog(), 0);
  });

  it("lehnt unsinnige Fristen ab und lässt die Einstellung ohne Angabe unverändert", async () => {
    assert.ok((await settings.saveSecurity({}, form({ auditRetentionDays: 99999 }))).fieldErrors?.auditRetentionDays);
    assert.equal(await retention.getAuditRetentionDays(), 730);
    await settings.saveSecurity({}, form({ auditRetentionDays: 90 }));
    await settings.saveSecurity({}, form({ behindProxy: true }));
    assert.equal(await retention.getAuditRetentionDays(), 90);
  });
});
