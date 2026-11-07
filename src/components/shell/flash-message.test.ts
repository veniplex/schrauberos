import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { createElement, isValidElement, type ReactElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Flash-Meldungen nach Server Actions (ZP2-Q-4, Toast P2a-2): echte Wiedergabe (happy-dom + react-dom/client) für `FlashMessage` im `ToastProvider` – Cookie wird gelöscht,
 * Erfolg blendet nach `TOAST_SUCCESS_MS` (mindestens 5 s) aus, Fehler bleiben bis zum Schließen, eine neue Meldung (neue id) erscheint wieder – und die Live-Regionen
 * des Toasts stehen immer im DOM (Erfolg höflich, Fehler sofort). `FlashNotice` reicht nur gültige Meldungen weiter.
 */
let dom: TestDom;
let view: MountedView | null = null;
let cookieWrites: string[] = [];

before(() => {
  dom = installDom();
  // Zuweisungen an document.cookie festhalten (happy-dom behandelt Secure/Max-Age eigen; hier zählt, WAS die Komponente schreibt)
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
    set: (value: string) => void cookieWrites.push(value),
  });
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  mock.timers.reset();
  await view?.unmount();
  view = null;
  cookieWrites = [];
});

const props = { id: "a1", cookieName: "so_flash", tone: "success" as "success" | "error", text: "Gespeichert." };

async function withProviders(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  return createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, child));
}
async function show(overrides: Partial<typeof props> = {}) {
  const { FlashMessage } = await import("./flash-message");
  view = await mount(await withProviders(createElement(FlashMessage, { ...props, ...overrides })));
  return view;
}
const text = () => view!.container.textContent ?? "";
const polite = () => view!.container.querySelector('[data-flash-region="polite"]')!;
const assertive = () => view!.container.querySelector('[data-flash-region="assertive"]')!;

describe("Toast mit FlashMessage", () => {
  it("zeigt die Meldung und löscht das Cookie sofort (einmalig); unter HTTPS das __Host-Cookie mit Secure und Pfad /", async () => {
    await show();
    assert.match(text(), /Gespeichert\./);
    assert.deepEqual(cookieWrites, ["so_flash=; Max-Age=0; Path=/"]);
    await view!.unmount();
    view = null;
    cookieWrites = [];
    await show({ cookieName: "__Host-so_flash" });
    assert.deepEqual(cookieWrites, ["__Host-so_flash=; Max-Age=0; Path=/; Secure"]);
  });

  it("die beiden Live-Regionen stehen immer im DOM (leer, solange es keine Meldung gibt); Erfolg in der höflichen, ein Fehler in der sofortigen Region", async () => {
    const { ToastProvider } = await import("@/components/ui/toast");
    const { I18nProvider } = await import("@/i18n/client");
    const { de } = await import("@/i18n/messages/de");
    view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null)));
    assert.equal(polite().getAttribute("aria-live"), "polite");
    assert.equal(assertive().getAttribute("aria-live"), "assertive");
    assert.equal(polite().childElementCount + assertive().childElementCount, 0);
    await view.unmount();
    view = null;

    await show();
    assert.ok(polite().querySelector('[data-flash="success"]'));
    assert.equal(assertive().childElementCount, 0);
    await view!.unmount();
    view = null;

    await show({ tone: "error", text: "Fehlgeschlagen." });
    assert.ok(assertive().querySelector('[data-flash="error"]'));
    assert.equal(polite().childElementCount, 0);
  });

  it("Erfolg bleibt mindestens 5 Sekunden stehen und blendet dann aus", async () => {
    const { TOAST_SUCCESS_MS } = await import("@/components/ui/toast");
    assert.ok(TOAST_SUCCESS_MS >= 5000);
    mock.timers.enable({ apis: ["setTimeout"] });
    await show();
    await act(() => mock.timers.tick(TOAST_SUCCESS_MS - 1));
    assert.match(text(), /Gespeichert\./);
    await act(() => mock.timers.tick(1));
    assert.doesNotMatch(text(), /Gespeichert\./);
  });

  it("ein Fehler bleibt stehen, bis man ihn schließt", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    await show({ tone: "error", text: "Fehlgeschlagen." });
    await act(() => mock.timers.tick(120_000));
    assert.match(text(), /Fehlgeschlagen\./);
    const close = view!.container.querySelector('button[aria-label="Schließen"]') as HTMLButtonElement;
    assert.ok(close);
    await act(() => close.click());
    assert.doesNotMatch(text(), /Fehlgeschlagen\./);
  });

  it("mit der Maus darauf (oder dem Fokus darin) bleibt auch ein Erfolg stehen", async () => {
    const { TOAST_SUCCESS_MS } = await import("@/components/ui/toast");
    mock.timers.enable({ apis: ["setTimeout"] });
    await show();
    const toast = view!.container.querySelector("[data-flash]") as HTMLElement;
    await act(() => void toast.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true })));
    await act(() => mock.timers.tick(TOAST_SUCCESS_MS * 3));
    assert.match(text(), /Gespeichert\./);
  });

  it("eine neue Meldung (neue id) erscheint wieder, auch wenn die vorige geschlossen wurde; dieselbe id nur einmal", async () => {
    const { FlashMessage } = await import("./flash-message");
    await show({ tone: "error", text: "Erste." });
    await act(() => (view!.container.querySelector("button") as HTMLButtonElement).click());
    assert.doesNotMatch(text(), /Erste\./);
    await view!.render(await withProviders(createElement(FlashMessage, { ...props, tone: "error", id: "b2", text: "Zweite." })));
    assert.match(text(), /Zweite\./);
    assert.equal(view!.container.querySelectorAll("[data-flash]").length, 1);
  });
});

describe("FlashNotice", () => {
  let env: TestEnv;
  before(async () => {
    env = await createTestEnv();
  });
  after(() => env.cleanup());

  const render = async () => {
    const { FlashNotice } = await import("./flash-notice");
    return FlashNotice();
  };
  const flashCookie = async (tone: "success" | "error", key = "common.deleted") => {
    const { encodeFlash, FLASH_COOKIE } = await import("@/server/operations/flash");
    env.browser.cookies.set(FLASH_COOKIE, encodeFlash({ id: "x1", tone, key: key as never }));
  };

  it("ohne Meldung nichts; eine gültige Meldung geht übersetzt an den Toast; ein unbekannter Schlüssel wird ignoriert", async () => {
    env.browser.reset();
    assert.equal(await render(), null);

    await flashCookie("success");
    const element = await render();
    assert.ok(isValidElement(element));
    const flash = element.props as { tone: string; text: string; id: string };
    assert.deepEqual({ tone: flash.tone, text: flash.text, id: flash.id }, { tone: "success", text: "Gelöscht.", id: "x1" });

    env.browser.reset();
    await flashCookie("error", "gibt.es.nicht");
    assert.equal(await render(), null);
  });
});
