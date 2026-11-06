import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/** Fehlerseite (error.tsx): normaler Fehler mit Wiederholen, und der Sonderfall „Server Action nicht gefunden“ nach einem Web-Update. */
let dom: TestDom;
let view: MountedView | null = null;
let reloads = 0;

before(() => {
  dom = installDom();
  Object.defineProperty(window.location, "reload", { value: () => void reloads++, configurable: true });
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  reloads = 0;
  window.sessionStorage.clear();
  mock.restoreAll();
});

async function show(error: unknown, retry: () => void = () => {}) {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const { ErrorView } = await import("./error-view");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ErrorView, { error, retry, fullscreen: true })));
  return view.container;
}

const stale = () => Object.assign(new Error("Failed to find Server Action abc. This request might be from an older or newer deployment."), { name: "UnrecognizedActionError" });

describe("ErrorView", () => {
  it("normaler Fehler: Meldung, Fehlerkennung, „Erneut versuchen“ ruft retry auf; kein automatisches Neuladen", async () => {
    mock.method(console, "error", () => {});
    let retried = 0;
    const root = await show(Object.assign(new Error("x"), { digest: "d123" }), () => void retried++);
    assert.equal(root.querySelector("h1")?.textContent, "Das hat nicht geklappt");
    assert.match(root.textContent ?? "", /Fehlerkennung: d123/);
    assert.ok(root.querySelector("[data-status='error']"));
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Erneut versuchen");
    assert.ok(button);
    await act(() => button.click());
    assert.equal(retried, 1);
    assert.equal(reloads, 0);
  });

  it("veraltete Seite nach einem Web-Update: lädt einmal selbst neu und sagt das an", async () => {
    const root = await show(stale());
    assert.equal(reloads, 1);
    assert.match(root.textContent ?? "", /Sie wird neu geladen/);
    assert.equal(root.querySelector("[data-status='error']"), null, "keine Fehlerseite, sondern der Hinweis auf die neue Version");
  });

  it("nicht in Schleife: kurz nach einem Neuladen wird nicht noch einmal geladen, und der Text verspricht es nicht", async () => {
    window.sessionStorage.setItem("so-stale-reload", String(Date.now()));
    const root = await show(stale());
    assert.equal(reloads, 0);
    assert.doesNotMatch(root.textContent ?? "", /Sie wird neu geladen/);
    assert.match(root.textContent ?? "", /Bitte die Seite neu laden/);
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Seite neu laden");
    assert.ok(button, "der Knopf bleibt, damit man selbst neu laden kann");
    await act(() => button.click());
    assert.equal(reloads, 1);
  });
});
