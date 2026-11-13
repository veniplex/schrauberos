import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Titel der Registerkarte folgen der Überschrift (Z6-5 N4): Rechnung aus Auftrag, Einstellungen mit Reiter, Sperrseite.
 */
let env: TestEnv;

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.billing", enabled: true, updatedByName: "test" } });
});
after(() => env.cleanup());

const login = async (permissions: readonly string[], admin = false) => {
  env.signOut();
  await env.signIn(await env.user({ username: `t-${Math.random().toString(36).slice(2)}`, roles: [await env.role({ isAdmin: admin, permissions })] }));
};
const titleOf = (meta: { title?: unknown }) => String(meta.title);

describe("Seitentitel", () => {
  it("Neuer Beleg: „Rechnung aus Auftrag“ nur mit ?order=, sonst „Neuer Beleg“", async () => {
    await login(["billing.edit", "billing.view"]);
    const { generateMetadata } = await import("@/app/(app)/(office)/billing/new/page");
    assert.equal(titleOf(await generateMetadata({ searchParams: Promise.resolve({ order: "abc" }) })), "Rechnung aus Auftrag");
    assert.equal(titleOf(await generateMetadata({ searchParams: Promise.resolve({}) })), "Neuer Beleg");
  });

  it("Einstellungen: der Titel nennt den gewählten Reiter; unbekannter Reiter = erster; ohne Sitzung nur „Einstellungen“", async () => {
    await login(["settings.manage"], true);
    const { settingsTabsFor } = await import("@/modules/registry");
    const { getSession } = await import("@/server/auth/session");
    const tabs = settingsTabsFor((await getSession())!);
    assert.ok(tabs.length >= 2, "mindestens zwei Reiter");
    const { generateMetadata } = await import("@/app/(app)/(admin)/settings/page");
    const { de } = await import("@/i18n/messages/de");
    const label = (key: string) => String(key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], de));
    assert.equal(titleOf(await generateMetadata({ searchParams: Promise.resolve({ tab: tabs[1].id }) })), `Einstellungen · ${label(tabs[1].labelKey)}`);
    assert.equal(titleOf(await generateMetadata({ searchParams: Promise.resolve({ tab: "gibt-es-nicht" }) })), `Einstellungen · ${label(tabs[0].labelKey)}`);
    env.signOut();
    assert.equal(titleOf(await generateMetadata({ searchParams: Promise.resolve({ tab: tabs[1].id }) })), "Einstellungen");
  });

  it("Sperrseite: Titel „Kein Zugriff“ statt nur dem Namen der Anwendung", async () => {
    const { generateMetadata } = await import("@/app/forbidden/page");
    assert.equal(titleOf(await generateMetadata()), "Kein Zugriff");
  });
});
