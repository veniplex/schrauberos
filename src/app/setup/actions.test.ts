import assert from "node:assert/strict";
import { setWorkshopZone } from "@/lib/zone";
import { existsSync, readFileSync, statSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { browser, createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Ersteinrichtung: Token, Reihenfolge der Prüfungen, Zeitzone, paralleler Aufruf. */
let env: TestEnv;
let actions: typeof import("./actions");
let tokenMod: typeof import("@/server/setup-token");
let startup: typeof import("@/server/startup");
let runtime: typeof import("@/server/auth/runtime");
let clock = Date.now();

before(async () => {
  env = await createTestEnv();
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  actions = await import("./actions");
  tokenMod = await import("@/server/setup-token");
  startup = await import("@/server/startup");
  runtime = await import("@/server/auth/runtime");
  runtime.authRuntime.now = () => clock;
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.session.deleteMany();
  await env.db.recoveryCode.deleteMany();
  await env.db.user.deleteMany();
  browser.reset();
  clock = Date.now();
  tokenMod.resetSetupGate();
  tokenMod.removeSetupToken();
  process.env.TZ = "Europe/Berlin";
});

const setupForm = (token: string, extra: Record<string, string> = {}) =>
  form({ token, workshopName: "Werkstatt", name: "Chef", username: "chef", password: "ein-gutes-passwort", confirm: "ein-gutes-passwort", timezone: "America/New_York", ...extra });

describe("Einrichtungs-Token", () => {
  it("entsteht beim Start mit mindestens 128 Bit, Modus 0600, wird geloggt und beim erneuten Start beibehalten", () => {
    const lines: string[] = [];
    const token = tokenMod.ensureSetupToken(true, { log: (l) => lines.push(l) })!;
    assert.equal(tokenMod.normalizeSetupToken(token).length >= 32, true);
    assert.ok(lines[0].includes(token));
    const file = tokenMod.setupTokenFile();
    assert.equal(readFileSync(file, "utf8").trim(), token);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(tokenMod.ensureSetupToken(true, { log: () => {} }), token);
    assert.equal(lines.length, 1, "nur beim Erzeugen loggen, solange nicht ausdrücklich verlangt");
    assert.equal(tokenMod.ensureSetupToken(true, { log: (l) => lines.push(l), logExisting: true }), token);
    assert.equal(lines.length, 2);
  });

  it("wird bei vorhandenem Benutzer entfernt", () => {
    tokenMod.ensureSetupToken(true, { log: () => {} });
    assert.equal(tokenMod.ensureSetupToken(false), null);
    assert.equal(existsSync(tokenMod.setupTokenFile()), false);
  });

  it("Groß-/Kleinschreibung und Bindestriche sind egal, ein falsches Token nicht", () => {
    const token = tokenMod.ensureSetupToken(true, { log: () => {} })!;
    assert.equal(tokenMod.tokenMatches(token.toUpperCase().replaceAll("-", " "), token), true);
    assert.equal(tokenMod.tokenMatches(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), token), false);
    assert.equal(tokenMod.tokenMatches("", token), false);
  });
});

describe("completeSetup", () => {
  it("legt mit dem richtigen Token den Administrator an, wendet die Zeitzone an und löscht das Token", async () => {
    const token = tokenMod.ensureSetupToken(true, { log: () => {} })!;
    const state = await actions.completeSetup({}, setupForm(token));
    assert.equal(state.ok, true);
    assert.ok(state.recoveryCode, "der Wiederherstellungs-Code wird in der Antwort gezeigt (eigene Seite, kein Redirect)");
    assert.equal(await env.db.user.count(), 1);
    assert.equal(process.env.TZ, "America/New_York");
    assert.equal(existsSync(tokenMod.setupTokenFile()), false);
    assert.equal((await env.db.workshop.findUniqueOrThrow({ where: { id: "default" } })).timezone, "America/New_York");
  });

  it("stellt die Termine der Cron-Jobs auf die gewählte Zeitzone um (vorher berechnet in der Zeitzone des Prozesses)", async () => {
    const { jobRunner } = await import("@/server/jobs");
    process.env.TZ = "UTC";
    setWorkshopZone("UTC"); // die Jobs rechnen in der Werkstatt-Zone, nicht in `TZ`
    await env.db.jobState.deleteMany();
    await jobRunner().sync();
    const nextOf = async () => (await env.db.jobState.findUniqueOrThrow({ where: { id: "audit.retention" } })).nextRunAt!;
    const hourIn = (zone: string, at: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    assert.equal(hourIn("UTC", await nextOf()), "03:00");

    const token = tokenMod.ensureSetupToken(true, { log: () => {} })!;
    assert.equal((await actions.completeSetup({}, setupForm(token))).ok, true);
    // ohne reschedule() läge der Termin noch auf 03:00 UTC; jetzt auf 03:00 Ortszeit New York
    assert.equal(hourIn("America/New_York", await nextOf()), "03:00");
  });

  it("falsches oder fehlendes Token: Feldfehler, kein Benutzer, Zeitzone unverändert", async () => {
    tokenMod.ensureSetupToken(true, { log: () => {} });
    for (const bad of ["falsch", "0".repeat(40)]) {
      const state = await actions.completeSetup({}, setupForm(bad));
      assert.ok(state.fieldErrors?.token);
    }
    const missing = await actions.completeSetup({}, setupForm("", {}));
    assert.ok(missing.fieldErrors?.token);
    assert.equal(await env.db.user.count(), 0);
    assert.equal(process.env.TZ, "Europe/Berlin");
    assert.equal(existsSync(tokenMod.setupTokenFile()), true, "Token bleibt nach Fehlversuchen");
  });

  it("ohne Token-Datei ist keine Einrichtung möglich", async () => {
    const state = await actions.completeSetup({}, setupForm("irgendwas"));
    assert.ok(state.fieldErrors?.token);
    assert.equal(await env.db.user.count(), 0);
  });

  it("drosselt Versuche: nach den freien Versuchen wird auch das richtige Token abgewiesen, bis die Wartezeit um ist", async () => {
    const token = tokenMod.ensureSetupToken(true, { log: () => {} })!;
    for (let i = 0; i < 5; i++) await actions.completeSetup({}, setupForm("falsch"));
    const throttled = await actions.completeSetup({}, setupForm(token));
    assert.match(throttled.fieldErrors?.token ?? "", /Sekunden/);
    assert.equal(await env.db.user.count(), 0);
    clock += 120_000;
    assert.equal((await actions.completeSetup({}, setupForm(token))).ok, true);
  });

  it("Zeitzone: ungültig → Feldfehler ohne Wirkung; vorhandener Benutzer → Weiterleitung ohne Änderung der Zeitzone", async () => {
    const token = tokenMod.ensureSetupToken(true, { log: () => {} })!;
    const state = await actions.completeSetup({}, setupForm(token, { timezone: "Mars/Olympus" }));
    assert.ok(state.fieldErrors?.timezone);
    assert.equal(await env.db.user.count(), 0);
    assert.equal(process.env.TZ, "Europe/Berlin");

    await env.user({ username: "schon-da" });
    assert.equal(await redirectOf(() => actions.completeSetup({}, setupForm(token))), "/login");
    assert.equal(process.env.TZ, "Europe/Berlin");
    assert.equal(await env.db.user.count(), 1);
  });

  it("paralleles Setup legt genau einen Administrator an", async () => {
    const token = tokenMod.ensureSetupToken(true, { log: () => {} })!;
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map((n) => actions.completeSetup({}, setupForm(token, { username: `chef${n}`, timezone: "Europe/Berlin" }))),
    );
    assert.equal(await env.db.user.count(), 1);
    // alle sind Weiterleitungen (Erfolg oder „schon eingerichtet“) oder Token-Fehler, nie ein Absturz
    assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.ok).length, 1);
    for (const r of results) {
      if (r.status === "fulfilled" && !r.value.ok) assert.ok(r.value.fieldErrors?.token || r.value.error, "Token-Fehler oder „bitte gleich noch einmal“ (Eigentümer-Pfad voll)");
      if (r.status === "rejected") assert.match(String(r.reason?.message ?? r.reason), /NEXT_REDIRECT/);
    }
    assert.equal(await env.db.recoveryCode.count(), 1, "genau ein Code");
  });

  it("isValidTimezone ändert die Zeitzone nie, applyTimezone nur bei gültigem Namen", () => {
    assert.equal(startup.isValidTimezone("Mars/Olympus"), false);
    assert.equal(process.env.TZ, "Europe/Berlin");
    assert.equal(startup.applyTimezone("Mars/Olympus"), false);
    assert.equal(process.env.TZ, "Europe/Berlin");
  });
});
