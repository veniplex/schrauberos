import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * Doku-Editor in einem echten Renderer: Eingaben über die **Werkzeugleiste** (Fett, Tabelle …) gelten als Änderung – Entwurf in `sessionStorage` und Warnung beim Verlassen
 * (React meldet programmatisch gesetzte Werte nicht von selbst als Ereignis).
 */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;

before(async () => {
  env = await createTestEnv(); // Fakes für next/*, Aktionen laden ohne Next-Laufzeit
  dom = installDom();
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});
after(async () => {
  await dom.close();
  env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  sessionStorage.clear();
});

async function mountEditor() {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  const { DocEditor } = await import("./doc-editor");
  const editor = createElement(DocEditor as never, {
    area: "it",
    initial: { title: "", categoryId: "", content: "", pinned: false },
    categories: [],
    cancelHref: "/docs/it",
  });
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, editor)));
  const root = view.container;
  const textarea = () => root.querySelector("textarea[name='content']") as HTMLTextAreaElement;
  const tool = (label: string) => root.querySelector(`button[aria-label='${label}']`) as HTMLButtonElement;
  return { root, textarea, tool };
}

describe("DocEditor", () => {
  it("eine Eingabe über die Werkzeugleiste landet im Entwurf (Schlüssel je Bereich und Seite)", async () => {
    const e = await mountEditor();
    await act(() => e.tool("Fett").click());
    await sleep(500); // Animationsbild (Fokus, Ereignis) und Entprellung des Entwurfs
    const stored = JSON.parse(sessionStorage.getItem("so_draft:anon:doc:it:new") ?? "null") as { entries: Array<{ name: string; value: string }> } | null;
    assert.ok(stored, "Entwurf wurde geschrieben");
    assert.match(stored.entries.find((entry) => entry.name === "content")?.value ?? "", /\*\*.+\*\*/);
  });

  it("mit Text aus der Werkzeugleiste fragt ein Klick auf einen Link der Anwendung „Änderungen verwerfen?“", async () => {
    const e = await mountEditor();
    await act(() => e.tool("Tabelle").click());
    await sleep(60);
    const cancel = [...e.root.querySelectorAll("a")].find((a) => a.textContent === "Abbrechen") as HTMLAnchorElement;
    e.root.addEventListener("click", (event) => event.preventDefault()); // happy-dom folgt sonst dem Link
    await act(() => void cancel.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    assert.ok(e.root.querySelector("dialog")?.open, "Rückfrage");
    assert.deepEqual(env.browser.navigations, []);
    await act(() => void ([...e.root.querySelectorAll("dialog button")].find((b) => b.textContent === "Verwerfen") as HTMLButtonElement).click());
    assert.deepEqual(env.browser.navigations, ["/docs/it"]);
  });
});
