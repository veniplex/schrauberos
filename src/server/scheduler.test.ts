import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Zeitgeber (ZP2-A-F12): Die Bereinigung gilt erst als erledigt, wenn sie gelungen ist – ein Fehler verschiebt sie nicht um einen Tag. */
let env: TestEnv;
let scheduler: typeof import("./backup/scheduler");
let cleanup: typeof import("./api/cleanup");

before(async () => {
  env = await createTestEnv();
  scheduler = await import("./backup/scheduler");
  cleanup = await import("./api/cleanup");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_audit_delete"');
  await env.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_block_token_delete"');
  await env.db.auditLog.deleteMany();
  await env.db.apiToken.deleteMany();
  scheduler.resetSchedulerForTest();
  delete (globalThis as { __lastApiTokenPrune?: number }).__lastApiTokenPrune;
});

describe("Zeitgeber: Fehler verschieben die Bereinigung nicht um einen Tag", () => {
  it("Audit-Bereinigung: scheitert der Lauf, versucht der nächste Takt es wieder; nach Erfolg erst nach einem Tag", async () => {
    await env.db.auditLog.create({ data: { action: "user.create", actorName: "x", createdAt: new Date(Date.now() - 800 * 86_400_000) } });
    await env.db.$executeRawUnsafe(`CREATE TRIGGER "test_block_audit_delete" BEFORE DELETE ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'blockiert'); END`);
    await assert.rejects(scheduler.runAuditRetention());
    await env.db.$executeRawUnsafe('DROP TRIGGER "test_block_audit_delete"');
    assert.equal(await scheduler.runAuditRetention(), 1, "der zweite Versuch läuft sofort und räumt auf");
    assert.equal(await scheduler.runAuditRetention(), 0, "danach gilt der Tag als erledigt");
  });

  it("API-Aufräumen (Tokens): ebenso", async () => {
    const owner = await env.user({ username: "besitzer" });
    await env.db.apiToken.create({ data: { name: "alt", tokenHash: "h".repeat(64), hint: "sos_abcd…", userId: owner.id, expiresAt: new Date(Date.now() - 200 * 86_400_000) } });
    await env.db.$executeRawUnsafe(`CREATE TRIGGER "test_block_token_delete" BEFORE DELETE ON "ApiToken" BEGIN SELECT RAISE(ABORT, 'blockiert'); END`);
    await assert.rejects(cleanup.runApiCleanup());
    await env.db.$executeRawUnsafe('DROP TRIGGER "test_block_token_delete"');
    assert.equal(await cleanup.runApiCleanup(), 1);
    assert.equal(await cleanup.runApiCleanup(), 0);
  });
});
