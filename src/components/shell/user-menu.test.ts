import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { installFakes } from "@/test/harness";
import { withRouter } from "@/test/router";

/** Abmelden (P3-5): Die Zwischenspeicher des Service Workers werden geleert, die Abmeldung selbst wartet nicht darauf. */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
  installFakes();
  dom = installDom({ width: 1440 });
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe("UserMenu: Abmelden", () => {
  it("schickt CLEAR an den steuernden Service Worker und löscht die Zwischenspeicher der App", async () => {
    const messages: unknown[] = [];
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: { postMessage: (m: unknown) => messages.push(m) } } });
    const deleted: string[] = [];
    const store = ["sos-static-1", "sos-offline-1", "fremd"];
    Object.defineProperty(globalThis, "caches", { configurable: true, value: { keys: async () => store, delete: async (name: string) => (deleted.push(name), true) } });

    let loggedOut = 0;
    const { I18nProvider } = await import("@/i18n/client");
    const { de } = await import("@/i18n/messages/de");
    const { UserMenu } = await import("./user-menu");
    const element = createElement(UserMenu, { name: "Anna", roles: "Admin", locale: "de", theme: "system", logoutAction: async () => void loggedOut++, hasDevice: false } as never) as ReactElement;
    view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, (await withRouter(element, { pathname: "/" })) as ReactElement));
    const root = view.container;
    await act(() => (root.querySelector("button") as HTMLButtonElement).click());
    const logout = [...root.querySelectorAll("button")].find((b) => /Abmelden/.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
    assert.ok(logout, "Abmelden-Knopf");
    await act(() => {
      logout.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.deepEqual(messages, [{ type: "CLEAR" }]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(deleted.sort(), ["sos-offline-1", "sos-static-1"], "nur die eigenen, nicht „fremd“");
    delete (globalThis as Record<string, unknown>).caches;
  });
});
