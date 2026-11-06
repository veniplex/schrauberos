import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { createElement, startTransition, Suspense, use, useState, type ReactNode } from "react";
import { installDom, mount, sleep, act, type MountedView, type TestDom } from "@/test/dom";

/**
 * Echte Wiedergabe mit react-dom/client: Ein Dashboard-Baustein, dessen Daten fehlerhaft ankommen, fällt allein aus; „Erneut versuchen“ muss mit
 * **einem** Klick den Baustein zeigen, sobald die neu geladenen Daten da sind (nicht erst beim zweiten Klick).
 */
type Payload = { ok: boolean; text: string };
type Settled = Promise<Payload> & { status: "fulfilled"; value: Payload };

function settled(value: Payload): Settled {
  return Object.assign(Promise.resolve(value), { status: "fulfilled" as const, value });
}

let dom: TestDom;
let view: MountedView | null = null;
let refreshCalls = 0;

before(async () => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  refreshCalls = 0;
});

/** Stellt eine Seite nach: Die Daten kommen als Versprechen (wie die Antwort von `router.refresh()`), die Seite wartet in einer Transition darauf. */
async function mountPage(next: (refresh: () => void) => Promise<Payload>) {
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { I18nProvider } = await import("@/i18n/client");
  const { default: messages } = await import("@/i18n/messages/de").then((m) => ({ default: m.de }));
  const { WidgetBoundary } = await import("./widget-boundary");

  function Content({ payload }: { payload: Payload }): ReactNode {
    if (!payload.ok) throw new Error("kaputte Daten");
    return createElement("p", null, payload.text);
  }

  function Page() {
    const [data, setData] = useState<Promise<Payload>>(() => settled({ ok: false, text: "" }));
    const payload = use(data);
    // wie bei Next: refresh() läuft selbst in einer Transition und lädt die Seite neu
    const router = {
      refresh: () => {
        refreshCalls++;
        startTransition(() => setData(next(() => {})));
      },
    };
    return createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(I18nProvider, { locale: "de", messages } as never, createElement(WidgetBoundary, null, createElement(Content, { payload }))),
    );
  }

  view = await mount(createElement(Suspense, { fallback: createElement("p", null, "lädt") }, createElement(Page)));
  return view;
}

describe("Fehlergrenze für Dashboard-Bausteine", () => {
  it("ein werfender Baustein zeigt nur den Hinweis mit Knopf, der Rest der Seite bleibt", async () => {
    mock.method(console, "error", () => {});
    const page = await mountPage(async () => ({ ok: true, text: "Daten" }));
    assert.match(page.container.textContent ?? "", /konnte nicht geladen werden/);
    assert.ok([...page.container.querySelectorAll("button")].some((b) => b.textContent === "Erneut versuchen"));
    mock.restoreAll();
  });

  it("„Erneut versuchen“ zeigt den Baustein nach EINEM Klick, sobald die neuen Daten da sind", async () => {
    mock.method(console, "error", () => {});
    const page = await mountPage(
      () =>
        new Promise<Payload>((resolve) => {
          setTimeout(() => resolve({ ok: true, text: "Frische Daten" }), 20);
        }),
    );
    const button = [...page.container.querySelectorAll("button")].find((b) => b.textContent === "Erneut versuchen");
    assert.ok(button);
    await act(() => button.click());
    await sleep(80);
    assert.equal(refreshCalls, 1);
    assert.match(page.container.textContent ?? "", /Frische Daten/);
    assert.doesNotMatch(page.container.textContent ?? "", /konnte nicht geladen werden/);
    mock.restoreAll();
  });

  it("liefern auch die neuen Daten einen Fehler, bleibt der Hinweis stehen (kein Absturz der Seite)", async () => {
    mock.method(console, "error", () => {});
    const page = await mountPage(
      () =>
        new Promise<Payload>((resolve) => {
          setTimeout(() => resolve({ ok: false, text: "" }), 20);
        }),
    );
    const button = [...page.container.querySelectorAll("button")].find((b) => b.textContent === "Erneut versuchen");
    assert.ok(button);
    await act(() => button.click());
    await sleep(80);
    assert.match(page.container.textContent ?? "", /konnte nicht geladen werden/);
    mock.restoreAll();
  });
});
