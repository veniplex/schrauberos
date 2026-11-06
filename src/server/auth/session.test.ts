import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { createTestEnv, isNotFound, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Sitzung und Rechteprüfung: getSession (gültig, abgelaufen, deaktiviert, Funktion aus), requireSession/requirePermission (Anmeldung →
 * /login, Passwortwechsel → /account, fehlendes Recht → /forbidden, ausgeschaltete Funktion → 404), sessionIfAllowed, revokeSessions.
 * (Die Anmeldung selbst, Cookies und Drosselung prüft login.test.ts.)
 */
let env: TestEnv;
let session: typeof import("./session");
before(async () => {
  env = await createTestEnv();
  session = await import("./session");
});
after(() => env.cleanup());

const sha = (token: string) => createHash("sha256").update(token).digest("hex");
let n = 0;

/** Benutzer mit genau diesen Rechten, angemeldet; liefert Benutzer und Sitzungs-Token. */
async function signedIn(options: { permissions?: string[]; admin?: boolean; mustChangePassword?: boolean; active?: boolean } = {}) {
  const role = await env.role({ key: `s-${++n}`, isAdmin: options.admin, permissions: options.permissions ?? [] });
  const user = await env.user({ username: `s-user-${n}`, mustChangePassword: options.mustChangePassword, active: options.active, roles: [role] });
  env.signOut();
  await env.signIn(user);
  return { user, role, token: env.browser.cookies.get(SESSION_COOKIE)! };
}

beforeEach(async () => {
  await env.db.featureSetting.deleteMany();
  env.browser.reset();
});

describe("getSession", () => {
  it("ohne Cookie, mit unbekanntem Token oder leerem Token: keine Sitzung", async () => {
    assert.equal(await session.getSession(), null);
    env.browser.cookies.set(SESSION_COOKIE, randomBytes(32).toString("base64url"));
    assert.equal(await session.getSession(), null);
    env.browser.cookies.set(SESSION_COOKIE, "");
    assert.equal(await session.getSession(), null);
  });

  it("liefert Benutzer, Rollen und die Rechte der Rollen", async () => {
    const { user } = await signedIn({ permissions: ["customers.view", "customers.edit"] });
    const s = (await session.getSession())!;
    assert.equal(s.user.id, user.id);
    assert.equal(s.user.isAdmin, false);
    assert.equal(s.can("customers.view"), true);
    assert.equal(s.can("customers.delete"), false);
    assert.equal(s.can("invoices.view"), false);
  });

  it("Administratoren haben alle Rechte – außer denen ausgeschalteter Funktionen", async () => {
    await signedIn({ admin: true });
    assert.equal((await session.getSession())!.can("customers.delete"), true);
    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    const s = (await session.getSession())!;
    assert.equal(s.can("customers.delete"), false, "ausgeschaltete Funktion: auch für Administratoren keine Rechte");
    assert.equal(s.features.has("workshop.customers"), false);
    assert.equal(s.can("vehicles.view"), true);
  });

  it("eine abgelaufene Sitzung ist keine Sitzung", async () => {
    const { token } = await signedIn({ permissions: ["customers.view"] });
    await env.db.session.updateMany({ where: { tokenHash: sha(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await session.getSession(), null);
  });

  it("ein deaktiviertes Konto verliert die Sitzung sofort", async () => {
    const { user } = await signedIn({ permissions: ["customers.view"] });
    assert.ok(await session.getSession());
    await env.db.user.update({ where: { id: user.id }, data: { active: false } });
    assert.equal(await session.getSession(), null);
  });

  it("entzogene Rechte gelten mit der nächsten Anfrage, ohne neue Anmeldung", async () => {
    const { role } = await signedIn({ permissions: ["customers.view", "customers.edit"] });
    await env.db.rolePermission.deleteMany({ where: { roleId: role.id, permission: "customers.edit" } });
    assert.equal((await session.getSession())!.can("customers.edit"), false);
  });

  it("schreibt lastUsedAt höchstens alle zehn Minuten", async () => {
    const { token } = await signedIn({ permissions: [] });
    const fresh = await env.db.session.findUniqueOrThrow({ where: { tokenHash: sha(token) } });
    await session.getSession();
    assert.equal((await env.db.session.findUniqueOrThrow({ where: { tokenHash: sha(token) } })).lastUsedAt.getTime(), fresh.lastUsedAt.getTime(), "frisch: nicht neu geschrieben");
    const old = new Date(Date.now() - 11 * 60_000);
    await env.db.session.update({ where: { tokenHash: sha(token) }, data: { lastUsedAt: old } });
    await session.getSession();
    assert.ok((await env.db.session.findUniqueOrThrow({ where: { tokenHash: sha(token) } })).lastUsedAt.getTime() > old.getTime());
  });

  it("speichert nur den Hash des Tokens", async () => {
    const { token } = await signedIn({ permissions: [] });
    const rows = await env.db.session.findMany();
    assert.equal(rows.some((row) => JSON.stringify(row).includes(token)), false);
  });
});

describe("requireSession", () => {
  it("ohne Anmeldung nach /login", async () => {
    assert.equal(await redirectOf(() => session.requireSession()), "/login");
  });

  it("mit ausstehendem Passwortwechsel nach /account – außer die Seite erlaubt ihn", async () => {
    await signedIn({ mustChangePassword: true });
    assert.equal(await redirectOf(() => session.requireSession()), "/account");
    assert.equal(await redirectOf(() => session.requireSession({ allowPasswordChange: true })), null);
  });

  it("liefert die Sitzung, wenn alles stimmt", async () => {
    const { user } = await signedIn();
    assert.equal((await session.requireSession()).user.id, user.id);
  });
});

describe("requirePermission", () => {
  it("ohne Anmeldung /login, mit Passwortwechsel /account, ohne Recht /forbidden", async () => {
    assert.equal(await redirectOf(() => session.requirePermission("customers.view")), "/login");
    await signedIn({ mustChangePassword: true, admin: true });
    assert.equal(await redirectOf(() => session.requirePermission("customers.view")), "/account");
    await signedIn({ permissions: ["vehicles.view"] });
    assert.equal(await redirectOf(() => session.requirePermission("customers.view")), "/forbidden");
  });

  it("mit dem Recht: die Sitzung", async () => {
    await signedIn({ permissions: ["customers.view"] });
    assert.equal((await session.requirePermission("customers.view")).can("customers.view"), true);
  });

  it("gehört das Recht zu einer ausgeschalteten Funktion, gibt es die Seite nicht (404) – auch für Administratoren", async () => {
    await signedIn({ admin: true });
    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    assert.equal(await isNotFound(() => session.requirePermission("customers.view")), true);
    assert.equal(await redirectOf(() => session.requirePermission("vehicles.view")), null);
  });
});

describe("sessionIfAllowed (Seitentitel)", () => {
  it("liefert die Sitzung nur mit Anmeldung, ohne offenen Passwortwechsel und mit dem Recht – und leitet nie weiter", async () => {
    assert.equal(await session.sessionIfAllowed("customers.view"), null);
    await signedIn({ permissions: ["customers.view"], mustChangePassword: true });
    assert.equal(await session.sessionIfAllowed("customers.view"), null);
    await signedIn({ permissions: ["vehicles.view"] });
    assert.equal(await session.sessionIfAllowed("customers.view"), null);
    await signedIn({ permissions: ["customers.view"] });
    assert.ok(await session.sessionIfAllowed("customers.view"));
    await env.db.featureSetting.create({ data: { key: "workshop.customers", enabled: false } });
    assert.equal(await session.sessionIfAllowed("customers.view"), null, "ausgeschaltete Funktion");
  });
});

describe("revokeSessions", () => {
  it("beendet alle Sitzungen des Benutzers; auf Wunsch bleibt die aktuelle bestehen; andere Benutzer bleiben unberührt", async () => {
    const { user, token } = await signedIn({ permissions: [] });
    const otherDevice = randomBytes(32).toString("base64url");
    await env.db.session.create({ data: { tokenHash: sha(otherDevice), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const { user: stranger } = await signedIn({ permissions: [] });
    env.browser.cookies.set(SESSION_COOKIE, token);

    await session.revokeSessions(user.id, true);
    assert.equal(await env.db.session.count({ where: { userId: user.id } }), 1);
    assert.ok(await session.getSession(), "die aktuelle Sitzung besteht");
    assert.equal(await env.db.session.count({ where: { userId: stranger.id } }), 1);

    await session.revokeSessions(user.id);
    assert.equal(await env.db.session.count({ where: { userId: user.id } }), 0);
    assert.equal(await session.getSession(), null);
    assert.equal(await env.db.session.count({ where: { userId: stranger.id } }), 1);
  });
});
