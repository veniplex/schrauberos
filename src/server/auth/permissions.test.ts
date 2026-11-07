import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * **Eine Rechteberechnung für drei Wege:** Sitzung (`getSession`), API-Token (`authenticateApiRequest`) und Kalender-Abo (`authenticateFeed`) leiten die wirksamen Rechte aus Rollen und aktiven Funktionen
 * über `grantedPermissions` ab. Der Test prüft sie gegeneinander – für Rollen mit einzelnen Rechten, Administratoren und eine ausgeschaltete Funktion. Wer eine neue Sperre einführt, soll hier alle drei
 * Wege treffen (und der Test zeigt, wenn einer abweicht).
 */
let env: TestEnv;
const PROBE = ["appointments.view", "customers.view", "employees.view", "vehicles.view", "fleet.view", "invoices.view", "orders.view", "tires.view"] as const;

before(async () => {
  env = await createTestEnv();
});
after(() => env.cleanup());

let n = 0;
async function account(options: { permissions?: readonly string[]; admin?: boolean }) {
  const role = await env.role({ key: `perm-${++n}`, isAdmin: options.admin, permissions: options.permissions ?? [] });
  const user = await env.user({ username: `perm-${n}`, roles: [role] });
  return { user, role };
}

async function viaSession(user: Awaited<ReturnType<TestEnv["user"]>>): Promise<Set<string>> {
  const { getSession } = await import("@/server/auth/session");
  await env.signIn(user);
  const session = (await getSession())!;
  env.signOut();
  return new Set(PROBE.filter((p) => session.can(p)));
}

async function viaApi(userId: string): Promise<Set<string>> {
  const { authenticateApiRequest } = await import("@/server/api/auth");
  const { id, token } = await makeToken(env, { ownerId: userId, scope: PROBE });
  void id;
  const auth = await authenticateApiRequest(apiRequest("GET", "/customers", { token }));
  assert.ok(auth.ok, "Token gültig");
  return new Set(PROBE.filter((p) => auth.ok && auth.principal.can(p)));
}

async function viaFeed(userId: string): Promise<Set<string> | "rejected"> {
  const { authenticateFeed } = await import("@/modules/workshop/appointments/feed");
  const { generateFeedToken, hashFeedToken, feedTokenHint } = await import("@/modules/workshop/appointments/feed-token");
  const token = generateFeedToken();
  await env.db.calendarFeedToken.deleteMany({ where: { userId } });
  await env.db.calendarFeedToken.create({ data: { userId, tokenHash: hashFeedToken(token), hint: feedTokenHint(token) } });
  const auth = await authenticateFeed(`${token}.ics`, new Request("http://localhost/api/ical/x.ics"));
  if (!auth.ok) return "rejected";
  return new Set(PROBE.filter((p) => auth.owner.can(p)));
}

/** die Rechte, die der Feed überhaupt kennt (alle anderen liest er nie) */
const FEED_KNOWN = new Set(["appointments.view", "customers.view", "employees.view", "vehicles.view", "fleet.view"]);

describe("wirksame Rechte: Sitzung, API und Kalender-Abo rechnen gleich", () => {
  const scenarios: Array<{ name: string; permissions?: string[]; admin?: boolean; featureOff?: string }> = [
    { name: "Rolle mit einzelnen Rechten", permissions: ["appointments.view", "customers.view", "invoices.view"] },
    { name: "Rolle mit Terminen und Mitarbeitern", permissions: ["appointments.view", "employees.view"] },
    { name: "Rolle ohne Terminrecht", permissions: ["orders.view", "tires.view"] },
    { name: "Administrator", admin: true },
    { name: "Rolle, deren Funktion ausgeschaltet ist", permissions: ["appointments.view", "vehicles.view", "fleet.view"], featureOff: "workshop.vehicles" },
    { name: "Administrator, eine Funktion ausgeschaltet (auch Administratoren verlieren ihre Rechte)", admin: true, featureOff: "office.fleet" },
  ];

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      if (scenario.featureOff) await env.db.featureSetting.upsert({ where: { key: scenario.featureOff }, update: { enabled: false }, create: { key: scenario.featureOff, enabled: false, updatedByName: "test" } });
      try {
        const { user } = await account(scenario);
        const session = await viaSession(user);
        // API: Scope ∩ Rechte des Besitzers; der Scope enthält alle Probe-Rechte, also ist es genau die Rechtemenge des Besitzers
        assert.deepEqual([...(await viaApi(user.id))].sort(), [...session].sort(), "API = Sitzung");
        const feed = await viaFeed(user.id);
        if (session.has("appointments.view")) {
          assert.notEqual(feed, "rejected");
          const known = [...session].filter((p) => FEED_KNOWN.has(p)).sort();
          assert.deepEqual([...(feed as Set<string>)].filter((p) => FEED_KNOWN.has(p)).sort(), known);
        } else {
          assert.equal(feed, "rejected", "ohne appointments.view gibt es keinen Feed");
        }
      } finally {
        if (scenario.featureOff) await env.db.featureSetting.delete({ where: { key: scenario.featureOff } });
      }
    });
  }

  it("ausgeschaltete Funktion: ihre Rechte fehlen in allen drei Wegen", async () => {
    await env.db.featureSetting.upsert({ where: { key: "office.employees" }, update: { enabled: false }, create: { key: "office.employees", enabled: false, updatedByName: "test" } });
    try {
      const { user } = await account({ admin: true });
      assert.ok(!(await viaSession(user)).has("employees.view"));
      assert.ok(!(await viaApi(user.id)).has("employees.view"));
      const feed = await viaFeed(user.id);
      assert.notEqual(feed, "rejected");
      assert.ok(!(feed as Set<string>).has("employees.view"));
    } finally {
      await env.db.featureSetting.delete({ where: { key: "office.employees" } });
    }
  });
});
