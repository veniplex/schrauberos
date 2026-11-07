import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { emptyState } from "@/lib/updates/state";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Integritätsbefund des Starters → ein einziger Audit-Eintrag (`system.integrityFailed`), von der App beim Start geschrieben. Der Launcher der eingebauten Version trägt den
 * Befund als `state.last.reason = integrity:<Code>` ein; die App merkt sich in einer eigenen Datei, was sie gemeldet hat (nicht in `state.json`: zwei Schreiber).
 */
let env: TestEnv;
let report: typeof import("./integrity-report");
let store: typeof import("@/lib/updates/store");

before(async () => {
  env = await createTestEnv();
  report = await import("./integrity-report");
  store = await import("@/lib/updates/store");
});
after(() => env.cleanup());
beforeEach(async () => {
  rmSync(path.join(env.dir, "app"), { recursive: true, force: true });
  mkdirSync(path.join(env.dir, "app"), { recursive: true });
  await env.db.auditLog.deleteMany();
});

const rolledBack = (reason: string, at = "2026-11-07T10:00:00.000Z", detail?: string) =>
  store.writeState({ ...emptyState(), failed: ["1.2.0"], last: { at, version: "1.2.0", status: "rolled-back", reason, ...(detail ? { detail } : {}) } });

describe("Audit bei Integritätsbefund", () => {
  it("schreibt genau einen Eintrag je Befund, nennt Version, Code und Pfad (bereinigt) und ist beim zweiten Aufruf still", async () => {
    rolledBack("integrity:15", undefined, "extra\u001b[2J.txt");
    assert.equal(await report.reportIntegrityOnce(), true);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "system.integrityFailed" } });
    assert.match(entry.target ?? "", /^1\.2\.0: integrity:15 \(extra.*\.txt\)$/);
    assert.doesNotMatch(entry.target ?? "", /\u001b/);
    assert.equal(entry.actorName, "System");
    assert.equal(await report.reportIntegrityOnce(), false);
    assert.equal(await env.db.auditLog.count({ where: { action: "system.integrityFailed" } }), 1);
  });

  it("ein neuer Befund (anderer Zeitpunkt) wird wieder gemeldet", async () => {
    rolledBack("integrity:15", "2026-11-07T10:00:00.000Z");
    await report.reportIntegrityOnce();
    rolledBack("integrity:16", "2026-11-08T10:00:00.000Z");
    assert.equal(await report.reportIntegrityOnce(), true);
    assert.equal(await env.db.auditLog.count({ where: { action: "system.integrityFailed" } }), 2);
  });

  it("andere Rückfälle (Gesundheitsprüfung), erfolgreiche Updates und ein leerer Zustand erzeugen keinen Eintrag", async () => {
    rolledBack("antwortet nicht gesund");
    assert.equal(await report.reportIntegrityOnce(), false);
    store.writeState({ ...emptyState(), last: { at: "t", version: "1.2.0", status: "ok" } });
    assert.equal(await report.reportIntegrityOnce(), false);
    store.writeState(emptyState());
    assert.equal(await report.reportIntegrityOnce(), false);
    assert.equal(await env.db.auditLog.count(), 0);
  });
});
