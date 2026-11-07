import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/**
 * Schnellsuche: Treffer gruppiert als Links, Tastaturbedienung (Pfeil ab in die Liste, Enter öffnet den ersten Treffer, Escape schließt), Trefferansage,
 * Ladefehler, Vollbildfeld auf kleinen Bildschirmen (Symbol öffnet, Schließen gibt den Fokus zurück).
 */
let dom: TestDom;
let view: MountedView | null = null;
const realFetch = globalThis.fetch;
let requests: string[] = [];
let respond: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
const pushed: string[] = [];

const groups = [
  { id: "customers", label: "Kunden", hits: [{ id: "c1", title: "Erika Mustermann", subtitle: "#K-7 · Berlin", href: "/customers/c1" }] },
  { id: "vehicles", label: "Fahrzeuge", hits: [{ id: "v1", title: "B AB 123", subtitle: "VW Golf", href: "/vehicles/v1" }, { id: "v2", title: "B XY 1", href: "/vehicles/v2" }] },
];

before(() => {
  dom = installDom({ width: 390, height: 844 });
  globalThis.fetch = ((url: string) => {
    requests.push(String(url));
    return respond();
  }) as never;
});
after(async () => {
  globalThis.fetch = realFetch;
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  requests = [];
  pushed.length = 0;
});

async function mountSearch() {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const { QuickSearch } = await import("./quick-search");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, await withRouter(createElement(QuickSearch), { pushed })));
  const root = view.container;
  const input = () => root.querySelector("input[type='search']") as HTMLInputElement;
  const toggle = () => root.querySelector("button[aria-label='Suche öffnen']") as HTMLButtonElement;
  const type = async (value: string) => {
    await act(() => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await sleep(300);
  };
  const key = (target: Element, k: string) => act(() => void target.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
  const hits = () => [...root.querySelectorAll<HTMLAnchorElement>("[data-hit]")];
  return { root, input, toggle, type, key, hits };
}

describe("QuickSearch", () => {
  it("Feld mit Suchtastatur (type=search, inputMode, enterKeyHint, 44 px über die Tokens); am Handy öffnet ein Symbol das Feld", async () => {
    respond = async () => ({ ok: true, json: async () => ({ groups }) });
    const s = await mountSearch();
    assert.equal(s.input().getAttribute("inputmode"), "search");
    assert.equal(s.input().getAttribute("enterkeyhint"), "search");
    assert.ok(s.input().className.includes("input"), "Eingabebaustein mit den Touch-Tokens");
    assert.equal(s.toggle().getAttribute("aria-expanded"), "false");
    await act(() => s.toggle().click());
    assert.equal(s.toggle().getAttribute("aria-expanded"), "true");
    assert.ok(document.activeElement === s.input(), "Fokus im geöffneten Feld");
    assert.ok(s.root.querySelector("[role='search']")?.className.includes("fixed"), "vollbreit über der Kopfzeile");
  });

  it("zeigt Treffer als Links in Gruppen, sagt die Zahl an und fragt erst ab zwei Zeichen", async () => {
    respond = async () => ({ ok: true, json: async () => ({ groups }) });
    const s = await mountSearch();
    await s.type("m");
    assert.equal(requests.length, 0, "ein Zeichen: keine Abfrage");
    await s.type("mu");
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^\/api\/search\?q=mu$/);
    assert.deepEqual([...s.root.querySelectorAll("h3")].map((h) => h.textContent), ["Kunden", "Fahrzeuge"]);
    assert.deepEqual(s.hits().map((a) => a.getAttribute("href")), ["/customers/c1", "/vehicles/v1", "/vehicles/v2"]);
    assert.equal(s.root.querySelector("[role='status']")?.textContent, "3 Treffer");
    assert.ok(s.root.querySelector("[role='region'][aria-label='Suchergebnisse']"));
  });

  it("Tastatur: Pfeil ab springt in die Liste und wandert durch die Treffer, Pfeil auf zurück ins Feld, Escape schließt; Enter im Feld öffnet den ersten Treffer", async () => {
    respond = async () => ({ ok: true, json: async () => ({ groups }) });
    const s = await mountSearch();
    await s.type("mu");
    await s.key(s.input(), "ArrowDown");
    assert.ok(document.activeElement === s.hits()[0], "erster Treffer");
    await s.key(s.hits()[0], "ArrowDown");
    assert.ok(document.activeElement === s.hits()[1]);
    await s.key(s.hits()[1], "ArrowUp");
    await s.key(s.hits()[0], "ArrowUp");
    assert.ok(document.activeElement === s.input(), "zurück im Feld");
    await s.key(s.input(), "Escape");
    assert.equal(s.root.querySelector("[role='region']"), null);

    await s.type("mus");
    await s.key(s.input(), "Enter");
    assert.deepEqual(pushed, ["/customers/c1"]);
  });

  it("keine Treffer und Ladefehler werden gesagt", async () => {
    respond = async () => ({ ok: true, json: async () => ({ groups: [] }) });
    const s = await mountSearch();
    await s.type("zzz");
    assert.equal(s.root.querySelector("[role='status']")?.textContent, "Keine Treffer.");
    respond = async () => ({ ok: false, json: async () => ({}) });
    await s.type("zzzz");
    assert.match(s.root.querySelector("[role='status']")?.textContent ?? "", /nicht möglich/);
  });

  it("Schließen des Vollbildfeldes (Knopf oder Escape) gibt den Fokus an das Symbol zurück", async () => {
    respond = async () => ({ ok: true, json: async () => ({ groups }) });
    const s = await mountSearch();
    await act(() => s.toggle().click());
    await act(() => (s.root.querySelector("button[aria-label='Suche schließen']") as HTMLButtonElement).click());
    assert.equal(s.toggle().getAttribute("aria-expanded"), "false");
    assert.ok(document.activeElement === s.toggle());

    await act(() => s.toggle().click());
    await s.key(s.input(), "Escape");
    assert.equal(s.toggle().getAttribute("aria-expanded"), "false");
  });
});
