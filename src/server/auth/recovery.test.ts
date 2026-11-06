import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Role, User } from "@/generated/prisma/client";
import { bytesToDataChars, formatRecoveryCode } from "@/lib/recovery-code";
import { browser, createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * Notzugang (Wiederherstellungs-Code): Einlösen, gleiche Antwort und Dauer für alle Fehler, globale Drosselung ohne Konto-Sperre,
 * Wiederverwendung, Sitzungsende, Hinweise, Erzeugen im Konto. Uhr und Warten sind ersetzt (kein echtes Abwarten).
 */
let env: TestEnv;
let recovery: typeof import("./recovery");
let session: typeof import("./session");
let runtime: typeof import("./runtime");
let throttle: typeof import("./throttle");
let passwordMod: typeof import("./password");
let recoverActions: typeof import("@/app/login/recover/actions");
let accountActions: typeof import("@/platform/account/recovery-actions");
let setupActions: typeof import("@/app/setup/actions");
let setupToken: typeof import("@/server/setup-token");
let userActions: typeof import("@/modules/admin/users/actions");

let adminRole: Role;
let userRole: Role;
let admin: User;
let clock = 1_800_000_000_000;
let sleeps: number[] = [];

const PASSWORD = "altes-passwort-123";
const NEW_PASSWORD = "neues-passwort-456";

before(async () => {
  env = await createTestEnv();
  recovery = await import("./recovery");
  session = await import("./session");
  runtime = await import("./runtime");
  throttle = await import("./throttle");
  passwordMod = await import("./password");
  recoverActions = await import("@/app/login/recover/actions");
  accountActions = await import("@/platform/account/recovery-actions");
  setupActions = await import("@/app/setup/actions");
  setupToken = await import("@/server/setup-token");
  userActions = await import("@/modules/admin/users/actions");
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  runtime.authRuntime.now = () => clock;
  runtime.authRuntime.sleep = async (ms) => void sleeps.push(ms);
  runtime.authRuntime.random = () => 0.5;
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.recoveryNoticeAck.deleteMany();
  await env.db.recoveryNotice.deleteMany();
  await env.db.recoveryCode.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.appSetting.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany({ where: { key: { in: ["rec-admin", "rec-user"] } } });
  browser.reset();
  throttle.resetLoginThrottle();
  setupToken.resetSetupGate();
  clock = 1_800_000_000_000;
  sleeps = [];
  adminRole = await env.role({ key: "rec-admin", isAdmin: true });
  userRole = await env.role({ key: "rec-user", permissions: ["appointments.view"] });
  admin = await env.user({ username: "chef", name: "Chef", password: PASSWORD, roles: [adminRole] });
  passwordMod.hashStats.computed = 0;
});

/** Legt einen Code für ein Konto an und liefert den Klartext. */
const issue = async (user: User = admin) => env.db.$transaction((tx) => recovery.replaceRecoveryCode(tx, user.id));
const redeem = (code: string, password = NEW_PASSWORD, ip: string | null = null) => recovery.redeemRecoveryCode({ code, password, ip });
const recoverForm = (code: string, password = NEW_PASSWORD, confirm = password) => form({ code, password, confirm });
const randomCode = () => formatRecoveryCode(bytesToDataChars(crypto.getRandomValues(new Uint8Array(20))));

describe("Einlösen", () => {
  it("setzt das Passwort, beendet alle Sitzungen, meldet nicht an, ersetzt den Code und legt Hinweis und Audit an", async () => {
    const code = await issue();
    await env.signIn(admin);
    await env.signIn(admin);
    const other = await env.user({ username: "andere", roles: [userRole] });
    await env.signIn(other);
    env.signOut();

    const result = await redeem(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(result.newCode, code);

    // alle Sitzungen des Kontos sind weg, die anderer Konten bleiben; kein Auto-Login (kein Cookie)
    assert.equal(await env.db.session.count({ where: { userId: admin.id } }), 0);
    assert.equal(await env.db.session.count({ where: { userId: other.id } }), 1);
    assert.equal(browser.cookies.size, 0);
    // neues Passwort gilt, altes nicht
    assert.equal((await session.login("chef", NEW_PASSWORD)).ok, true);
    env.signOut();
    assert.equal((await session.login("chef", PASSWORD)).ok, false);
    // der Code liegt nur als Hash in der Datenbank
    const stored = await env.db.recoveryCode.findUniqueOrThrow({ where: { userId: admin.id } });
    assert.match(stored.codeHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(stored).includes(result.newCode.replaceAll("-", "")), false);
    assert.equal(stored.confirmedAt, null);
    // Hinweis für das Konto
    assert.equal(await env.db.recoveryNotice.count({ where: { userId: admin.id } }), 1);
  });

  it("der alte Code ist nach dem Einlösen ungültig (Wiederverwendung scheitert), der neue gilt", async () => {
    const code = await issue();
    const first = await redeem(code);
    assert.equal(first.ok, true);
    assert.deepEqual(await redeem(code, "noch-ein-passwort-789"), { ok: false, reason: "invalid" });
    assert.equal((await session.login("chef", "noch-ein-passwort-789")).ok, false);
    if (!first.ok) return;
    const second = await redeem(first.newCode, "drittes-passwort-000");
    assert.equal(second.ok, true);
  });

  it("zwei gleichzeitige Einlösungen desselben Codes: genau eine gewinnt", async () => {
    const code = await issue();
    const results = await Promise.all([1, 2, 3, 4].map((n) => redeem(code, `parallel-passwort-${n}`)));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await env.db.recoveryCode.count({ where: { userId: admin.id } }), 1);
    assert.equal(await env.db.recoveryNotice.count(), 1);
  });

  it("Klein-/Großschreibung, Leerzeichen und O/I/L-Verwechslungen im Code sind egal", async () => {
    const code = await issue();
    const sloppy = ` ${code.toLowerCase().replaceAll("-", " ")} `.replaceAll("0", "o");
    assert.equal((await redeem(sloppy)).ok, true);
  });

  it("nutzt nicht die scrypt-Semaphore der Passwortprüfung: Fehlversuche rechnen keinen Hash", async () => {
    for (let i = 0; i < 20; i++) await redeem(randomCode());
    assert.equal(passwordMod.hashStats.computed, 0);
    assert.equal(passwordMod.hashSemaphore.waiting, 0);
  });

  it("kommt durch, während eine Flut von Anmeldungen läuft und alle Hash-Plätze der Anmeldung belegt sind (eigener Pfad für das neue Passwort)", async () => {
    const code = await issue();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => (release = resolve));
    const blocked = Array.from({ length: 34 }, () => passwordMod.hashSemaphore.run(() => blocker));
    const flood = Array.from({ length: 100 }, (_, i) => session.login(`flut-${i}`, "falsches-passwort-123"));
    try {
      const result = await redeem(code);
      assert.equal(result.ok, true);
      assert.equal(passwordMod.hashSemaphore.waiting, 32, "die Warteschlange der Anmeldungen war die ganze Zeit voll");
    } finally {
      release();
      await Promise.all([...blocked, ...flood]);
    }
    assert.equal((await session.login("chef", NEW_PASSWORD)).ok, true);
  });

  it("macht die bekannten Geräte des Kontos ungültig", async () => {
    await session.login("chef", PASSWORD);
    assert.equal(await env.db.knownDevice.count({ where: { userId: admin.id } }), 1);
    assert.equal((await redeem(await issue())).ok, true);
    assert.equal(await env.db.knownDevice.count({ where: { userId: admin.id } }), 0);
  });

  it("2FA-Erweiterungsstelle ist in der Transaktion verdrahtet (Aufruf beim Einlösen)", async () => {
    // Solange es keine 2FA gibt, ist die Stelle leer – sie muss existieren und aufrufbar sein
    await assert.doesNotReject(env.db.$transaction((tx) => recovery.resetSecondFactor(tx, admin.id)));
  });
});

describe("Gleiche Antwort und Dauer für alle Fehlerfälle", () => {
  it("kein Code, falscher Code, Prüfsumme, Müll, benutzter Code, deaktiviertes Konto, kein Administrator mehr: identisch", async () => {
    const used = await issue();
    await redeem(used); // verbraucht
    const inactive = await env.user({ username: "inaktiv", roles: [adminRole], active: false });
    const inactiveCode = await issue(inactive);
    const demoted = await env.user({ username: "degradiert", roles: [userRole] });
    const demotedCode = await issue(demoted);
    const valid = await issue(await env.user({ username: "zweiter", roles: [adminRole] }));
    const badChecksum = valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0");

    const cases: Record<string, string> = {
      leer: "",
      müll: "hallo welt",
      zufälliger_code: randomCode(),
      prüfsumme: badChecksum,
      benutzt: used,
      deaktiviert: inactiveCode,
      kein_admin: demotedCode,
    };
    const seen = new Set<string>();
    const sleepsPerCase: number[][] = [];
    for (const [name, code] of Object.entries(cases)) {
      sleeps = [];
      const state = await recoverActions.recoverAccess({}, recoverForm(code));
      assert.equal(state.ok, undefined, name);
      assert.equal(state.recoveryCode, undefined, name);
      seen.add(JSON.stringify(state));
      sleepsPerCase.push([...sleeps]);
    }
    assert.equal(seen.size, 1, `alle Fehlerfälle müssen dieselbe Antwort liefern: ${[...seen].join(" | ")}`);
    // identische Wartezeiten (feste Dauer per Timer, die Uhr steht still → gleiche Auffüllung)
    for (const s of sleepsPerCase) assert.deepEqual(s, sleepsPerCase[0]);
    assert.ok(sleepsPerCase[0].length > 0 && sleepsPerCase[0][0] >= 1_200, "Fehlschläge werden auf die feste Mindestdauer aufgefüllt");
    // die Konten bleiben unberührt (kein Passwort geändert, keine Sperre)
    assert.equal((await session.login("inaktiv", "x")).ok, false);
  });

  it("Erfolg wird auf dieselbe feste Dauer aufgefüllt wie ein Fehlschlag (die Antwortzeit verrät den Erfolg nicht)", async () => {
    const code = await issue();
    sleeps = [];
    await redeem(randomCode());
    const failure = [...sleeps];
    sleeps = [];
    const result = await redeem(code);
    assert.equal(result.ok, true);
    assert.deepEqual(sleeps, failure);
  });
});

describe("Drosselung: nur global, nie pro Konto", () => {
  it("Dauerbeschuss verlangsamt, weist aber nie ab; das Konto wird nicht gesperrt und der richtige Code funktioniert danach", async () => {
    const code = await issue();
    sleeps = [];
    // 200 parallele Fehlversuche
    const results = await Promise.all(Array.from({ length: 200 }, () => redeem(randomCode())));
    assert.ok(results.every((r) => !r.ok && r.reason === "invalid"), "nie 'throttled' ohne Proxy-Einstellung");
    assert.ok(sleeps.some((ms) => ms > 1_500), "das globale Budget verlangsamt (zusätzliche Wartezeit)");
    assert.ok(Math.max(...sleeps) <= 5_000 + 1_500, "Verlangsamung hat eine Obergrenze");

    // Konto ist nicht gesperrt: Anmeldung mit dem Passwort geht weiter, der richtige Code löst ein
    const fresh = await env.db.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(fresh.failedLogins, 0);
    assert.equal(fresh.lockedUntil, null);
    assert.equal((await session.login("chef", PASSWORD)).ok, true);
    env.signOut();
    assert.equal((await redeem(code)).ok, true);
  });

  it("ein Fehlversuch zählt nicht gegen ein Konto: ungültige Codes verändern das Anmelde-Limit nicht", async () => {
    for (let i = 0; i < 30; i++) await redeem(randomCode());
    assert.equal(throttle.loginThrottle.accounts.size, 0);
  });

  it("pro Client-Adresse nur mit der Proxy-Einstellung: ohne sie wird die Adresse gar nicht beachtet", async () => {
    const network = await import("./network");
    browser.setHeaders({ "x-forwarded-for": "9.9.9.9" });
    assert.equal(await network.currentClientIp(), null);
    for (let i = 0; i < 40; i++) {
      const state = await recoverActions.recoverAccess({}, recoverForm(randomCode()));
      assert.equal(state.error, (await import("@/i18n/messages/de")).de.recovery.recover.errors.invalid);
    }
  });

  it("mit Proxy-Einstellung: ab dem 11. Versuch von derselben Adresse Wartezeit (andere Adressen und die Anmeldung bleiben frei)", async () => {
    await env.db.appSetting.create({ data: { key: "auth.behindProxy", value: "true" } });
    const code = await issue();
    browser.setHeaders({ "x-forwarded-for": "1.1.1.1" });
    for (let i = 0; i < 10; i++) await recoverActions.recoverAccess({}, recoverForm(randomCode()));
    const blocked = await recoverActions.recoverAccess({}, recoverForm(randomCode()));
    assert.match(blocked.error ?? "", /Sekunden/);
    // eine andere Adresse kommt durch
    browser.setHeaders({ "x-forwarded-for": "2.2.2.2" });
    const ok = await recoverActions.recoverAccess({}, recoverForm(code));
    assert.equal(ok.ok, true);
  });
});

describe("Aktionen", () => {
  it("Passwortregeln werden vor dem Einlösen geprüft und verbrauchen den Code nicht", async () => {
    const code = await issue();
    assert.ok((await recoverActions.recoverAccess({}, recoverForm(code, "kurz"))).fieldErrors?.password);
    assert.ok((await recoverActions.recoverAccess({}, recoverForm(code, NEW_PASSWORD, "anders-123456"))).fieldErrors?.confirm);
    assert.equal((await recoverActions.recoverAccess({}, recoverForm(code))).ok, true);
  });

  it("Erfolg zeigt den neuen Code in der Antwort; Audit ohne Code-Material, Fehlversuche gedrosselt protokolliert", async () => {
    const code = await issue();
    const state = await recoverActions.recoverAccess({}, recoverForm(code));
    assert.ok(state.recoveryCode && state.recoveryCode !== code);
    for (let i = 0; i < 20; i++) await recoverActions.recoverAccess({}, recoverForm(randomCode()));
    const entries = await env.db.auditLog.findMany();
    const joined = JSON.stringify(entries);
    assert.equal(joined.includes(code), false);
    assert.equal(joined.includes(code.replaceAll("-", "")), false);
    assert.equal(joined.includes(state.recoveryCode!), false);
    assert.equal(entries.filter((e) => e.action === "auth.recoveryUsed").length, 1);
    const failed = entries.filter((e) => e.action === "auth.recoveryFailed").length;
    assert.ok(failed >= 1 && failed <= 2, `Fehlversuche nur gedrosselt protokollieren, waren ${failed}`);
  });

  it("ein Fehler im Audit-Log verhindert nicht, dass der neue Code angezeigt wird (der alte ist da schon verbraucht)", async () => {
    const code = await issue();
    const original = env.db.auditLog.create.bind(env.db.auditLog);
    (env.db.auditLog as { create: unknown }).create = () => Promise.reject(new Error("Audit kaputt"));
    const logged = console.error;
    console.error = () => undefined;
    try {
      const state = await recoverActions.recoverAccess({}, recoverForm(code));
      assert.ok(state.ok && state.recoveryCode, "der neue Code wird trotzdem angezeigt");
      // dasselbe beim Erzeugen im Konto
      await env.signIn(admin);
      const created = await accountActions.createRecoveryCode({}, form({ password: NEW_PASSWORD }));
      assert.ok(created.ok && created.recoveryCode);
    } finally {
      console.error = logged;
      (env.db.auditLog as { create: unknown }).create = original;
    }
  });
});

describe("Hinweis „Notzugang wurde verwendet“", () => {
  it("sehen das Konto und alle Administratoren, andere nicht; bestätigen gilt je Person", async () => {
    const admin2 = await env.user({ username: "admin2", name: "Zweite", roles: [adminRole] });
    const worker = await env.user({ username: "werker", roles: [userRole] });
    await redeem(await issue());

    const data = (u: User, isAdmin: boolean) => recovery.recoveryBannerData({ id: u.id, isAdmin });
    assert.equal((await data(admin, true)).notices.length, 1);
    assert.equal((await data(admin, true)).notices[0].own, true);
    assert.equal((await data(admin2, true)).notices.length, 1);
    assert.equal((await data(admin2, true)).notices[0].own, false);
    assert.equal((await data(worker, false)).notices.length, 0);

    const notice = await env.db.recoveryNotice.findFirstOrThrow();
    await recovery.acknowledgeRecoveryNotice(notice.id, { id: admin2.id, isAdmin: true });
    assert.equal((await data(admin2, true)).notices.length, 0);
    assert.equal((await data(admin, true)).notices.length, 1, "die Bestätigung gilt nur für die bestätigende Person");
    // ein Nicht-Admin kann fremde Hinweise nicht bestätigen
    await recovery.acknowledgeRecoveryNotice(notice.id, { id: worker.id, isAdmin: false });
    assert.equal(await env.db.recoveryNoticeAck.count({ where: { userId: worker.id } }), 0);
  });

  it("verschwindet nicht mit dem Löschen des Kontos: Administratoren sehen ihn weiter, mit dem Namen des gelöschten Kontos", async () => {
    const admin2 = await env.user({ username: "admin2", name: "Zweite", roles: [adminRole] });
    await redeem(await issue());
    await env.signIn(admin2);
    await redirectOf(() => userActions.deleteUser(form({ id: admin.id })));
    assert.equal(await env.db.user.count({ where: { id: admin.id } }), 0, "Konto ist gelöscht");
    const notice = await env.db.recoveryNotice.findFirstOrThrow();
    assert.equal(notice.userId, null);
    assert.equal(notice.userName, "Chef");
    const data = await recovery.recoveryBannerData({ id: admin2.id, isAdmin: true });
    assert.equal(data.notices.length, 1);
    assert.equal(data.notices[0].userName, "Chef");
    assert.equal(data.notices[0].own, false);
    // bestätigen geht weiterhin, danach ist er weg
    await recovery.acknowledgeRecoveryNotice(notice.id, { id: admin2.id, isAdmin: true });
    assert.equal((await recovery.recoveryBannerData({ id: admin2.id, isAdmin: true })).notices.length, 0);
  });

  it("confirmRecoveryCode meldet ok, wenn der Code bestätigt ist (auch beim zweiten Mal), und nicht ok ohne Code", async () => {
    await env.signIn(admin);
    assert.deepEqual(await accountActions.confirmRecoveryCode(), { ok: false }, "ohne Code gibt es nichts zu bestätigen");
    await issue();
    assert.deepEqual(await accountActions.confirmRecoveryCode(), { ok: true });
    assert.deepEqual(await accountActions.confirmRecoveryCode(), { ok: true }, "schon bestätigt bleibt ok");
  });

  it("zeigt Administratoren, dass der eigene Code noch nicht bestätigt ist", async () => {
    await issue();
    assert.equal((await recovery.recoveryBannerData({ id: admin.id, isAdmin: true })).unconfirmed, true);
    await env.signIn(admin);
    await accountActions.confirmRecoveryCode();
    assert.equal((await recovery.recoveryBannerData({ id: admin.id, isAdmin: true })).unconfirmed, false);
  });
});

describe("Erzeugen im Konto", () => {
  it("nur Administratoren, nur mit richtigem Passwort; der bisherige Code wird ungültig", async () => {
    const old = await issue();
    await env.signIn(admin);
    const wrong = await accountActions.createRecoveryCode({}, form({ password: "falsch-falsch-1" }));
    assert.ok(wrong.fieldErrors?.password);
    assert.equal(wrong.recoveryCode, undefined);
    assert.equal(await env.db.recoveryCode.count(), 1);

    const created = await accountActions.createRecoveryCode({}, form({ password: PASSWORD }));
    assert.ok(created.recoveryCode && created.recoveryCode !== old);
    assert.deepEqual(await redeem(old, "irgendwas-12345"), { ok: false, reason: "invalid" });
    assert.equal((await redeem(created.recoveryCode!, "irgendwas-12345")).ok, true);
    const audit = await env.db.auditLog.findMany({ where: { action: "auth.recoveryCreated" } });
    assert.equal(audit.length, 1);
    assert.equal(JSON.stringify(audit).includes(created.recoveryCode!), false);
  });

  it("ein Konto ohne Administrator-Rolle bekommt keinen Code", async () => {
    const worker = await env.user({ username: "werker", password: PASSWORD, roles: [userRole] });
    await env.signIn(worker);
    const state = await accountActions.createRecoveryCode({}, form({ password: PASSWORD }));
    assert.ok(state.error);
    assert.equal(await env.db.recoveryCode.count({ where: { userId: worker.id } }), 0);
  });
});

describe("Einrichtung", () => {
  it("erzeugt den Code des ersten Administrators, zeigt ihn nur in der Antwort und meldet an", async () => {
    await env.db.user.deleteMany();
    const token = setupToken.ensureSetupToken(true, { log: () => {} })!;
    const state = await setupActions.completeSetup(
      {},
      form({ token, workshopName: "Werkstatt", name: "Neu", username: "neu", password: "ein-gutes-passwort", confirm: "ein-gutes-passwort", timezone: "Europe/Berlin" }),
    );
    assert.equal(state.ok, true);
    assert.match(state.recoveryCode ?? "", /^([0-9A-Z]{5}-){7}[0-9A-Z]{5}$/);
    const user = await env.db.user.findUniqueOrThrow({ where: { username: "neu" } });
    assert.equal(await env.db.recoveryCode.count({ where: { userId: user.id } }), 1);
    assert.equal((await session.getSession())?.user.username, "neu", "die Einrichtung meldet den Administrator an");
    // der Code lässt sich einlösen
    const result = await redeem(state.recoveryCode!, "anderes-passwort-12");
    assert.equal(result.ok, true);
  });
});
