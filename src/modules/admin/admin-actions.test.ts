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
  it("speichert den Plan samt Aufbewahrung je Art, protokolliert ihn und prüft die Eingaben", async () => {
    const { getBackupSettings, RETENTION_DEFAULTS } = await import("@/server/backup/settings");
    const { BACKUP_KINDS } = await import("@/server/backup/kinds");
    const fields = (over: Record<string, unknown> = {}) =>
      form({
        enabled: true,
        hour: 4,
        ...Object.fromEntries(BACKUP_KINDS.flatMap((k) => [[`keep_${k}`, RETENTION_DEFAULTS[k].keep], [`days_${k}`, RETENTION_DEFAULTS[k].days]])),
        keep_auto: 7,
        days_manual: 365,
        ...over,
      });
    assert.deepEqual(await backup.saveBackupPlan({}, fields()), { ok: true, message: "Gespeichert." });
    const saved = await getBackupSettings();
    assert.equal(saved.hour, 4);
    assert.deepEqual(saved.retention.auto, { keep: 7, days: 0 });
    assert.deepEqual(saved.retention.manual, { keep: 0, days: 365 });
    assert.deepEqual(saved.retention["pre-update"], RETENTION_DEFAULTS["pre-update"]);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.backupPlan" } }), 1);
    assert.ok((await backup.saveBackupPlan({}, fields({ hour: 25 }))).fieldErrors?.hour);
    assert.ok((await backup.saveBackupPlan({}, fields({ hour: "" }))).fieldErrors?.hour, "leeres Feld = Pflichtfeld");
    assert.ok((await backup.saveBackupPlan({}, fields({ keep_manual: -1 }))).fieldErrors?.keep_manual, "negative Anzahl");
    // Leere Aufbewahrungsfelder sind ein Fehler, nie „0 = unbegrenzt“ (Datenschutz: Speicherbegrenzung)
    assert.ok((await backup.saveBackupPlan({}, fields({ keep_auto: "" }))).fieldErrors?.keep_auto, "leere Anzahl");
    assert.ok((await backup.saveBackupPlan({}, fields({ days_auto: "  " }))).fieldErrors?.days_auto, "leere Frist");
    assert.ok((await backup.saveBackupPlan({}, fields({ days_auto: 99999 }))).fieldErrors?.days_auto, "Frist über dem Höchstwert");
    assert.deepEqual(await getBackupSettings(), saved, "fehlerhafte Eingaben ändern nichts");
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

  it("„Jetzt erneut versuchen“ führt das automatische Backup sofort aus, mit Audit; ohne backup.manage verboten", async () => {
    const before = await env.db.auditLog.count({ where: { action: "backup.runNow" } });
    const state = await backup.runAutoBackupNow({}, form({}));
    assert.equal(state.ok, true);
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.runNow" } }), before + 1);
    const created = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.create", actorName: "System" }, orderBy: { createdAt: "desc" } });
    assert.match(created.target ?? "", /-auto$/);
    await signInWith("settings.manage");
    assert.equal(await redirectOf(() => backup.runAutoBackupNow({}, form({}))), "/forbidden");
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

describe("Aufbewahrung des Audit-Logs: Mindestfrist und Protokoll der Änderung (ZP2-S-F05)", () => {
  it("weniger als 30 Tage (außer 0) wird abgelehnt – nichts gespeichert, nichts protokolliert; 30 und 0 gehen", async () => {
    for (const days of [1, 7, 29]) {
      const state = await settings.saveSecurity({}, form({ auditRetentionDays: days }));
      assert.ok(state.fieldErrors?.auditRetentionDays, String(days));
    }
    assert.equal(await retention.getAuditRetentionDays(), 730);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.security" } }), 0);
    assert.equal((await settings.saveSecurity({}, form({ auditRetentionDays: 30 }))).ok, true);
    assert.equal((await settings.saveSecurity({}, form({ auditRetentionDays: 0 }))).ok, true);
  });

  it("ein zu kurzer Altwert (vor der Mindestfrist gespeichert) gilt als Mindestfrist: 1 Tag löscht nichts, was jünger als 30 Tage ist", async () => {
    await env.db.appSetting.upsert({ where: { key: retention.AUDIT_RETENTION_KEY }, update: { value: "1" }, create: { key: retention.AUDIT_RETENTION_KEY, value: "1" } });
    assert.equal(await retention.getAuditRetentionDays(), 30);
    assert.equal(retention.parseRetentionDays("5"), 30);
    assert.equal(retention.parseRetentionDays("0"), 0);
    assert.equal(retention.parseRetentionDays("31"), 31);
    await env.db.auditLog.create({ data: { action: "user.create", actorName: "x", createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    assert.equal(await retention.pruneAuditLog(), 0);
  });

  it("die Änderung steht mit altem und neuem Wert im Audit-Log", async () => {
    await settings.saveSecurity({}, form({ auditRetentionDays: 90 }));
    await settings.saveSecurity({}, form({ auditRetentionDays: 0, behindProxy: true }));
    const entries = await env.db.auditLog.findMany({ where: { action: "settings.security" }, orderBy: { createdAt: "asc" } });
    assert.equal(entries.length, 2);
    assert.match(entries[0].target ?? "", /Audit-Aufbewahrung 730 d → 90 d/);
    assert.match(entries[1].target ?? "", /Audit-Aufbewahrung 90 d → unbegrenzt; Reverse-Proxy aus → an/);
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
    assert.ok((await settings.saveSecurity({}, form({ auditRetentionDays: -1 }))).fieldErrors?.auditRetentionDays);
    await settings.saveSecurity({}, form({ auditRetentionDays: 90 }));
    await settings.saveSecurity({}, form({ behindProxy: true }));
    assert.equal(await retention.getAuditRetentionDays(), 90);
  });
});
