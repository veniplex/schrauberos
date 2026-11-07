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

const workshopForm = (extra: Record<string, string | number | boolean> = {}) =>
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

describe("saveWorkshop: Rechnungsangaben (P4b-7)", () => {
  const workshopRow = () => env.db.workshop.findUniqueOrThrow({ where: { id: "default" } });
  const profile = {
    taxNumber: "21/815/08150",
    vatId: "de 123 456 789",
    bankName: "Demo-Bank",
    iban: "de89 3704 0044 0532 0130 00",
    bic: "cobadeffxxx",
    paymentTermDays: 30,
    managingDirector: "Erika Muster",
    registerCourt: "Amtsgericht Beispielstadt",
    registerNumber: "HRB 4711",
    hourlyRate: "95,50",
    workUnitMinutes: 6,
    invoiceNumberFormat: "RE-{YY}{MM}-{NNN}",
  };

  it("speichert und normalisiert die Angaben (IBAN ohne Leerzeichen, USt-IdNr. und BIC groß, Satz in Cent)", async () => {
    const state = await actions.saveWorkshop({}, workshopForm({ ...profile, smallBusiness: true }));
    assert.equal(state.ok, true, JSON.stringify(state.fieldErrors));
    const row = await workshopRow();
    assert.deepEqual(
      [row.taxNumber, row.vatId, row.smallBusiness, row.iban, row.bic, row.paymentTermDays, row.hourlyRateCents, row.workUnitMinutes, row.invoiceNumberFormat],
      ["21/815/08150", "DE123456789", true, "DE89370400440532013000", "COBADEFFXXX", 30, 9550, 6, "RE-{YY}{MM}-{NNN}"],
    );
  });

  it("ohne Angaben gelten die Standardwerte (Zahlungsziel 14 Tage, 1 AW = 5 Minuten, Muster {YYYY}-{NNNN}) und alles andere ist leer", async () => {
    assert.equal((await actions.saveWorkshop({}, workshopForm())).ok, true);
    const row = await workshopRow();
    assert.deepEqual([row.taxNumber, row.vatId, row.iban, row.hourlyRateCents, row.smallBusiness, row.paymentTermDays, row.workUnitMinutes, row.invoiceNumberFormat], [null, null, null, null, false, 14, 5, "{YYYY}-{NNNN}"]);
  });

  it("lehnt ungültige IBAN, BIC, USt-IdNr., Steuernummer, Stundensatz und Muster ab – nichts wird gespeichert", async () => {
    await actions.saveWorkshop({}, workshopForm());
    const bad: Array<[string, Record<string, string | number>]> = [
      ["iban", { iban: "DE89 3704 0044 0532 0130 01" }],
      ["bic", { bic: "XY" }],
      ["vatId", { vatId: "DE12345" }],
      ["taxNumber", { taxNumber: "abc" }],
      ["hourlyRate", { hourlyRate: "viel" }],
      ["hourlyRate", { hourlyRate: "-5" }],
      ["paymentTermDays", { paymentTermDays: 9999 }],
      ["workUnitMinutes", { workUnitMinutes: 0 }],
      ["invoiceNumberFormat", { invoiceNumberFormat: "{YYYY}" }],
      ["invoiceNumberFormat", { invoiceNumberFormat: "{MM}-{NNNN}" }],
    ];
    for (const [field, values] of bad) {
      const state = await actions.saveWorkshop({}, workshopForm({ ...profile, ...values }));
      assert.ok(state.fieldErrors?.[field], `${field} ${JSON.stringify(values)}`);
    }
    assert.equal((await workshopRow()).iban, null);
  });

  it("das Audit-Log nennt die geänderten Felder der Rechnungsangaben, nie ihre Werte", async () => {
    await env.db.auditLog.deleteMany();
    await actions.saveWorkshop({}, workshopForm(profile));
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "settings.workshop" } });
    assert.match(entry.target ?? "", /iban/);
    assert.match(entry.target ?? "", /vatId/);
    assert.ok(!(entry.target ?? "").includes("3704"), "keine IBAN im Audit-Log");
    assert.ok(!(entry.target ?? "").includes("123456789"), "keine USt-IdNr. im Audit-Log");
    await env.db.auditLog.deleteMany();
    await actions.saveWorkshop({}, workshopForm(profile));
    assert.equal((await env.db.auditLog.findFirstOrThrow({ where: { action: "settings.workshop" } })).target, "Werkstatt", "unverändert: kein Zusatz");
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

  it("speichert ein echtes PNG mit dem erkannten Typ in der Daten-URL; ein echtes SVG wird abgelehnt (P3-5: kein Dokument mit Skriptmöglichkeit unter der Herkunft der App)", async () => {
    assert.equal((await actions.saveWorkshop({}, withLogo(new File([PNG], "logo.png", { type: "image/png" })))).ok, true);
    assert.ok((await logoOf())?.startsWith("data:image/png;base64,"));
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], "logo.svg", { type: "image/svg+xml" });
    assert.ok((await actions.saveWorkshop({}, withLogo(svg))).fieldErrors?.logo);
    assert.ok((await logoOf())?.startsWith("data:image/png;base64,"), "das PNG bleibt");
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

describe("saveCspMode (Notschalter der Content-Security-Policy)", () => {
  it("speichert den Zustand, setzt ihn sofort im Prozess (der Proxy liest ihn von dort) und protokolliert die Änderung", async () => {
    const mode = await import("@/lib/csp-mode");
    const setting = await import("@/server/csp-setting");
    mode.setCspModeInProcess("enforce");
    assert.equal((await actions.saveCspMode({}, form({ reportOnly: true }))).ok, true);
    assert.equal(mode.cspMode(), "report-only");
    assert.equal((await env.db.appSetting.findUniqueOrThrow({ where: { key: mode.CSP_MODE_KEY } })).value, "report-only");

    // Neustart: der gespeicherte Wert wird beim Start wieder in den Prozess geladen
    mode.setCspModeInProcess("enforce");
    await setting.loadCspMode();
    assert.equal(mode.cspMode(), "report-only");

    assert.equal((await actions.saveCspMode({}, form({}))).ok, true);
    assert.equal(mode.cspMode(), "enforce");
    const audits = await env.db.auditLog.findMany({ where: { action: "settings.csp" }, orderBy: { createdAt: "asc" } });
    assert.equal(audits.length, 2);
    assert.match(audits[0].target ?? "", /enforce → report-only/);
    assert.match(audits[1].target ?? "", /report-only → enforce/);
  });

  it("ohne gespeicherten oder mit unbekanntem Wert gilt „erzwungen“", async () => {
    const mode = await import("@/lib/csp-mode");
    assert.equal(mode.parseCspMode(null), "enforce");
    assert.equal(mode.parseCspMode("irgendwas"), "enforce");
    assert.equal(mode.parseCspMode("report-only"), "report-only");
  });

  it("verlangt das Recht settings.manage: ohne es bleibt die Richtlinie erzwungen", async () => {
    const mode = await import("@/lib/csp-mode");
    mode.setCspModeInProcess("enforce");
    const plain = await env.user({ username: "ohne-recht-csp", roles: [await env.role({ permissions: ["appointments.view"] })] });
    await env.signIn(plain);
    assert.equal(await redirectOf(() => actions.saveCspMode({}, form({ reportOnly: true }))), "/forbidden");
    assert.equal(mode.cspMode(), "enforce");
    assert.equal(await env.db.appSetting.count({ where: { key: mode.CSP_MODE_KEY } }), 0);
  });
});

describe("savePublicUrl: Adresse der Anwendung (F8)", () => {
  const stored = async () => (await env.db.appSetting.findUnique({ where: { key: "app.publicUrl" } }))?.value ?? null;

  it("speichert die Herkunft normalisiert und schreibt alten und neuen Wert ins Audit-Log", async () => {
    const state = await actions.savePublicUrl({}, form({ publicUrl: "https://Werkstatt.example/" }));
    assert.equal(state.ok, true);
    assert.equal(await stored(), "https://werkstatt.example");
    await actions.savePublicUrl({}, form({ publicUrl: "http://192.168.1.10:3000" }));
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "settings.publicUrl" }, orderBy: { createdAt: "desc" } });
    assert.match(entry.target ?? "", /https:\/\/werkstatt\.example → http:\/\/192\.168\.1\.10:3000/);
  });

  it("leer löscht die Einstellung; Pfad, Anmeldedaten und fremde Schemata werden mit Feldfehler abgelehnt", async () => {
    await actions.savePublicUrl({}, form({ publicUrl: "https://werkstatt.example" }));
    assert.equal((await actions.savePublicUrl({}, form({ publicUrl: "" }))).ok, true);
    assert.equal(await stored(), null);
    for (const bad of ["https://werkstatt.example/app", "https://u:p@werkstatt.example", "javascript:alert(1)", "werkstatt"]) {
      const state = await actions.savePublicUrl({}, form({ publicUrl: bad }));
      assert.ok(state.fieldErrors?.publicUrl, bad);
    }
    assert.equal(await stored(), null, "nichts wurde gespeichert");
  });

  it("verlangt `settings.manage`", async () => {
    browser.reset();
    await env.signIn(await env.user({ username: "azubi", roles: [await env.role({ key: `r-${Math.random()}`, permissions: ["tires.view"] })] }));
    assert.equal(await redirectOf(() => actions.savePublicUrl({}, form({ publicUrl: "https://werkstatt.example" }))), "/forbidden");
    assert.equal(await stored(), null);
  });
});
