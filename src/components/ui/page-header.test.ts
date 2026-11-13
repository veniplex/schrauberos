import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";

/**
 * Seitenkopf (Z6-5 N2): Das Hilfe-Symbol steht auf jeder Seite am Ende der Titelzeile – nie bei den Aktionen (dort rutschte es auf dem Handy bei Seiten mit Beschreibung und Aktionen in eine eigene Zeile,
 * auf Formularseiten ohne Beschreibung stand es rechts neben dem Titel).
 */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  const role = await env.role({ isAdmin: true, permissions: ["settings.manage"] });
  await env.signIn(await env.user({ username: "kopf", roles: [role] }));
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

async function show(props: Record<string, unknown>): Promise<HTMLElement> {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const { PageHeader } = await import("./page-header");
  const resolved: ReactNode = await resolveServerTree(createElement(PageHeader as never, props));
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, resolved));
  return view.container;
}

describe("PageHeader", () => {
  it("Titel, Beschreibung und Aktionen: das Hilfe-Symbol steht in der Titelzeile, nicht bei den Aktionen", async () => {
    const root = await show({ title: "Kunden", description: "Alle Kunden der Werkstatt", actions: createElement("a", { href: "/customers/new", "data-testid": "aktion" }, "Neuer Kunde"), help: "admin.settings" });
    const row = root.querySelector("[data-page-title-row]")!;
    const help = root.querySelector('a[href="/help/admin.settings"]');
    assert.ok(help, "Hilfe-Symbol vorhanden");
    assert.ok(row.contains(help!), "das Symbol steht in der Titelzeile");
    assert.equal(row.querySelector("h1")?.textContent, "Kunden");
    const action = root.querySelector('[data-testid="aktion"]')!;
    assert.equal(action.closest("[data-page-title-row]"), null, "die Aktionen stehen außerhalb der Titelzeile");
    assert.equal(help!.closest("div")?.contains(action), false, "das Hilfe-Symbol teilt sich keinen Behälter mit den Aktionen");
  });

  it("ohne Beschreibung und ohne Aktionen (Formularseite) steht das Symbol an derselben Stelle", async () => {
    const root = await show({ title: "Neuer Kunde", help: "admin.settings" });
    const row = root.querySelector("[data-page-title-row]")!;
    assert.ok(row.querySelector('a[href="/help/admin.settings"]'));
    assert.equal(root.querySelectorAll('a[href="/help/admin.settings"]').length, 1);
  });

  it("ohne sichtbares Kapitel gibt es kein Symbol und keinen leeren Aktionsbehälter", async () => {
    const root = await show({ title: "Seite", help: "workshop.orders" }); // Funktion in der Testdatenbank ausgeschaltet
    assert.equal(root.querySelector('a[href^="/help/"]'), null);
    const header = root.querySelector("header")!;
    assert.equal(header.querySelectorAll(".flex-wrap.items-center.gap-2").length, 0);
  });
});
