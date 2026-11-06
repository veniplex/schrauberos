import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Flash-Meldungen nach Server Actions (ZP2-Q-4): echte Wiedergabe (happy-dom + react-dom/client) für `FlashMessage` – Cookie wird gelöscht, Erfolg blendet nach 8 s aus,
 * Fehler bleiben bis zum Schließen, eine neue Meldung (neue id) erscheint wieder – und `FlashNotice` hält die Live-Regionen immer im DOM.
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

const props = { id: "a1", cookieName: "so_flash", tone: "success" as "success" | "error", text: "Gespeichert.", closeLabel: "Schließen" };
async function show(overrides: Partial<typeof props> = {}) {
  const { FlashMessage } = await import("./flash-message");
  view = await mount(createElement(FlashMessage, { ...props, ...overrides }));
  return view;
}
const text = () => view!.container.textContent ?? "";

describe("FlashMessage", () => {
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

  it("hat selbst keine Live-Region-Rolle (die Ansage übernimmt der immer vorhandene Container), Fehler und Erfolg unterscheiden sich nur im Ton", async () => {
    await show();
    assert.equal(view!.container.querySelector("[role]"), null);
    assert.ok(view!.container.querySelector('[data-flash="success"]'));
    await view!.unmount();
    view = null;
    await show({ tone: "error", text: "Fehlgeschlagen." });
    assert.equal(view!.container.querySelector("[role]"), null);
    assert.ok(view!.container.querySelector('[data-flash="error"]'));
  });

  it("Erfolg blendet sich nach 8 Sekunden aus, nicht früher", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    await show();
    await act(() => mock.timers.tick(7_999));
    assert.match(text(), /Gespeichert\./);
    await act(() => mock.timers.tick(1));
    assert.equal(text(), "");
  });

  it("ein Fehler bleibt stehen, bis man ihn schließt", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    await show({ tone: "error", text: "Fehlgeschlagen." });
    await act(() => mock.timers.tick(60_000));
    assert.match(text(), /Fehlgeschlagen\./);
    const close = view!.container.querySelector('button[aria-label="Schließen"]') as HTMLButtonElement;
    assert.ok(close);
    await act(() => close.click());
    assert.equal(text(), "");
  });

  it("eine neue Meldung (neue id) erscheint wieder, auch wenn die vorige geschlossen wurde", async () => {
    const { FlashMessage } = await import("./flash-message");
    await show({ tone: "error", text: "Erste." });
    await act(() => (view!.container.querySelector("button") as HTMLButtonElement).click());
    assert.equal(text(), "");
    await view!.render(createElement(FlashMessage, { ...props, tone: "error", id: "b2", text: "Zweite." }));
    assert.match(text(), /Zweite\./);
  });
});

describe("FlashNotice: Live-Regionen immer im DOM", () => {
  let env: TestEnv;
  before(async () => {
    env = await createTestEnv();
  });
  after(() => env.cleanup());

  const render = async () => {
    const { FlashNotice } = await import("./flash-notice");
    return renderToStaticMarkup(await FlashNotice());
  };
  const flashCookie = async (tone: "success" | "error") => {
    const { encodeFlash, FLASH_COOKIE } = await import("@/server/operations/flash");
    env.browser.cookies.set(FLASH_COOKIE, encodeFlash({ id: "x1", tone, key: "common.deleted" }));
  };

  it("ohne Meldung: beide Regionen sind da (leer, ausgeblendet über empty:hidden)", async () => {
    env.browser.reset();
    const html = await render();
    assert.match(html, /<div aria-live="polite"[^>]*data-flash-region="polite"[^>]*><\/div>/);
    assert.match(html, /<div aria-live="assertive"[^>]*data-flash-region="assertive"[^>]*><\/div>/);
  });

  it("Erfolg steht in der höflichen, ein Fehler in der sofortigen Region; die andere bleibt leer", async () => {
    env.browser.reset();
    await flashCookie("success");
    let html = await render();
    assert.match(html, /data-flash-region="polite"[^>]*>[\s\S]*data-flash="success"[\s\S]*<\/div><div[^>]*data-flash-region="assertive"[^>]*><\/div>/);

    env.browser.reset();
    await flashCookie("error");
    html = await render();
    assert.match(html, /data-flash-region="polite"[^>]*><\/div><div[^>]*data-flash-region="assertive"[^>]*>[\s\S]*data-flash="error"/);
  });
});
