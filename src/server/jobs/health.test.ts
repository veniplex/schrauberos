import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSystem, OVERDUE_MS, problemTone, RUNNER_STALE_MS, type JobHealthInput, type RunnerHealthInput } from "./health";

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
