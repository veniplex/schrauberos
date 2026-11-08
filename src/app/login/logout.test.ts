import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, redirectOf, type TestEnv } from "@/test/harness";

/** Abmelden (Z6-1 M2): öffentlich erreichbar, aber ohne Sitzung darf der Aufruf nichts schreiben. */
let env: TestEnv;
let actions: typeof import("./actions");

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.db.auditLog.deleteMany();
  env.browser.reset();
});

describe("logoutAction", () => {
  it("200 Aufrufe ohne Sitzung schreiben keine Audit-Zeile", async () => {
    for (let i = 0; i < 200; i++) assert.equal(await redirectOf(() => actions.logoutAction()), "/login");
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("mit Sitzung: genau ein Eintrag mit dem Konto als Handelndem, die Sitzung ist weg", async () => {
    const user = await env.user({ username: "abmelder" });
    await env.signIn(user);
    assert.equal(await env.db.session.count(), 1);
    assert.equal(await redirectOf(() => actions.logoutAction()), "/login");
    const rows = await env.db.auditLog.findMany({ where: { action: "auth.logout" } });
    assert.deepEqual(rows.map((r) => r.actorId), [user.id]);
    assert.equal(await env.db.session.count(), 0);
    // ein zweiter Aufruf mit demselben (jetzt ungültigen) Cookie schreibt nichts mehr
    assert.equal(await redirectOf(() => actions.logoutAction()), "/login");
    assert.equal(await env.db.auditLog.count({ where: { action: "auth.logout" } }), 1);
  });
});
