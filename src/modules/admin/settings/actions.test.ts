import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, type TestEnv } from "@/test/harness";

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
