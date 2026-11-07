import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { installFakes } from "@/test/harness";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * Registrierung und Hinweis „Neue Version“ (P3-5) in einem echten Renderer: Der Service Worker des Browsers ist nachgebaut, die Meldung kommt über den Toast der Anwendung.
 * Die Logik der Registrierung selbst: `lib/sw-client.test.ts`; der Service Worker: `lib/sw.test.ts`.
 */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
  installFakes();
  dom = installDom();
  Object.defineProperty(dom.window, "isSecureContext", { value: true, configurable: true });
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

function installContainer(options: { waiting: boolean }) {
  const worker = { state: "installed", messages: [] as unknown[], postMessage(m: unknown) { this.messages.push(m); }, addEventListener() {} };
  const registered: string[] = [];
  const changes: Array<() => void> = [];
  const container = {
    controller: { postMessage() {} },
    register: async (url: string) => {
      registered.push(url);
      return { waiting: options.waiting ? worker : null, installing: null, addEventListener() {} };
    },
    ready: new Promise(() => {}),
    addEventListener: (_type: string, listener: () => void) => void changes.push(listener),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  return { worker, registered, changes };
}

async function show(element: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, element)));
  await sleep(20);
  return view.container;
}

describe("ServiceWorkerRegistrar", () => {
  it("im Betrieb: registriert mit der Version; ein wartender Service Worker zeigt „Neue Version – Neu laden“, der Knopf aktiviert ihn", async () => {
    const sw = installContainer({ waiting: true });
    const { ServiceWorkerRegistrar } = await import("./service-worker-registrar");
    const root = await show(createElement(ServiceWorkerRegistrar, { version: "1.2.3+abc", production: true }));
    assert.deepEqual(sw.registered, ["/sw.js?v=1.2.3%2Babc"]);
    const toast = root.querySelector('[data-flash="info"]');
    assert.ok(toast, "Hinweis erscheint");
    assert.match(toast.textContent ?? "", /Neue Version verfügbar/);
    const button = [...toast.querySelectorAll("button")].find((b) => b.textContent === "Neu laden") as HTMLButtonElement;
    assert.ok(button);
    await act(() => button.click());
    assert.deepEqual(sw.worker.messages, [{ type: "SKIP_WAITING" }]);
    assert.equal(sw.changes.length, 1, "wartet auf die Übernahme (dann Neuladen)");
  });

  it("ohne wartenden Service Worker kein Hinweis", async () => {
    installContainer({ waiting: false });
    const { ServiceWorkerRegistrar } = await import("./service-worker-registrar");
    const root = await show(createElement(ServiceWorkerRegistrar, { version: "1", production: true }));
    assert.equal(root.querySelector("[data-flash]"), null);
  });

  it("in der Entwicklung wird nichts registriert", async () => {
    const sw = installContainer({ waiting: true });
    const { ServiceWorkerRegistrar } = await import("./service-worker-registrar");
    const root = await show(createElement(ServiceWorkerRegistrar, { version: "1", production: false }));
    assert.deepEqual(sw.registered, []);
    assert.equal(root.querySelector("[data-flash]"), null);
  });
});
