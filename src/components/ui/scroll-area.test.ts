import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * Scroll-Rahmen: Tab-Stopp und Region nur, wenn der Inhalt tatsächlich überläuft (sonst ein überflüssiger Halt je Tabelle); Name der Region ≠ Name der Tabelle.
 * happy-dom kennt kein Layout: Die Maße kommen aus `sizes`.
 */
let dom: TestDom;
let view: MountedView | null = null;
const sizes = { scrollWidth: 300, clientWidth: 300 };

before(() => {
  dom = installDom();
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => sizes.scrollWidth });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => sizes.clientWidth });
});
after(async () => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

async function show(props: Record<string, unknown> = {}) {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const { ScrollArea } = await import("./scroll-area");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ScrollArea as never, { label: "Kunden", ...props }, createElement("table", null, createElement("caption", null, "Kunden")))));
  await sleep(40); // erste Messung (Animationsbild)
  return view.container;
}

describe("ScrollArea", () => {
  it("passt der Inhalt hinein: keine Region, kein Tab-Stopp, kein Hinweis", async () => {
    Object.assign(sizes, { scrollWidth: 300, clientWidth: 300 });
    const root = await show();
    assert.equal(root.querySelector("[role='region']"), null);
    assert.equal(root.querySelector("[tabindex]"), null);
    assert.equal(root.querySelector("p"), null);
  });

  it("läuft er über: fokussierbare Region mit eigenem Namen (nicht dem der Tabelle), Hinweis „Seitlich wischen“", async () => {
    Object.assign(sizes, { scrollWidth: 900, clientWidth: 300 });
    const root = await show();
    const region = root.querySelector("[role='region']");
    assert.equal(region?.getAttribute("tabindex"), "0");
    assert.equal(region?.getAttribute("aria-label"), "Kunden (seitlich scrollbar)");
    assert.notEqual(region?.getAttribute("aria-label"), root.querySelector("caption")?.textContent, "kein doppelter Name");
    assert.match(root.querySelector("p")?.textContent ?? "", /Seitlich wischen/);
  });

  it("ohne `hint` kein Hinweistext; das Scrollen aktualisiert die Maße", async () => {
    Object.assign(sizes, { scrollWidth: 900, clientWidth: 300 });
    const root = await show({ hint: false });
    assert.ok(root.querySelector("[role='region']"));
    assert.equal(root.querySelector("p"), null);
    Object.assign(sizes, { scrollWidth: 300, clientWidth: 300 });
    await act(() => void (root.querySelector("[role='region']") as HTMLElement).dispatchEvent(new window.Event("scroll")));
    assert.equal(root.querySelector("[role='region']"), null, "nach der Größenänderung kein Tab-Stopp mehr");
  });
});
