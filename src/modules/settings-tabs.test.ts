import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Sichtbarkeit der Einstellungs-Reiter: Jede Funktion bringt ihre Reiter mit ihrem eigenen Recht mit. Seit `settings.manage` nur noch
 * Administratoren vergeben (adminOnly), sieht ein Konto mit `appointments.configure` den Reiter „Termine“ auch ohne Zugriff auf die
 * übrigen Reiter – und umgekehrt.
 */
let env: TestEnv;
let registry: typeof import("./registry");
let session: typeof import("@/server/auth/session");

before(async () => {
  env = await createTestEnv();
  registry = await import("./registry");
  session = await import("@/server/auth/session");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.user.deleteMany();
  await env.db.featureSetting.deleteMany();
});

/** Reiter-IDs, die ein Konto mit diesen Rechten (Rolle) sieht. */
async function tabsOf(permissions: string[], isAdmin = false): Promise<string[]> {
  const role = await env.role({ permissions, isAdmin });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2, 8)}`, roles: [role] });
  await env.signIn(user);
  const current = await session.getSession();
  assert.ok(current);
  return registry.settingsTabsFor(current).map((t) => t.id);
}

describe("Einstellungs-Reiter und Rechte", () => {
  it("appointments.configure zeigt den Reiter „Termine“ – und nur ihn", async () => {
    assert.deepEqual(await tabsOf(["appointments.configure"]), ["appointments"]);
  });

  it("settings.manage zeigt die Reiter der Verwaltung, nicht „Termine“", async () => {
    const tabs = await tabsOf(["settings.manage"]);
    assert.ok(tabs.includes("workshop") && tabs.includes("security"));
    assert.ok(!tabs.includes("appointments"));
  });

  it("ohne beide Rechte gibt es keinen Reiter; Administratoren sehen alle der aktiven Funktionen", async () => {
    assert.deepEqual(await tabsOf(["appointments.view"]), []);
    const all = await tabsOf([], true);
    assert.ok(["workshop", "security", "appointments"].every((id) => all.includes(id)), all.join());
  });

  it("eine ausgeschaltete Funktion bringt ihren Reiter nicht mit, auch nicht für Administratoren", async () => {
    await env.db.featureSetting.create({ data: { key: "workshop.appointments", enabled: false, updatedByName: "test" } });
    assert.ok(!(await tabsOf([], true)).includes("appointments"));
    assert.deepEqual(await tabsOf(["appointments.configure"]), []);
  });
});
