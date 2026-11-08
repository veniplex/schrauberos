import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP_MAX_AGE_DAYS, connectionNotices, evaluateSystem, OVERDUE_MS, problemTone, RUNNER_STALE_MS, type JobHealthInput, type RunnerHealthInput } from "./health";

const now = new Date("2026-06-01T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const job = (over: Partial<JobHealthInput> = {}): JobHealthInput => ({ id: "test.job", active: true, failures: 0, lastStatus: "ok", nextRunAt: new Date(now.getTime() + 60_000), lockedUntil: null, ...over });
const runner = (over: Partial<RunnerHealthInput> = {}): RunnerHealthInput => ({ started: true, prepared: true, lastTickAt: ago(10_000), lastError: null, ...over });
const evaluate = (jobs: JobHealthInput[], over: { outboxFailed?: number; runner?: RunnerHealthInput } = {}) =>
  evaluateSystem({ now, jobs, outboxFailed: over.outboxFailed ?? 0, runner: over.runner ?? runner() });

describe("Bewertung des Systemstatus", () => {
  it("alles in Ordnung: keine Auffälligkeit", () => {
    assert.deepEqual(evaluate([job(), job({ id: "test.other", nextRunAt: ago(30_000) })]), []);
    assert.equal(problemTone([]), "success");
  });

  it("Fehlerserie, aufgegebene Ereignisse, überfällig, hängende Sperre und unterbrochen sind Auffälligkeiten", () => {
    assert.deepEqual(evaluate([job({ failures: 3, lastStatus: "error" })]), [{ code: "failing", jobId: "test.job", failures: 3 }]);
    assert.deepEqual(evaluate([], { outboxFailed: 2 }), [{ code: "outboxFailed", count: 2 }]);
    assert.deepEqual(evaluate([job({ nextRunAt: ago(OVERDUE_MS + 1) })]), [{ code: "overdue", jobId: "test.job" }]);
    assert.deepEqual(evaluate([job({ nextRunAt: ago(OVERDUE_MS - 1000) })]), [], "knapp noch im Rahmen");
    assert.deepEqual(evaluate([job({ nextRunAt: ago(OVERDUE_MS + 1), idle: true })]), [], "fällig, aber die Vorabprüfung meldet nichts zu tun: wartet auf Arbeit, kein Rückstand");
    assert.deepEqual(evaluate([job({ nextRunAt: ago(OVERDUE_MS + 1), lockedUntil: new Date(now.getTime() + 60_000) })]), [], "läuft gerade: nicht überfällig");
    assert.deepEqual(evaluate([job({ nextRunAt: ago(OVERDUE_MS + 1), lockedUntil: ago(1000) })]), [{ code: "stuck", jobId: "test.job" }], "Sperre abgelaufen, Lauf nie beendet");
    assert.deepEqual(evaluate([job({ lastStatus: "interrupted" })]), [{ code: "interrupted", jobId: "test.job" }]);
    assert.equal(problemTone([{ code: "interrupted", jobId: "x" }]), "warning", "ein Übergangszustand ist nur ein Hinweis");
    assert.equal(problemTone([{ code: "interrupted", jobId: "x" }, { code: "outboxFailed", count: 1 }]), "danger");
  });

  it("Jobs ausgeschalteter Funktionen zählen nie – auch nicht mit alter Fehlerserie", () => {
    assert.deepEqual(evaluate([job({ active: false, failures: 9, lastStatus: "error", nextRunAt: ago(24 * 3600_000) })]), []);
  });

  it("Zeitgeber: nicht gestartet, lange ohne Takt oder mit Fehler; vor dem ersten Takt gelten Jobs nach langer Pause nicht als überfällig", () => {
    assert.deepEqual(evaluate([], { runner: runner({ started: false }) }), [{ code: "runnerDown" }]);
    assert.deepEqual(evaluate([], { runner: runner({ lastTickAt: ago(RUNNER_STALE_MS + 1) }) }), [{ code: "runnerStale", lastTickAt: ago(RUNNER_STALE_MS + 1) }]);
    assert.deepEqual(evaluate([], { runner: runner({ lastError: "Vorbereitung: x" }) }), [{ code: "runnerError" }]);
    assert.deepEqual(evaluate([job({ nextRunAt: ago(3 * 3600_000) })], { runner: runner({ lastTickAt: null }) }), [], "Container war stundenlang aus; der erste Takt kommt noch");
  });
});

describe("Systemstatus: Plattenplatz, Backup und Verbindung", () => {
  const GiB = 1024 ** 3;
  const withDisk = (freeBytes: number, totalBytes: number) => evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner(), disk: { freeBytes, totalBytes } });

  it("Platz: ab 10 % frei in Ordnung, darunter ein Hinweis, unter 5 % oder unter 512 MiB ein Fehler", () => {
    assert.deepEqual(withDisk(10 * GiB, 100 * GiB), [], "genau 10 %");
    assert.deepEqual(withDisk(9.9 * GiB, 100 * GiB), [{ code: "diskLow", freeBytes: 9.9 * GiB, totalBytes: 100 * GiB }]);
    assert.deepEqual(withDisk(5 * GiB, 100 * GiB), [{ code: "diskLow", freeBytes: 5 * GiB, totalBytes: 100 * GiB }], "genau 5 % ist noch ein Hinweis");
    assert.deepEqual(withDisk(4.9 * GiB, 100 * GiB), [{ code: "diskCritical", freeBytes: 4.9 * GiB, totalBytes: 100 * GiB }]);
    // kleine Platte: 8 % von 4 GiB wären 330 MiB – unter dem Mindestplatz, den Sicherungen und Uploads brauchen
    assert.equal(withDisk(0.4 * GiB, 4 * GiB)[0].code, "diskCritical");
    assert.equal(withDisk(0.4 * GiB, 4 * GiB).length, 1);
  });

  it("meldet das Dateisystem keinen Platz (null) oder gar keinen Wert, wird nichts bewertet", () => {
    assert.deepEqual(evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner(), disk: null }), []);
    assert.deepEqual(evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner() }), []);
    assert.deepEqual(withDisk(0, 0), []);
  });

  it("Platzmangel allein ist ein Hinweis (gelb), kritisch ein Fehler (rot)", () => {
    assert.equal(problemTone(withDisk(8 * GiB, 100 * GiB)), "warning");
    assert.equal(problemTone(withDisk(1 * GiB, 100 * GiB)), "danger");
  });

  it("Backup: älter als die Frist oder gar keines ist ein Hinweis; ein frisches nicht; ohne Angabe wird nicht bewertet", () => {
    const check = (newestBackupAt?: Date | null) => evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner(), newestBackupAt });
    assert.deepEqual(check(ago(86_400_000)), []);
    assert.deepEqual(check(ago((BACKUP_MAX_AGE_DAYS * 86_400_000) - 1000)), []);
    assert.deepEqual(check(ago(BACKUP_MAX_AGE_DAYS * 86_400_000)), [{ code: "backupOld", ageDays: BACKUP_MAX_AGE_DAYS }]);
    assert.deepEqual(check(null), [{ code: "backupOld", ageDays: null }]);
    assert.deepEqual(check(undefined), []);
    assert.equal(problemTone(check(null)), "warning");
  });

  it("Verbindung: nur unverschlüsselt gibt es einen Hinweis (kein Fehler); mit Reverse-Proxy-Einstellung zusätzlich der Hinweis auf X-Forwarded-Proto", () => {
    assert.deepEqual(connectionNotices({ secure: true, behindProxy: false }), []);
    assert.deepEqual(connectionNotices({ secure: true, behindProxy: true }), []);
    assert.deepEqual(connectionNotices({ secure: false, behindProxy: false }), [{ code: "insecure" }]);
    assert.deepEqual(connectionNotices({ secure: false, behindProxy: true }), [{ code: "insecure" }, { code: "proxyMismatch" }]);
  });
});

describe("Webhooks im Systemstatus", () => {
  const withWebhooks = (webhookDeadLetters?: number, webhooksDisabled?: number) => evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner(), webhookDeadLetters, webhooksDisabled });

  it("aufgegebene Webhook-Zustellungen sind eine Störung; von der Anwendung ausgeschaltete Ziele nur ein Hinweis; ohne Angabe wird nichts bewertet", () => {
    assert.deepEqual(withWebhooks(), []);
    assert.deepEqual(withWebhooks(0, 0), []);
    assert.deepEqual(withWebhooks(3), [{ code: "webhookDeadLetters", count: 3 }]);
    assert.deepEqual(withWebhooks(0, 2), [{ code: "webhooksDisabled", count: 2 }]);
    assert.equal(problemTone(withWebhooks(3)), "danger");
    assert.equal(problemTone(withWebhooks(0, 2)), "warning");
  });
});

describe("Systemstatus: Test-Variablen im Betrieb (Z6-2 N8)", () => {
  it("gesetzte Test-Variablen sind ein Fehler im Systemstatus; ohne sie wird nichts gemeldet", async () => {
    const problems = evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner(), testVariables: ["SCHRAUBEROS_E2E"] });
    assert.deepEqual(problems, [{ code: "testMode", names: ["SCHRAUBEROS_E2E"] }]);
    assert.equal(problemTone(problems), "danger");
    assert.deepEqual(evaluateSystem({ now, jobs: [], outboxFailed: 0, runner: runner(), testVariables: [] }), []);
  });

  it("testVariablesInProduction meldet nur im echten Betrieb (APP_UPDATER=1) und nur gesetzte, nicht leere Variablen", async () => {
    const { testVariablesInProduction } = await import("@/server/e2e-mode");
    assert.deepEqual(testVariablesInProduction({ SCHRAUBEROS_E2E: "1", NODE_TEST_CONTEXT: "child" }), [], "Entwicklung und Browser-CI (ohne Starter) sind nicht betroffen");
    assert.deepEqual(testVariablesInProduction({ APP_UPDATER: "1" }), []);
    assert.deepEqual(testVariablesInProduction({ APP_UPDATER: "1", SCHRAUBEROS_E2E: "1" }), ["SCHRAUBEROS_E2E"]);
    assert.deepEqual(testVariablesInProduction({ APP_UPDATER: "1", SCHRAUBEROS_E2E: "1", NODE_TEST_CONTEXT: "child-v8" }), ["SCHRAUBEROS_E2E", "NODE_TEST_CONTEXT"]);
    assert.deepEqual(testVariablesInProduction({ APP_UPDATER: "1", SCHRAUBEROS_E2E: "" }), []);
  });
});
