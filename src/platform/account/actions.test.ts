import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Konto im Aktions-Rahmen: Profil, Passwort ändern (auch beim erzwungenen Wechsel), Sprache/Design. */
let env: TestEnv;
let actions: typeof import("./actions");
let prefs: typeof import("@/server/actions/preferences");
let passwordMod: typeof import("@/server/auth/password");
let throttle: typeof import("@/server/auth/throttle");
let session: typeof import("@/server/auth/session");
let decodeFlash: typeof import("@/server/operations/flash").decodeFlash;
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  prefs = await import("@/server/actions/preferences");
  passwordMod = await import("@/server/auth/password");
  throttle = await import("@/server/auth/throttle");
  session = await import("@/server/auth/session");
  ({ decodeFlash } = await import("@/server/operations/flash"));
});
after(() => env.cleanup());

const OLD = "altes-passwort-123";
const NEW = "neues-passwort-456";
let user: Awaited<ReturnType<TestEnv["user"]>>;

beforeEach(async () => {
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  throttle.resetLoginThrottle();
  user = await env.user({ username: "anna", name: "Anna", password: OLD });
  await env.signIn(user);
});

const change = (fields: Record<string, string> = {}) => actions.changePassword({}, form({ current: OLD, next: NEW, confirm: NEW, ...fields }));

describe("Profil", () => {
  it("ändert Namen und E-Mail der eigenen Person, protokolliert und prüft die Eingabe", async () => {
    const state = await actions.saveProfile({}, form({ name: "Anna Neu", email: "anna@example.com" }));
    assert.equal(state.ok, true);
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual([row.name, row.email], ["Anna Neu", "anna@example.com"]);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "account.profile" } });
    assert.deepEqual([entry.target, entry.entityId], ["anna", user.id]);

    assert.ok((await actions.saveProfile({}, form({ name: "   " }))).fieldErrors?.name);
    assert.ok((await actions.saveProfile({}, form({ name: "Anna", email: "kein-mail" }))).fieldErrors?.email);
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).name, "Anna Neu");
    assert.equal((await actions.saveProfile({}, form({ name: "Anna" }))).ok, true);
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).email, null, "leere E-Mail löscht sie");
  });

  it("ändert nie ein anderes Konto: die Person kommt aus der Sitzung, nicht aus dem Formular", async () => {
    const other = await env.user({ username: "bernd", name: "Bernd" });
    await actions.saveProfile({}, form({ id: other.id, userId: other.id, name: "Gekapert" }));
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: other.id } })).name, "Bernd");
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).name, "Gekapert");
  });

  it("ohne Anmeldung zur Anmeldung", async () => {
    env.signOut();
    assert.equal(await redirectOf(() => actions.saveProfile({}, form({ name: "X" }))), "/login");
  });
});

describe("Passwort ändern", () => {
  it("setzt das neue Passwort, protokolliert und meldet den Erfolg", async () => {
    const state = await change();
    assert.equal(state.ok, true);
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(await passwordMod.verifyPassword(NEW, row.passwordHash), true);
    assert.equal(await passwordMod.verifyPassword(OLD, row.passwordHash), false);
    assert.equal(await env.db.auditLog.count({ where: { action: "account.password" } }), 1);
    assert.equal(JSON.stringify(await env.db.auditLog.findMany()).includes(NEW), false, "das Passwort steht nirgends im Audit-Log");
  });

  it("falsches aktuelles Passwort: Feldfehler, nichts geändert, kein Audit", async () => {
    const state = await change({ current: "falsch-falsch-1" });
    assert.ok(state.fieldErrors?.current);
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(await passwordMod.verifyPassword(OLD, row.passwordHash), true);
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("prüft Länge, Wiederholung und Abweichung vom alten Passwort", async () => {
    assert.ok((await change({ next: "kurz", confirm: "kurz" })).fieldErrors?.next);
    assert.ok((await change({ confirm: "etwas-anderes-789" })).fieldErrors?.confirm);
    assert.ok((await change({ next: OLD, confirm: OLD })).fieldErrors?.next);
    assert.ok((await change({ next: "x".repeat(2000), confirm: "x".repeat(2000) })).fieldErrors?.next);
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(await passwordMod.verifyPassword(OLD, row.passwordHash), true);
  });

  it("Leerzeichen am Rand gehören zum Passwort (nichts wird getrimmt)", async () => {
    const spaced = "  mit-leerzeichen-1  ";
    assert.equal((await change({ next: spaced, confirm: spaced })).ok, true);
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(await passwordMod.verifyPassword(spaced, row.passwordHash), true);
    assert.equal(await passwordMod.verifyPassword(spaced.trim(), row.passwordHash), false);
  });

  it("beendet die Sitzungen anderer Geräte, die aktuelle bleibt", async () => {
    await env.db.session.create({ data: { tokenHash: "anderes-geraet", userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    assert.equal((await change()).ok, true);
    assert.equal(await env.db.session.count({ where: { userId: user.id } }), 1);
    assert.ok(await session.getSession());
  });

  it("Passwort-Raten mit einer gestohlenen Sitzung wird gedrosselt – auch das richtige Passwort wartet dann", async () => {
    let throttled = false;
    for (let i = 0; i < 12 && !throttled; i++) {
      const state = await change({ current: `falsch-${i}-passwort` });
      throttled = !!state.error;
    }
    assert.equal(throttled, true, "nach mehreren Fehlversuchen kommt eine Wartezeit");
    const state = await change();
    assert.ok(state.error, "während der Wartezeit wird nicht einmal das richtige Passwort geprüft");
    assert.equal(await passwordMod.verifyPassword(OLD, (await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash), true);
  });

  it("Konten mit externer Anmeldequelle haben kein lokales Passwort zu ändern", async () => {
    await env.db.user.update({ where: { id: user.id }, data: { authSource: "ldap" } });
    assert.ok((await change()).error);
  });

  it("erzwungener Wechsel: die Aktion läuft trotz mustChangePassword, hebt den Zwang auf und leitet zur Startseite", async () => {
    await env.db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    assert.equal(await redirectOf(() => change()), "/");
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(row.mustChangePassword, false);
    assert.equal(await passwordMod.verifyPassword(NEW, row.passwordHash), true);
    const flash = decodeFlash(env.browser.writes.filter((w) => w.name === "so_flash").at(-1)?.value ?? null);
    assert.equal(flash?.key, "account.passwordChanged");
  });

  it("auch das Profil lässt sich beim erzwungenen Wechsel ändern (alle anderen Aktionen führen zum Konto, siehe Berechtigungs-Matrix)", async () => {
    await env.db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    assert.equal((await actions.saveProfile({}, form({ name: "Anna Z" }))).ok, true);
  });
});

describe("Sprache und Design", () => {
  const set = (action: (formData: FormData) => Promise<void>, field: string, value: string) => action(form({ [field]: value }));

  it("speichern im Profil und als Cookie, auch beim erzwungenen Passwortwechsel", async () => {
    await set(prefs.setLocale, "locale", "en");
    await set(prefs.setTheme, "theme", "dark");
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual([row.locale, row.theme], ["en", "dark"]);
    const cookies = Object.fromEntries(env.browser.writes.map((w) => [w.name, w.value]));
    assert.equal(cookies["so_locale"], "en");
    assert.equal(cookies["so_theme"], "dark");

    await env.db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    assert.equal(await redirectOf(() => set(prefs.setLocale, "locale", "de")), null);
    assert.equal((await env.db.user.findUniqueOrThrow({ where: { id: user.id } })).locale, "de");
  });

  it("ungültige Werte werden ignoriert: weder Profil noch Cookie ändern sich", async () => {
    const before = env.browser.writes.length;
    await set(prefs.setLocale, "locale", "klingonisch");
    await set(prefs.setTheme, "theme", "neon");
    const row = await env.db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual([row.locale, row.theme], [null, null]);
    assert.equal(env.browser.writes.slice(before).filter((w) => w.name !== "so_flash").length, 0);
  });

  it("ohne Anmeldung zur Anmeldung – kein Cookie wird gesetzt", async () => {
    env.signOut();
    const before = env.browser.writes.length;
    assert.equal(await redirectOf(() => set(prefs.setLocale, "locale", "en")), "/login");
    assert.equal(env.browser.writes.length, before);
  });
});
