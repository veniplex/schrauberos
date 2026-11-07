import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { SETUP_CHECKLIST_HIDDEN } from "@/lib/dashboard";

/** Einrichtungs-Checkliste: Darstellung (offene zuerst, Fortschritt, Abschluss) und Ausblenden/Einblenden (nur Administration, mit Audit). */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let actions: typeof import("./actions");

before(async () => {
  env = await createTestEnv();
  dom = installDom();
  actions = await import("./actions");
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});
beforeEach(async () => {
  await env.db.appSetting.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
});

const item = (id: string, done: boolean, recommended = false) => ({ id, labelKey: "settings.checklist.profile.label" as never, hintKey: "settings.checklist.profile.hint" as never, href: `/x/${id}`, recommended, done });

async function show(items: ReturnType<typeof item>[]) {
  const { SetupChecklist } = await import("./setup-checklist");
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, await SetupChecklist({ items })));
  return view.container;
}

describe("SetupChecklist (Darstellung)", () => {
  it("zeigt den Fortschritt, offene Punkte zuerst (Pflicht vor Empfehlung) und den Knopf zum Ausblenden", async () => {
    const root = await show([item("erledigt", true), item("empfohlen", false, true), item("pflicht", false)]);
    assert.match(root.textContent ?? "", /1 von 3 erledigt/);
    const links = [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    assert.deepEqual(links, ["/x/pflicht", "/x/empfohlen", "/x/erledigt"]);
    assert.match(root.textContent ?? "", /empfohlen/);
    assert.ok([...root.querySelectorAll("button")].some((b) => b.textContent === "Checkliste ausblenden"));
  });

  it("alles erledigt: Hinweis und „Fertig – Checkliste ausblenden“", async () => {
    const root = await show([item("a", true), item("b", true)]);
    assert.match(root.textContent ?? "", /2 von 2 erledigt/);
    assert.match(root.textContent ?? "", /Alles erledigt/);
    assert.ok([...root.querySelectorAll("button")].some((b) => b.textContent === "Fertig – Checkliste ausblenden"));
  });

  it("ohne Punkte keine Karte", async () => {
    const root = await show([]);
    assert.equal(root.textContent, "");
  });
});

describe("Checkliste ausblenden und einblenden", () => {
  const login = async (permissions: string[]) => env.signIn(await env.user({ username: `u${Math.random()}`, roles: [await env.role({ permissions })] }));

  it("nur mit settings.manage; schreibt die Einstellung und das Audit-Log", async () => {
    await login(["users.view"]);
    assert.equal(await redirectOf(() => actions.setSetupChecklistHidden({}, form({ hidden: "true" }))), "/forbidden");
    assert.equal(await env.db.appSetting.count({ where: { key: SETUP_CHECKLIST_HIDDEN } }), 0);

    await login(["settings.manage"]);
    await actions.setSetupChecklistHidden({}, form({ hidden: "true" })).catch(() => undefined);
    assert.equal((await env.db.appSetting.findUnique({ where: { key: SETUP_CHECKLIST_HIDDEN } }))?.value, "true");
    assert.equal(await env.db.auditLog.count({ where: { action: "setup.checklistHide" } }), 1);

    await actions.setSetupChecklistHidden({}, form({ hidden: "false" })).catch(() => undefined);
    assert.equal(await env.db.appSetting.count({ where: { key: SETUP_CHECKLIST_HIDDEN } }), 0, "wieder eingeblendet = Einstellung entfernt");
    assert.equal(await env.db.auditLog.count({ where: { action: "setup.checklistShow" } }), 1);
  });

  it("ein ungültiger Wert ändert nichts", async () => {
    await login(["settings.manage"]);
    const state = await actions.setSetupChecklistHidden({}, form({ hidden: "vielleicht" })).catch(() => ({ error: "x" }));
    assert.ok(state);
    assert.equal(await env.db.appSetting.count({ where: { key: SETUP_CHECKLIST_HIDDEN } }), 0);
  });
});
