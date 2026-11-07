import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Nach einer Wiederherstellung gelten keine API-Tokens mehr (ZP2-A-F5): Die Sicherung kennt keine Widerrufe, die seitdem geschehen sind.
 * Der Launcher legt `restore/applied.json` an, bis er den gesunden Start bestätigt; solange der Merker da ist, widerruft die App beim Start alle Tokens.
 */
let env: TestEnv;
let startup: typeof import("./startup");

before(async () => {
  env = await createTestEnv();
  startup = await import("./startup");
});
after(() => env.cleanup());

const restoreDir = () => path.join(env.dir, "restore");
const markApplied = () => {
  mkdirSync(restoreDir(), { recursive: true });
  writeFileSync(path.join(restoreDir(), "applied.json"), JSON.stringify({ from: "schrauberos-20260101T020000Z-manual", at: "2026-11-06T10:00:00.000Z", files: false }));
};

beforeEach(async () => {
  rmSync(restoreDir(), { recursive: true, force: true });
  await env.db.apiToken.deleteMany();
  await env.db.auditLog.deleteMany();
});

describe("API-Tokens nach einer Wiederherstellung", () => {
  it("ohne Merker der Wiederherstellung bleibt alles, wie es ist (normaler Neustart)", async () => {
    await makeToken(env, { scope: ["customers.view"], ownerPermissions: ["customers.view"] });
    assert.equal(await startup.revokeApiTokensAfterRestore(), 0);
    assert.equal(await env.db.apiToken.count({ where: { revokedAt: null } }), 1);
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("mit Merker werden alle noch gültigen Tokens widerrufen und im Audit-Log festgehalten; ein zweiter Start (vor der Bestätigung) ändert nichts mehr", async () => {
    const a = await makeToken(env, { scope: ["customers.view"], ownerPermissions: ["customers.view"] });
    await makeToken(env, { scope: ["customers.view"], ownerPermissions: ["customers.view"] });
    const already = new Date(Date.now() - 86_400_000);
    await makeToken(env, { scope: ["customers.view"], ownerPermissions: ["customers.view"], revokedAt: already });
    markApplied();

    assert.equal(await startup.revokeApiTokensAfterRestore(), 2);
    assert.equal(await env.db.apiToken.count({ where: { revokedAt: null } }), 0);
    assert.equal((await env.db.apiToken.findUniqueOrThrow({ where: { id: a.id } })).revokedAt !== null, true);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "apiToken.restoreRevoked" } });
    assert.match(entry.target ?? "", /^2 \(Sicherung schrauberos-20260101T020000Z-manual\)$/);
    assert.equal(entry.actorName, "System");

    assert.equal(await startup.revokeApiTokensAfterRestore(), 0, "idempotent: nichts mehr zu widerrufen, kein weiterer Eintrag");
    assert.equal(await env.db.auditLog.count({ where: { action: "apiToken.restoreRevoked" } }), 1);
  });

  it("nach der Bestätigung durch den Launcher (Merker entfernt) wirkt das Widerrufen nicht mehr: neue Tokens bleiben gültig", async () => {
    markApplied();
    await startup.revokeApiTokensAfterRestore();
    rmSync(path.join(restoreDir(), "applied.json"));
    await makeToken(env, { scope: ["customers.view"], ownerPermissions: ["customers.view"] });
    assert.equal(await startup.revokeApiTokensAfterRestore(), 0);
    assert.equal(await env.db.apiToken.count({ where: { revokedAt: null } }), 1);
  });
});

describe("Abo-Adressen des Kalenders nach einer Wiederherstellung (F10)", () => {
  it("mit Merker werden alle Abo-Adressen gelöscht (ein inzwischen widerrufenes Token wäre mit der Sicherung wieder gültig) und im Audit-Log festgehalten; ohne Merker bleiben sie", async () => {
    const user = await env.user({ username: `feed-${Math.random().toString(36).slice(2)}` });
    await env.db.calendarFeedToken.create({ data: { userId: user.id, tokenHash: "a".repeat(64), hint: "cal_abcd…" } });
    assert.equal(await startup.revokeApiTokensAfterRestore(), 0);
    assert.equal(await env.db.calendarFeedToken.count(), 1, "normaler Neustart: alles bleibt");

    markApplied();
    await startup.revokeApiTokensAfterRestore();
    assert.equal(await env.db.calendarFeedToken.count(), 0);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "calendarFeed.restoreRevoked" } });
    assert.match(entry.target ?? "", /^1 \(Sicherung schrauberos-20260101T020000Z-manual\)$/);
    assert.equal(entry.actorName, "System");
    assert.equal(await env.db.auditLog.count({ where: { action: "calendarFeed.restoreRevoked" } }), 1, "ein zweiter Start schreibt nichts mehr");
  });
});

describe("Webhooks nach einer Wiederherstellung (F11, auch mit Wiederherstellungsschlüssel)", () => {
  it("mit Merker: eingeschaltete Webhooks gehen aus (Grund „restore“), wartende Zustellungen werden zurückgestellt, Audit je Ziel; ohne Merker und bei bewusst ausgeschalteten Zielen ändert sich nichts", async () => {
    await env.db.webhookDelivery.deleteMany();
    await env.db.webhook.deleteMany();
    const on = await env.db.webhook.create({ data: { name: "Produktiv", url: "https://hook.example.org/p", events: "order.closed", enabled: true } });
    const off = await env.db.webhook.create({ data: { name: "Bewusst aus", url: "https://hook.example.org/o", events: "order.closed", enabled: false, disabledReason: "gone" } });
    const delivery = (webhookId: string, eventId: string, status: string) => env.db.webhookDelivery.create({ data: { webhookId, eventId, type: "order.closed", eventAt: new Date(), status } });
    await delivery(on.id, "e1", "pending");
    await delivery(on.id, "e2", "sent");

    assert.equal(await startup.revokeApiTokensAfterRestore(), 0);
    assert.equal((await env.db.webhook.findUniqueOrThrow({ where: { id: on.id } })).enabled, true, "ohne Merker (normaler Neustart) bleibt es an");

    markApplied();
    await startup.revokeApiTokensAfterRestore();
    const after = await env.db.webhook.findUniqueOrThrow({ where: { id: on.id } });
    assert.deepEqual([after.enabled, after.disabledReason], [false, "restore"]);
    assert.equal((await env.db.webhook.findUniqueOrThrow({ where: { id: off.id } })).disabledReason, "gone", "ein anderes Ausschalten behält seinen Grund");
    assert.equal((await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "e1" } })).status, "held", "nichts wird ungeprüft nachgeholt");
    assert.equal((await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "e2" } })).status, "sent");
    const audits = await env.db.auditLog.findMany({ where: { action: "webhook.disabled" } });
    assert.equal(audits.length, 1);
    assert.match(audits[0].target ?? "", /^Produktiv: restore \(Sicherung /);

    // deliverDue sendet nichts mehr (Ziel aus, Zustellung zurückgestellt)
    const { deliverDue } = await import("@/server/webhooks/deliver");
    const summary = await deliverDue({});
    assert.equal(summary.sent + summary.retried + summary.failed, 0);
  });
});
