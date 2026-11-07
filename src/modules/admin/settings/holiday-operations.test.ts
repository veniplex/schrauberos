import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { browser, createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Feiertage pflegen (P4b-0): Region, Änderungen an den gesetzlichen Tagen, eigene Tage – mit Recht, Audit und Lesen über `getHolidays`. */
let env: TestEnv;
let actions: typeof import("./actions");
let reader: typeof import("@/server/holidays");

before(async () => {
  env = await createTestEnv();
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  actions = await import("./actions");
  reader = await import("@/server/holidays");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.user.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.holidayDay.deleteMany();
  await env.db.holidaySettings.deleteMany();
  browser.reset();
  const admin = await env.user({ username: "chef", roles: [await env.role({ key: `admin-${Math.random()}`, isAdmin: true })] });
  await env.signIn(admin);
});

const auditCount = () => env.db.auditLog.count({ where: { action: "settings.holidays" } });

describe("Region", () => {
  it("speichert die Region, schreibt ins Audit-Log und liefert die Feiertage über getHolidays", async () => {
    assert.equal((await reader.readHolidayConfig()).region, "");
    const state = await actions.saveHolidayRegion({}, form({ region: "DE-NW" }));
    assert.equal(state.ok, true);
    assert.equal((await reader.readHolidayConfig()).region, "DE-NW");
    assert.equal(await auditCount(), 1);
    const calendar = await reader.readHolidayConfig().then((c) => import("@/lib/holidays").then((m) => m.createHolidayCalendar(c)));
    assert.equal(calendar.on("2026-06-04")?.key, "corpusChristi");
  });

  it("lehnt eine unbekannte Region ab; leer schaltet die Feiertage aus", async () => {
    assert.ok((await actions.saveHolidayRegion({}, form({ region: "DE-XX" }))).fieldErrors?.region);
    assert.equal((await actions.saveHolidayRegion({}, form({ region: "DE-BY" }))).ok, true);
    assert.equal((await actions.saveHolidayRegion({}, form({ region: "" }))).ok, true);
    assert.equal((await reader.readHolidayConfig()).region, "");
  });

  it("ein Wechsel der Region verwirft die Änderungen an den gesetzlichen Tagen, eigene Tage bleiben", async () => {
    await actions.saveHolidayRegion({}, form({ region: "DE-BY" }));
    await actions.saveHolidayRules({}, form({ "rule.DE.assumption": "off", "rule.DE.epiphany": "half" }));
    await actions.saveHolidayCustom({}, form({ name: "Betriebsferien", date: "2026-08-03" }));
    assert.deepEqual((await reader.readHolidayConfig()).rules, { "DE.assumption": "off", "DE.epiphany": "half" });
    await actions.saveHolidayRegion({}, form({ region: "DE-BY" }));
    assert.equal(Object.keys((await reader.readHolidayConfig()).rules).length, 2, "dieselbe Region: unverändert");
    await actions.saveHolidayRegion({}, form({ region: "DE-SL" }));
    const config = await reader.readHolidayConfig();
    assert.deepEqual(config.rules, {});
    assert.equal(config.custom.length, 1);
  });
});

describe("Gesetzliche Tage ändern", () => {
  it("speichert streichen, halber Tag und das Einschalten eines Vorschlags; leere Auswahl heißt Vorgabe", async () => {
    await actions.saveHolidayRegion({}, form({ region: "AT-9" }));
    const state = await actions.saveHolidayRules({}, form({ "rule.AT.assumption": "half", "rule.AT.epiphany": "", "rule.AT.stLeopold": "on" }));
    assert.equal(state.ok, true);
    assert.deepEqual((await reader.readHolidayConfig()).rules, { "AT.assumption": "half", "AT.stLeopold": "on" });
    // erneutes Speichern ersetzt den Stand
    await actions.saveHolidayRules({}, form({ "rule.AT.stLeopold": "" }));
    assert.deepEqual((await reader.readHolidayConfig()).rules, {});
  });

  it("lehnt Tage ab, die es in der Region nicht gibt, und unpassende Arten (Vorschlag streichen, gesetzlichen Tag einschalten)", async () => {
    await actions.saveHolidayRegion({}, form({ region: "DE-NW" }));
    assert.ok((await actions.saveHolidayRules({}, form({ "rule.DE.epiphany": "off" }))).fieldErrors?.["rule.DE.epiphany"], "Dreikönig gibt es in NRW nicht");
    assert.ok((await actions.saveHolidayRules({}, form({ "rule.DE.corpusChristi": "on" }))).fieldErrors?.["rule.DE.corpusChristi"], "gesetzlicher Tag einschalten ist sinnlos");
    await actions.saveHolidayRegion({}, form({ region: "AT-9" }));
    assert.ok((await actions.saveHolidayRules({}, form({ "rule.AT.stLeopold": "off" }))).fieldErrors?.["rule.AT.stLeopold"]);
    assert.deepEqual((await reader.readHolidayConfig()).rules, {});
  });
});

describe("Eigene Tage", () => {
  const customs = () => env.db.holidayDay.findMany({ where: { kind: "custom" }, orderBy: { createdAt: "asc" } });

  it("legt einmalige und jährliche Tage an, ändert mit Version und löscht", async () => {
    assert.equal((await actions.saveHolidayCustom({}, form({ name: "Betriebsferien", date: "2026-08-03" }))).ok, true);
    assert.equal((await actions.saveHolidayCustom({}, form({ name: "Heiligabend", date: "2026-12-24", yearly: "on", half: "on" }))).ok, true);
    const [once, yearly] = await customs();
    assert.deepEqual([once.year, once.month, once.day, once.half], [2026, 8, 3, false]);
    assert.deepEqual([yearly.year, yearly.month, yearly.day, yearly.half], [null, 12, 24, true]);

    const version = String(once.updatedAt.getTime());
    assert.equal((await actions.saveHolidayCustom({}, form({ id: once.id, version, name: "Werksferien", date: "2026-08-04" }))).ok, true);
    // veraltete Version → Konflikt, nichts überschrieben
    const stale = await actions.saveHolidayCustom({}, form({ id: once.id, version, name: "Anders", date: "2026-08-05" }));
    assert.ok(!stale.ok && stale.error, "Konflikt wird gemeldet");
    assert.equal((await customs())[0].name, "Werksferien");

    assert.equal((await actions.deleteHolidayCustom({}, form({ id: yearly.id }))).ok, true);
    assert.equal((await customs()).length, 1);
    assert.equal(await auditCount(), 4);
  });

  it("lehnt einen ungültigen Tag und den 29. Februar als jährlichen Tag ab", async () => {
    assert.ok((await actions.saveHolidayCustom({}, form({ name: "X", date: "2026-02-30" }))).fieldErrors?.date);
    assert.ok((await actions.saveHolidayCustom({}, form({ name: "Schalttag", date: "2028-02-29", yearly: "on" }))).fieldErrors?.date);
    assert.equal((await actions.saveHolidayCustom({}, form({ name: "Schalttag", date: "2028-02-29" }))).ok, true);
    assert.ok((await actions.saveHolidayCustom({}, form({ name: "", date: "2026-02-03" }))).fieldErrors?.name);
  });
});

describe("Recht", () => {
  it("ohne settings.manage geht nichts (Region, Tage, Löschen)", async () => {
    const viewer = await env.user({ username: "azubi", roles: [await env.role({ key: `r-${Math.random()}`, permissions: ["customers.view"] })] });
    await env.signIn(viewer);
    for (const run of [
      () => actions.saveHolidayRegion({}, form({ region: "DE-NW" })),
      () => actions.saveHolidayRules({}, form({})),
      () => actions.saveHolidayCustom({}, form({ name: "X", date: "2026-08-03" })),
      () => actions.deleteHolidayCustom({}, form({ id: "x" })),
    ]) {
      assert.equal(await redirectOf(run), "/forbidden");
    }
    assert.equal((await reader.readHolidayConfig()).region, "");
    assert.equal(await auditCount(), 0);
  });
});
