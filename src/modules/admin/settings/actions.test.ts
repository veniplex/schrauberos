import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { browser, createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Werkstatt-Einstellungen: Die Zeitzone des Prozesses ändert sich nur, wenn tatsächlich gespeichert wurde. */
let env: TestEnv;
let actions: typeof import("./actions");

before(async () => {
  env = await createTestEnv();
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  actions = await import("./actions");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.user.deleteMany();
  await env.db.appSetting.deleteMany();
  browser.reset();
  const admin = await env.user({ username: "chef", roles: [await env.role({ key: `admin-${Math.random()}`, isAdmin: true })] });
  await env.signIn(admin);
  process.env.TZ = "Europe/Berlin";
});

const workshopForm = (extra: Record<string, string | boolean> = {}) =>
  form({ name: "Werkstatt", accentColor: "#2459c9", timezone: "America/New_York", ...Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [`hours.${d}.closed`, true])), ...extra });

describe("saveWorkshop", () => {
  it("wendet die Zeitzone nach erfolgreichem Speichern an", async () => {
    const state = await actions.saveWorkshop({}, workshopForm());
    assert.equal(state.ok, true);
    assert.equal(process.env.TZ, "America/New_York");
  });

  it("lässt die Zeitzone bei einem Fehler an anderer Stelle (Öffnungszeiten) unverändert", async () => {
    const state = await actions.saveWorkshop({}, workshopForm({ "hours.mon.closed": false, "hours.mon.from": "18:00", "hours.mon.to": "08:00" }));
    assert.ok(state.fieldErrors?.["hours.mon"]);
    assert.equal(process.env.TZ, "Europe/Berlin");
  });

  it("lehnt eine ungültige Zeitzone ab, ohne etwas zu ändern", async () => {
    const state = await actions.saveWorkshop({}, workshopForm({ timezone: "Mars/Olympus" }));
    assert.ok(state.fieldErrors?.timezone);
    assert.equal(process.env.TZ, "Europe/Berlin");
  });
});

describe("saveWorkshop: Logo (SEC-12: der Inhalt entscheidet)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const logoOf = async () => (await env.db.workshop.findUnique({ where: { id: "default" } }))?.logoDataUrl ?? null;
  const withLogo = (file: File) => form({ name: "Werkstatt", accentColor: "#2459c9", timezone: "Europe/Berlin", ...Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [`hours.${d}.closed`, true])), logo: file });

  it("lehnt HTML ab, das sich als PNG, JPEG oder SVG ausgibt – das Logo bleibt unverändert", async () => {
    await actions.saveWorkshop({}, workshopForm());
    const before = await logoOf();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    for (const type of ["image/png", "image/jpeg", "image/svg+xml", ""]) {
      const state = await actions.saveWorkshop({}, withLogo(new File([html], "logo.png", { type })));
      assert.ok(state.fieldErrors?.logo, type);
    }
    assert.ok((await actions.saveWorkshop({}, withLogo(new File([PNG], "logo.png", { type: "image/jpeg" })))).fieldErrors?.logo, "echtes PNG unter falschem Typ");
    assert.equal(await logoOf(), before);
  });

  it("speichert ein echtes PNG und ein echtes SVG mit dem erkannten Typ in der Daten-URL", async () => {
    assert.equal((await actions.saveWorkshop({}, withLogo(new File([PNG], "logo.png", { type: "image/png" })))).ok, true);
    assert.ok((await logoOf())?.startsWith("data:image/png;base64,"));
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], "logo.svg", { type: "image/svg+xml" });
    assert.equal((await actions.saveWorkshop({}, withLogo(svg))).ok, true);
    assert.ok((await logoOf())?.startsWith("data:image/svg+xml;base64,"));
  });
});

describe("saveWorkshop: Zeitzonenwechsel stellt die Termine der Cron-Jobs um", () => {
  it("ein Job um 03:00 Ortszeit läuft nach dem Wechsel nach 03:00 Ortszeit der neuen Zone", async () => {
    const { jobRunner } = await import("@/server/jobs");
    process.env.TZ = "Europe/Berlin";
    await env.db.jobState.deleteMany();
    await jobRunner().sync();
    const nextOf = async () => (await env.db.jobState.findUniqueOrThrow({ where: { id: "audit.retention" } })).nextRunAt!;
    const berlin = await nextOf();
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(berlin), "03:00");

    const state = await actions.saveWorkshop({}, workshopForm({ timezone: "America/New_York" }));
    assert.equal(state.ok, true);
    await new Promise((r) => setTimeout(r, 100)); // das Umstellen läuft im Hintergrund nach dem Speichern
    const ny = await nextOf();
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ny), "03:00");
    assert.notEqual(ny.getTime(), berlin.getTime());
  });
});

describe("saveSecurity (Hinter Reverse-Proxy)", () => {
  it("speichert die Einstellung, wirkt auf die Client-Adresse und wird protokolliert", async () => {
    const network = await import("@/server/auth/network");
    browser.setHeaders({ "x-forwarded-for": "1.1.1.1, 7.7.7.7" });
    assert.equal(await network.currentClientIp(), null, "ohne die Einstellung wird der Header ignoriert");

    assert.equal((await actions.saveSecurity({}, form({ behindProxy: true }))).ok, true);
    assert.equal(await network.isBehindProxy(), true);
    assert.equal(await network.currentClientIp(), "7.7.7.7", "mit Einstellung zählt der letzte Eintrag");

    assert.equal((await actions.saveSecurity({}, form({}))).ok, true);
    assert.equal(await network.isBehindProxy(), false);
    assert.equal(await network.currentClientIp(), null);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.security" } }), 2);
  });

  it("verlangt das Recht settings.manage: ohne es wird nichts gespeichert", async () => {
    const network = await import("@/server/auth/network");
    const plain = await env.user({ username: "ohne-recht", roles: [await env.role({ permissions: ["appointments.view"] })] });
    await env.signIn(plain);
    assert.equal(await redirectOf(() => actions.saveSecurity({}, form({ behindProxy: true }))), "/forbidden");
    assert.equal(await network.isBehindProxy(), false);
    // auch mit anderem Verwaltungsrecht (Benutzer) nicht
    const users = await env.user({ username: "nur-benutzer", roles: [await env.role({ permissions: ["users.manage"] })] });
    await env.signIn(users);
    assert.equal(await redirectOf(() => actions.saveSecurity({}, form({ behindProxy: true }))), "/forbidden");
    assert.equal(await network.isBehindProxy(), false);
  });
});
