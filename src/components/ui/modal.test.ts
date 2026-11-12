import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/**
 * Fenster mit Zustand in der Adresse (`UrlModal`): schließt per Escape/Hintergrund/Knopf; mit ungespeicherten Eingaben fragt es „Änderungen verwerfen?“ – „Verwerfen“ löscht
 * auch den Entwurf der Formulare darin (sonst käme die verworfene Eingabe beim nächsten Öffnen zurück), „Weiter bearbeiten“ bleibt; beim Entfernen geht der Fokus an den Auslöser.
 */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
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
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  sessionStorage.clear();
});

async function withProviders(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("./toast");
  const { de } = await import("@/i18n/messages/de");
  return createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, child));
}

async function mountModal() {
  const { UrlModal } = await import("./modal");
  const { Form, Input } = await import("./form");
  const pushed: string[] = [];
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const modal = createElement(
    UrlModal as never,
    { title: "Termin", closeHref: "/appointments" },
    createElement(Form, { action: (async () => ({})) as never, draftKey: "appointment:new" } as never, createElement("input", { type: "hidden", name: "version", value: "v1" }), createElement(Input, { name: "title", defaultValue: "" })),
  );
  view = await mount(await withRouter(await withProviders(modal), { pushed }));
  const root = view.container;
  const type = (value: string) =>
    act(() => {
      const field = root.querySelector("input[name='title']") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  const dialogs = () => [...root.querySelectorAll("dialog")];
  const cancel = () => act(() => void dialogs()[0].dispatchEvent(new window.Event("cancel", { cancelable: true })));
  const inConfirm = (label: string) => [...(dialogs()[1]?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label) as HTMLButtonElement;
  return { root, pushed, type, dialogs, cancel, inConfirm, opener };
}

describe("UrlModal", () => {
  it("ohne Eingabe schließt Escape sofort (Navigation zum Ziel), ohne Rückfrage", async () => {
    const m = await mountModal();
    await m.cancel();
    assert.deepEqual(m.pushed, ["/appointments"]);
    assert.equal(m.dialogs().length, 1, "keine Rückfrage");
    m.opener.remove();
  });

  it("mit Eingabe fragt Escape nach; „Weiter bearbeiten“ bleibt, „Verwerfen“ geht und löscht den Entwurf", async () => {
    const m = await mountModal();
    await m.type("Halb fertig");
    await sleep(450); // Entwurf wird geschrieben
    assert.ok(sessionStorage.getItem("so_draft:anon:appointment:new"), "Entwurf liegt vor");

    await m.cancel();
    assert.equal(m.dialogs().length, 2, "Rückfrage „Änderungen verwerfen?“");
    assert.deepEqual(m.pushed, []);
    await act(() => m.inConfirm("Weiter bearbeiten").click());
    assert.equal(m.dialogs().length, 1);
    assert.deepEqual(m.pushed, []);
    assert.ok(sessionStorage.getItem("so_draft:anon:appointment:new"), "der Entwurf bleibt beim Weiterbearbeiten");

    await m.cancel();
    await act(() => m.inConfirm("Verwerfen").click());
    assert.deepEqual(m.pushed, ["/appointments"]);
    assert.equal(sessionStorage.getItem("so_draft:anon:appointment:new"), null, "verworfen heißt auch: kein Entwurf mehr");
    m.opener.remove();
  });

  it("ein Klick auf den Hintergrund schließt nur, wenn das Drücken dort begann", async () => {
    const m = await mountModal();
    const dialog = m.dialogs()[0];
    await act(() => void dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.deepEqual(m.pushed, [], "Loslassen auf dem Hintergrund nach Markieren im Fenster: nichts");
    await act(() => void dialog.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
    await act(() => void dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.deepEqual(m.pushed, ["/appointments"]);
    m.opener.remove();
  });

  it("ist der Auslöser nach dem Schließen ein neuer Knoten (Seite neu aufgebaut), findet der Fokus ihn über das Ziel; ohne Auslöser landet er auf der Hauptüberschrift, nie auf body", async () => {
    const { UrlModal } = await import("./modal");
    const main = document.createElement("main");
    main.innerHTML = '<h1>Termine</h1><a id="old" href="/appointments?edit=7">Inspektion</a>';
    document.body.append(main);
    (main.querySelector("a") as HTMLElement).focus();
    view = await mount(await withRouter(await withProviders(createElement(UrlModal as never, { title: "Termin", closeHref: "/appointments" }, createElement("p", null, "Inhalt"))), { pushed: [] }));
    // die Seite baut sich neu auf: gleicher Link, neuer Knoten
    main.querySelector("a")!.remove();
    const again = document.createElement("a");
    again.setAttribute("href", "/appointments?edit=7");
    again.textContent = "Inspektion";
    main.append(again);
    (document.activeElement as HTMLElement | null)?.blur();
    await view.unmount();
    view = null;
    assert.ok(document.activeElement === again, "Fokus beim neuen Link mit gleichem Ziel");

    // zweiter Durchgang: der Auslöser ist verschwunden und nichts Gleiches da
    main.querySelector("a")!.focus();
    view = await mount(await withRouter(await withProviders(createElement(UrlModal as never, { title: "Termin", closeHref: "/appointments" }, createElement("p", null, "Inhalt"))), { pushed: [] }));
    main.querySelector("a")!.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    await view.unmount();
    view = null;
    assert.ok(document.activeElement === main.querySelector("h1"), "Hauptüberschrift statt body");
    main.remove();
  });

  it("beim Entfernen des Fensters geht der Fokus an den Auslöser zurück", async () => {
    const m = await mountModal();
    (document.activeElement as HTMLElement | null)?.blur();
    await view!.unmount();
    view = null;
    assert.ok(document.activeElement === m.opener, "Fokus beim Auslöser");
    m.opener.remove();
  });
});
