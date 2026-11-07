import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * `useInlineAction` für einzelne Knöpfe in einem echten Renderer: Erfolg als Toast, Fehler als Toast (bleibt stehen), Netzwerkfehler als Meldung statt Fehlerseite,
 * Wartezustand während der Antwort, Absende-Knopf (`name`/`value`) kommt in den Formulardaten an.
 */
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

type State = { ok?: boolean; error?: string; message?: string };

async function mountWith(action: (prev: State, data: FormData) => Promise<State>) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("./toast");
  const { useInlineAction } = await import("./inline-action");
  const { Button } = await import("./buttons");
  const { de } = await import("@/i18n/messages/de");
  function Probe() {
    const [state, dispatch, pending] = useInlineAction(action as never);
    return createElement(
      "form",
      { action: dispatch },
      createElement("input", { type: "hidden", name: "id", value: "42" }),
      createElement(Button as never, { type: "submit", name: "status", value: "done", disabled: pending }, "Fertig"),
      createElement("span", { "data-probe": "" }, `${pending ? "wartet" : "bereit"}|${(state as State).ok ? "ok" : ""}`),
    );
  }
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, createElement(Probe))));
  const root = view.container;
  return {
    button: () => root.querySelector("button") as HTMLButtonElement,
    output: () => root.querySelector("[data-probe]")?.textContent,
    toasts: () => [...document.querySelectorAll("[data-flash]")].map((n) => `${n.getAttribute("data-flash")}: ${n.textContent}`),
  };
}

describe("useInlineAction", () => {
  it("sendet die Felder samt Absende-Knopf und zeigt die Erfolgsmeldung als Toast", async () => {
    const seen: Array<Record<string, FormDataEntryValue>> = [];
    const ui = await mountWith(async (_prev, data) => {
      seen.push(Object.fromEntries(data.entries()));
      return { ok: true, message: "Erledigt." };
    });
    await act(() => ui.button().click());
    await sleep(30);
    assert.deepEqual(seen, [{ id: "42", status: "done" }]);
    assert.ok(ui.toasts().includes("success: Erledigt."), ui.toasts().join("|"));
    assert.equal(ui.output(), "bereit|ok");
  });

  it("ein Fehler der Aktion kommt als Fehler-Toast (Feldfehler: der erste Text)", async () => {
    const ui = await mountWith(async () => ({ error: "Das hat nicht geklappt." }));
    await act(() => ui.button().click());
    await sleep(30);
    assert.ok(ui.toasts().includes("error: Das hat nicht geklappt."), ui.toasts().join("|"));
  });

  it("ein Netzwerkfehler wird zur Meldung „Keine Verbindung“, nicht zur Fehlerseite", async () => {
    const offline = await mountWith(async () => {
      throw new TypeError("Failed to fetch");
    });
    await act(() => offline.button().click());
    await sleep(30);
    assert.ok(offline.toasts().some((t) => t.startsWith("error: Keine Verbindung")), offline.toasts().join("|"));
  });

  it("während der Antwort ist der Knopf gesperrt", async () => {
    let release: (() => void) | undefined;
    const ui = await mountWith(() => new Promise<State>((resolve) => (release = () => resolve({ ok: true }))));
    await act(() => ui.button().click());
    assert.equal(ui.button().disabled, true);
    assert.match(ui.output() ?? "", /^wartet/);
    await act(() => release?.());
    await sleep(20);
    assert.equal(ui.button().disabled, false);
  });
});
