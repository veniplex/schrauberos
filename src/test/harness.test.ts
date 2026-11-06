import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { browser, createTestEnv, form, isNotFound, redirectOf, type TestEnv } from "./harness";

/** Prüft das Harness selbst: Datenbank, Fake-Sitzung, Weiterleitungen, Formulardaten. */
let env: TestEnv;
let session: typeof import("@/server/auth/session");

before(async () => {
  env = await createTestEnv();
  session = await import("@/server/auth/session");
});
after(() => env.cleanup());

describe("Testharness", () => {
  it("wendet die Migrationen an und teilt die Datenbank mit der Anwendung", async () => {
    const { db } = await import("@/server/db");
    assert.equal(db, env.db);
    const role = await env.role({ permissions: ["appointments.view"] });
    assert.equal((await db.rolePermission.count({ where: { roleId: role.id } })), 1);
  });

  it("requireSession leitet ohne Sitzung auf /login um und liefert danach die Fake-Sitzung", async () => {
    env.signOut();
    assert.equal(await redirectOf(() => session.requireSession()), "/login");
    const role = await env.role({ permissions: ["appointments.view"] });
    const user = await env.user({ username: "anna", roles: [role] });
    await env.signIn(user);
    const s = await session.requireSession();
    assert.equal(s.user.username, "anna");
    assert.ok(s.can("appointments.view"));
    assert.ok(!s.can("appointments.edit"));
  });

  it("requirePermission: ohne Recht /forbidden, bei ausgeschalteter Funktion notFound()", async () => {
    assert.equal(await redirectOf(() => session.requirePermission("appointments.edit")), "/forbidden");
    await env.db.featureSetting.create({ data: { key: "workshop.appointments", enabled: false, updatedByName: "test" } });
    assert.equal(await isNotFound(() => session.requirePermission("appointments.view")), true);
  });

  it("Cookies bleiben zwischen Aufrufen erhalten und Header sind pro Test setzbar", async () => {
    env.signOut();
    await env.user({ username: "bert", password: "geheim-123" });
    assert.deepEqual(await session.login("bert", "geheim-123"), { ok: true, mustChangePassword: false });
    assert.ok(browser.writes.some((w) => w.name === "so_session" && w.options.secure === false), "Sitzungs-Cookie ohne Secure im HTTP-LAN");
    browser.setHeaders({ "x-forwarded-proto": "https" });
    assert.equal(browser.headers.get("X-Forwarded-Proto"), "https");
    browser.reset();
    assert.equal(browser.headers.get("x-forwarded-proto"), null);
    assert.equal(browser.cookies.size, 0);
  });

  it("form() bildet Checkboxen und Mehrfachfelder wie ein Browser ab", () => {
    const fd = form({ name: "x", active: true, off: false, roleId: ["a", "b"], leer: undefined, zahl: 3 });
    assert.equal(fd.get("active"), "on");
    assert.equal(fd.has("off"), false);
    assert.deepEqual(fd.getAll("roleId"), ["a", "b"]);
    assert.equal(fd.has("leer"), false);
    assert.equal(fd.get("zahl"), "3");
  });
});
