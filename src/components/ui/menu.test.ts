import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/** Aufklappfläche (Konto-Menü, Neu-Menü): Popover im Offenlegungsmuster – kein role="menu", Escape gibt den Fokus an den Knopf zurück. */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

async function mountMenu() {
  const { Menu, MenuLink } = await import("./menu");
  view = await mount(
    await withRouter(
      createElement("div", null, [
        createElement(Menu as never, { key: "m", label: "Konto", trigger: "Konto" }, createElement(MenuLink, { href: "/account" }, "Mein Konto")),
        createElement("button", { key: "o", id: "other", type: "button" }, "Außerhalb"),
      ]),
    ),
  );
  const root = view.container;
  const trigger = () => root.querySelector("button[aria-label='Konto']") as HTMLButtonElement;
  return { root, trigger };
}

describe("Menu", () => {
  it("öffnet als Popover: aria-expanded/aria-controls am Knopf, keine Menü-Rollen (haspopup, menu, menuitem)", async () => {
    const m = await mountMenu();
    assert.equal(m.trigger().getAttribute("aria-expanded"), "false");
    assert.equal(m.trigger().getAttribute("aria-haspopup"), null);
    await act(() => m.trigger().click());
    assert.equal(m.trigger().getAttribute("aria-expanded"), "true");
    const panel = m.root.querySelector(`[id='${m.trigger().getAttribute("aria-controls")}']`);
    assert.ok(panel?.textContent?.includes("Mein Konto"));
    assert.equal(m.root.querySelector("[role='menu'], [role='menuitem']"), null);
  });

  it("Escape schließt und gibt den Fokus an den Knopf zurück", async () => {
    const m = await mountMenu();
    await act(() => m.trigger().click());
    (m.root.querySelector("a") as HTMLElement).focus();
    await act(() => void document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(m.trigger().getAttribute("aria-expanded"), "false");
    assert.ok(document.activeElement === m.trigger(), "Fokus am Auslöser");
  });

  it("Klick daneben schließt; ein zweiter Klick auf den Knopf auch", async () => {
    const m = await mountMenu();
    await act(() => m.trigger().click());
    await act(() => void document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    assert.equal(m.trigger().getAttribute("aria-expanded"), "false");
    await act(() => m.trigger().click());
    await act(() => m.trigger().click());
    assert.equal(m.trigger().getAttribute("aria-expanded"), "false");
  });

  it("der Fokus verlässt die Fläche (Tab in die Seite): sie schließt", async () => {
    const m = await mountMenu();
    await act(() => m.trigger().click());
    const link = m.root.querySelector("a") as HTMLElement;
    link.focus();
    await act(() => void link.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, relatedTarget: m.root.querySelector("#other") })));
    assert.equal(m.trigger().getAttribute("aria-expanded"), "false");
  });
});
