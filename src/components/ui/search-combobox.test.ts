import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * Combobox (ARIA-Muster mit `aria-activedescendant`): Option-Ids, Pfeiltasten ohne Fokuswechsel, Auswahl mit Enter, Trefferansage in einer Live-Region, Ladefehler,
 * „neu anlegen“ bei keinem Treffer, Entfernen gibt den Fokus ins Feld zurück.
 */
let dom: TestDom;
let view: MountedView | null = null;
const realFetch = globalThis.fetch;
let respond: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> = async () => ({ ok: true, json: async () => ({ results: [] }) });

before(() => {
  dom = installDom();
  globalThis.fetch = ((url: string) => respond(String(url))) as never;
});
after(async () => {
  globalThis.fetch = realFetch;
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

async function withProviders(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("./toast");
  const { de } = await import("@/i18n/messages/de");
  return createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, child));
}

const results = [
  { id: "a", label: "Alpha", sublabel: "erste" },
  { id: "b", label: "Beta" },
];

async function mountBox(props: Record<string, unknown> = {}) {
  const { SearchCombobox } = await import("./search-combobox");
  const { Field, Form } = await import("./form");
  view = await mount(
    await withProviders(
      createElement(
        Form,
        { action: (async () => ({})) as never },
        createElement(Field as never, { label: "Kunde", name: "customerId", hint: "Hinweis", required: true }, createElement(SearchCombobox as never, { endpoint: "/api/x", name: "customerId", placeholder: "Suchen …", ...props })),
      ),
    ),
  );
  const root = view.container;
  const input = () => root.querySelector("input[role='combobox']") as HTMLInputElement;
  const type = async (value: string) => {
    await act(() => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await sleep(260); // Entprellung (180 ms) + Antwort
  };
  const key = (k: string) => act(() => void input().dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
  return { root, input, type, key };
}

describe("SearchCombobox", () => {
  it("Feld und Liste sind verbunden: Id, Beschriftung, Beschreibung, aria-activedescendant folgt den Pfeiltasten, Enter wählt", async () => {
    respond = async () => ({ ok: true, json: async () => ({ results }) });
    const c = await mountBox();
    const input = c.input();
    assert.equal(c.root.querySelector("label")?.getAttribute("for"), input.id, "Beschriftung zeigt auf das Feld");
    assert.ok(input.getAttribute("aria-describedby")?.includes("-hint"));
    assert.equal(input.getAttribute("aria-required"), "true");
    assert.equal(input.getAttribute("aria-expanded"), "false");

    await c.type("al");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    const list = c.root.querySelector("[role='listbox']")!;
    assert.equal(input.getAttribute("aria-controls"), list.id);
    const options = [...list.querySelectorAll("[role='option']")];
    assert.equal(options.length, 2);
    assert.ok(options.every((o) => o.id), "jede Option hat eine Id");
    assert.equal(input.getAttribute("aria-activedescendant"), options[0].id);
    assert.equal(options[0].getAttribute("aria-selected"), "true");

    await c.key("ArrowDown");
    assert.equal(input.getAttribute("aria-activedescendant"), options[1].id);
    assert.ok(document.activeElement === input, "der Fokus bleibt im Feld");
    await c.key("Enter");
    assert.equal((c.root.querySelector("input[type='hidden'][name='customerId']") as HTMLInputElement).value, "b");
    assert.equal(c.root.querySelector("input[role='combobox']"), null);
  });

  it("sagt die Zahl der Treffer an (Live-Region), bei keinem Treffer „Keine Treffer“", async () => {
    respond = async () => ({ ok: true, json: async () => ({ results }) });
    const c = await mountBox();
    await c.type("al");
    assert.equal(c.root.querySelector("[role='status']")?.textContent, "2 Treffer");
    respond = async () => ({ ok: true, json: async () => ({ results: [] }) });
    await c.type("zzz");
    assert.equal(c.root.querySelector("[role='status']")?.textContent, "Keine Treffer.");
  });

  it("zeigt einen Ladefehler an und sagt ihn an", async () => {
    respond = async () => ({ ok: false, json: async () => ({}) });
    const c = await mountBox();
    await c.type("al");
    assert.match(c.root.textContent ?? "", /Die Suche ist gerade nicht möglich/);
    assert.match(c.root.querySelector("[role='status']")?.textContent ?? "", /nicht möglich/);
  });

  it("bei keinem Treffer: „neu anlegen“ mit dem Suchtext, nicht bei einem Ladefehler", async () => {
    respond = async () => ({ ok: true, json: async () => ({ results: [] }) });
    const c = await mountBox({ createHref: "/vehicles/new", createLabel: "Fahrzeug neu anlegen", createParam: "plate" });
    await c.type("B-XY 12");
    const link = c.root.querySelector("a") as HTMLAnchorElement;
    assert.equal(link.textContent, "Fahrzeug neu anlegen");
    assert.equal(link.getAttribute("href"), "/vehicles/new?plate=B-XY%2012");
  });

  it("Escape schließt nur die Liste; Entfernen der Auswahl gibt den Fokus ins Suchfeld zurück", async () => {
    respond = async () => ({ ok: true, json: async () => ({ results }) });
    const c = await mountBox();
    await c.type("al");
    await c.key("Escape");
    assert.equal(c.root.querySelector("[role='listbox']"), null);
    assert.equal(c.input().value, "al", "Eingabe bleibt");

    await c.key("ArrowDown");
    await c.key("Enter");
    const remove = c.root.querySelector("button[aria-label^='Entfernen']") as HTMLButtonElement;
    assert.match(remove.getAttribute("aria-label") ?? "", /^Entfernen: /);
    await act(() => remove.click());
    assert.ok(document.activeElement === c.input(), "Fokus im Suchfeld");
  });
});
