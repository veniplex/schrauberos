import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, useState, type ReactElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/**
 * Entwurf, Wiederherstellung und Absenden des Formular-Rahmens in einem echten Renderer (react-dom/client + happy-dom): von React **gesteuerte** Felder (auch abhängige wie
 * Netto → Brutto, nachrückende wie das Reserverad, die Kundenauswahl), Lebensdauer des Entwurfs (Fehler / Erfolg / Weiterleitung), Bindung an die Person, Vorbelegung,
 * Enter im Textfeld, Navigationsbremse.
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

type State = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string };
type Action = (prev: State, data: FormData) => Promise<State>;

const DEBOUNCE = 450; // Entprellung des Entwurfs (400 ms) abwarten

function typeNative(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

const failing: Action = async () => ({ fieldErrors: { x: "Fehler" } });

/** Rahmen mit beliebigem Inhalt; `userId` bindet die Entwürfe an eine Person (`DraftScope`) */
async function mountDraft(child: ReactElement, options: { action?: Action; draftKey?: string; userId?: string } = {}) {
  const { Form, FormActions } = await import("./form");
  const { DraftScope } = await import("./draft-scope");
  const form = createElement(
    Form,
    { action: (options.action ?? failing) as never, draftKey: options.draftKey ?? "dep:new" } as never,
    createElement("input", { type: "hidden", name: "version", value: "v1" }),
    child,
    createElement(FormActions, { submitLabel: "Sichern" }),
  );
  view = await mount(await withProviders(options.userId ? createElement(DraftScope as never, { userId: options.userId }, form) : form));
  const root = view.container;
  const input = (name: string) => root.querySelector(`input[name='${name}']`) as HTMLInputElement | null;
  const type = (name: string, value: string) => act(() => typeNative(input(name)!, value));
  const submit = async () => {
    await act(() => (root.querySelector("form") as HTMLFormElement).requestSubmit(root.querySelector("button[type='submit']:last-of-type") as HTMLButtonElement));
    await sleep(60);
  };
  return { root, input, type, submit };
}

/** Betragsfelder mit **veraltetem Zustand in der Rückruffunktion** (der harte Fall): Brutto folgt Netto + MwSt., bis es selbst eingegeben wird */
async function dependentAmounts() {
  const { Input } = await import("./form");
  const total = (a: { net: string; vat: string }) => String(Number(a.net || 0) + Number(a.vat || 0));
  return function Amounts() {
    const [amounts, setAmounts] = useState({ net: "", vat: "", gross: "" });
    const [touched, setTouched] = useState(false);
    const change = (field: "net" | "vat", value: string) => {
      const next = { ...amounts, [field]: value };
      setAmounts(touched ? next : { ...next, gross: total(next) });
    };
    return createElement(
      "div",
      null,
      createElement(Input, { name: "net", value: amounts.net, onChange: (e) => change("net", e.target.value) }),
      createElement(Input, { name: "vat", value: amounts.vat, onChange: (e) => change("vat", e.target.value) }),
      createElement(Input, {
        name: "gross",
        value: amounts.gross,
        onChange: (e) => {
          setTouched(e.target.value !== "");
          setAmounts({ ...amounts, gross: e.target.value });
        },
      }),
    );
  };
}

describe("Entwurf bei von React gesteuerten Feldern", () => {
  it("abhängige gesteuerte Felder (Netto → Brutto) kommen vollständig zurück – auch mit veraltetem Zustand in den Rückrufen", async () => {
    const Amounts = await dependentAmounts();
    let f = await mountDraft(createElement(Amounts));
    await f.type("net", "100");
    await f.type("vat", "19");
    assert.equal(f.input("gross")!.value, "119", "Vorschlag");
    await f.type("gross", "150");
    await sleep(DEBOUNCE);
    await view!.unmount();

    f = await mountDraft(createElement(Amounts));
    assert.deepEqual([f.input("net")!.value, f.input("vat")!.value, f.input("gross")!.value], ["100", "19", "150"]);
    assert.match(f.root.textContent ?? "", /Entwurf wurde wiederhergestellt/);
  });

  it("ein vorgeschlagenes Brutto wird ebenfalls richtig zurückgeschrieben", async () => {
    const Amounts = await dependentAmounts();
    let f = await mountDraft(createElement(Amounts));
    await f.type("net", "200");
    await f.type("vat", "38");
    await sleep(DEBOUNCE);
    await view!.unmount();
    f = await mountDraft(createElement(Amounts));
    assert.deepEqual([f.input("net")!.value, f.input("vat")!.value, f.input("gross")!.value], ["200", "38", "238"]);
  });

  it("nachrückende Felder (Reserverad erscheint erst mit dem Kontrollkästchen) und gesteuerte Kontrollkästchen werden wiederhergestellt", async () => {
    const { Input, Checkbox } = await import("./form");
    function Tires() {
      const [spare, setSpare] = useState(false);
      const [dots, setDots] = useState({ FL: "", SPARE: "" });
      return createElement(
        "div",
        null,
        createElement(Input, { name: "tire.FL.dot", value: dots.FL, onChange: (e) => setDots((d) => ({ ...d, FL: e.target.value })) }),
        createElement(Checkbox, { name: "spare", checked: spare, onChange: (e) => setSpare(e.target.checked), label: "Reserverad" }),
        spare ? createElement(Input, { name: "tire.SPARE.dot", value: dots.SPARE, onChange: (e) => setDots((d) => ({ ...d, SPARE: e.target.value })) }) : null,
      );
    }
    let f = await mountDraft(createElement(Tires));
    await f.type("tire.FL.dot", "2321");
    await act(() => f.input("spare")!.click());
    await f.type("tire.SPARE.dot", "1119");
    await sleep(DEBOUNCE);
    await view!.unmount();

    console.log("DRAFT", sessionStorage.getItem("so_draft:anon:dep:new"));
    f = await mountDraft(createElement(Tires));
    assert.equal(f.input("tire.FL.dot")!.value, "2321");
    assert.equal(f.input("spare")!.checked, true);
    assert.equal(f.input("tire.SPARE.dot")?.value, "1119", "das nachrückende Feld hat seinen Wert");
  });

  it("die Auswahl einer Suchauswahl (Kunde) wird mit ihrer Beschriftung gesichert und wiederhergestellt – und eine entfernte Vorbelegung bleibt entfernt", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [{ id: "c1", label: "Meier", sublabel: "Stuttgart" }] }) })) as never;
    try {
      const { SearchCombobox } = await import("./search-combobox");
      const { Field, Input } = await import("./form");
      const picker = (initial: unknown = null) =>
        createElement(
          "div",
          null,
          createElement(Input, { name: "note", defaultValue: "" }),
          createElement(Field as never, { label: "Kunde", name: "customerId" }, createElement(SearchCombobox as never, { endpoint: "/api/x", name: "customerId", placeholder: "Suchen …", initial })),
        );
      let f = await mountDraft(picker());
      await act(() => {
        const box = f.root.querySelector("input[role='combobox']") as HTMLInputElement;
        box.focus();
        typeNative(box, "mei");
      });
      await sleep(260);
      await act(() => (f.root.querySelector("[role='option']") as HTMLElement).click());
      assert.equal(f.input("customerId")!.value, "c1");
      await f.type("note", "x");
      await sleep(DEBOUNCE);
      await view!.unmount();

      f = await mountDraft(picker());
      assert.equal(f.input("customerId")?.value, "c1", "Auswahl wiederhergestellt");
      assert.match(f.root.textContent ?? "", /Meier/);
      assert.match(f.root.textContent ?? "", /Stuttgart/);
      await view!.unmount();

      const initial = { id: "c9", label: "Schulz" };
      sessionStorage.clear();
      f = await mountDraft(picker(initial));
      await act(() => (f.root.querySelector("button[aria-label^='Entfernen']") as HTMLButtonElement).click());
      await f.type("note", "y");
      await sleep(DEBOUNCE);
      await view!.unmount();
      f = await mountDraft(picker(initial));
      assert.equal(f.input("customerId"), null, "die Vorbelegung bleibt entfernt");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Entwurf: Lebensdauer", () => {
  const draftKey = "so_draft:anon:dep:new";
  const plain = async () => {
    const { Input } = await import("./form");
    return createElement(Input, { name: "title", defaultValue: "" });
  };

  it("ein Fehler und „Keine Verbindung“ lassen den Entwurf stehen; erst der Erfolg löscht ihn", async () => {
    let mode: "error" | "network" | "ok" = "error";
    const action: Action = async () => {
      if (mode === "network") throw new TypeError("Failed to fetch");
      return mode === "ok" ? { ok: true } : { fieldErrors: { title: "Pflichtfeld." } };
    };
    const f = await mountDraft(await plain(), { action });
    await f.type("title", "Wichtig");
    await sleep(DEBOUNCE);
    await f.submit();
    assert.ok(sessionStorage.getItem(draftKey), "Fehler: Entwurf bleibt");
    assert.equal(f.input("title")!.value, "Wichtig");
    mode = "network";
    await f.submit();
    assert.ok(sessionStorage.getItem(draftKey), "Netzwerkfehler: Entwurf bleibt");
    mode = "ok";
    await f.submit();
    assert.equal(sessionStorage.getItem(draftKey), null, "Erfolg: Entwurf gelöscht");
  });

  it("verschwindet das Formular mitten im Absenden (Weiterleitung nach dem Speichern), ist der Entwurf erledigt", async () => {
    const f = await mountDraft(await plain(), { action: () => new Promise(() => {}) });
    await f.type("title", "Wichtig");
    await sleep(DEBOUNCE);
    assert.ok(sessionStorage.getItem(draftKey));
    await act(() => (f.root.querySelector("form") as HTMLFormElement).requestSubmit(f.root.querySelector("button[type='submit']:last-of-type") as HTMLButtonElement));
    await view!.unmount();
    view = null;
    assert.equal(sessionStorage.getItem(draftKey), null);
  });

  it("was während des Absendens getippt wird, geht bei einem Fehler nicht verloren", async () => {
    let release: () => void = () => {};
    const action: Action = () => new Promise((resolve) => (release = () => resolve({ fieldErrors: { title: "Pflichtfeld." } })));
    const f = await mountDraft(await plain(), { action });
    await f.type("title", "Alt");
    await act(() => (f.root.querySelector("form") as HTMLFormElement).requestSubmit(f.root.querySelector("button[type='submit']:last-of-type") as HTMLButtonElement));
    await f.type("title", "Alt und neu");
    await act(() => release());
    await sleep(40);
    assert.equal(f.input("title")!.value, "Alt und neu");
  });

  it("Entwürfe gehören einer Person: ein anderer Benutzer sieht sie nicht, sie werden verworfen; derselbe Benutzer bekommt sie zurück", async () => {
    let f = await mountDraft(await plain(), { userId: "u1" });
    await f.type("title", "Meins");
    await sleep(DEBOUNCE);
    assert.ok(sessionStorage.getItem("so_draft:u1:dep:new"));
    await view!.unmount();

    f = await mountDraft(await plain(), { userId: "u1" });
    assert.equal(f.input("title")!.value, "Meins");
    await view!.unmount();

    f = await mountDraft(await plain(), { userId: "u2" });
    assert.equal(f.input("title")!.value, "", "fremder Entwurf nicht angezeigt");
    assert.equal(sessionStorage.getItem("so_draft:u1:dep:new"), null, "und verworfen");
  });

  it("ein Entwurf passt nur zur selben Vorbelegung (z. B. anderes Datum aus der Adresse)", async () => {
    const { Input } = await import("./form");
    const withDefault = (value: string) => createElement(Input, { name: "date", defaultValue: value });
    let f = await mountDraft(withDefault("2026-05-01"));
    await f.type("date", "2026-06-30");
    await sleep(DEBOUNCE);
    await view!.unmount();

    f = await mountDraft(withDefault("2026-05-02"));
    assert.equal(f.input("date")!.value, "2026-05-02", "die neue Vorbelegung gewinnt");
    assert.doesNotMatch(f.root.textContent ?? "", /Entwurf wurde wiederhergestellt/);
    await view!.unmount();

    f = await mountDraft(withDefault("2026-05-01"));
    assert.equal(f.input("date")!.value, "2026-06-30", "zur gleichen Vorbelegung passt der Entwurf");
  });

  it("Verwerfen stellt auch gesteuerte Felder auf den Ausgangswert zurück", async () => {
    const Amounts = await dependentAmounts();
    let f = await mountDraft(createElement(Amounts));
    await f.type("net", "100");
    await sleep(DEBOUNCE);
    await view!.unmount();
    f = await mountDraft(createElement(Amounts));
    assert.equal(f.input("net")!.value, "100");
    await act(() => void [...f.root.querySelectorAll("button")].find((b) => /Entwurf verwerfen/.test(b.textContent ?? ""))!.click());
    assert.deepEqual([f.input("net")!.value, f.input("gross")!.value], ["", ""]);
    assert.equal(sessionStorage.getItem(draftKey), null);
  });
});

describe("FormActions: Enter im Textfeld", () => {
  it("der erste Absende-Knopf im Dokument ist die Hauptaktion (kein `_next`): Enter löst nicht „Speichern und weiter“ aus", async () => {
    const { Form, FormActions } = await import("./form");
    const sent: FormData[] = [];
    view = await mount(
      await withProviders(
        createElement(
          Form,
          {
            action: (async (_p: unknown, data: FormData) => {
              sent.push(data);
              return { ok: true };
            }) as never,
          },
          createElement("input", { name: "lastName", defaultValue: "Meier" }),
          createElement(FormActions, { submitLabel: "Sichern", secondaryLabel: "Sichern und weiter" }),
        ),
      ),
    );
    const form = view.container.querySelector("form") as HTMLFormElement;
    const submitters = [...form.querySelectorAll<HTMLButtonElement>("button[type='submit']")];
    assert.equal(submitters.length, 3, "Standard-Absender, „weiter“, Hauptaktion");
    assert.equal(submitters[0].name, "", "der erste (Standard bei Enter) trägt kein _next");
    assert.equal(submitters[0].getAttribute("tabindex"), "-1");
    assert.equal(submitters[0].getAttribute("aria-hidden"), "true");
    assert.equal(submitters[1].name, "_next");
    await act(() => form.requestSubmit(submitters[0]));
    await sleep(30);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].get("_next"), null);
    assert.equal(sent[0].get("lastName"), "Meier");
    await act(() => form.requestSubmit(submitters[1]));
    await sleep(30);
    assert.equal(sent[1].get("_next"), "1", "der sichtbare Knopf „weiter“ sendet weiter _next");
  });

  it("ohne zweite Aktion kein zusätzlicher Absende-Knopf", async () => {
    const { Form, FormActions } = await import("./form");
    view = await mount(await withProviders(createElement(Form, { action: failing as never }, createElement(FormActions, { submitLabel: "Sichern" }))));
    assert.equal(view.container.querySelectorAll("button[type='submit']").length, 1);
  });
});

describe("Navigationsbremse (warnOnLeave)", () => {
  async function mountGuard() {
    const { Form } = await import("./form");
    const pushed: string[] = [];
    view = await mount(
      await withRouter(
        await withProviders(
          createElement(
            Form,
            { action: failing as never, warnOnLeave: true } as never,
            createElement("input", { name: "title", defaultValue: "" }),
            createElement("a", { href: "/anderswo" }, "Weg hier"),
            createElement("a", { href: "/anderswo", target: "_blank" }, "Neuer Tab"),
          ),
        ),
        { pushed },
      ),
    );
    const root = view.container;
    // happy-dom folgt einem Link, dessen Klick nicht abgebrochen wurde (Seitenwechsel): hier nicht – die Bremse prüft vorher, in der Aufnahmephase
    root.addEventListener("click", (event) => event.preventDefault());
    const click = (link: string, init: MouseEventInit = {}) =>
      act(() => void [...root.querySelectorAll("a")].find((a) => a.textContent === link)!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })));
    const inDialog = (label: string) => [...root.querySelectorAll("dialog button")].find((b) => b.textContent === label) as HTMLButtonElement;
    return { root, pushed, click, inDialog };
  }

  it("ohne Eingabe läuft der Link durch; mit ungespeicherter Eingabe fragt die Rückfrage, „Weiter bearbeiten“ bleibt, „Verwerfen“ geht", async () => {
    const g = await mountGuard();
    await g.click("Weg hier");
    assert.equal(g.root.querySelector("dialog"), null, "nichts geändert: keine Rückfrage");

    await act(() => typeNative(g.root.querySelector("input[name='title']") as HTMLInputElement, "halb fertig"));
    await g.click("Weg hier");
    assert.ok(g.root.querySelector("dialog")?.open, "Rückfrage");
    assert.deepEqual(g.pushed, [], "noch nicht gegangen");

    await act(() => void g.inDialog("Weiter bearbeiten").click());
    assert.equal(g.root.querySelector("dialog"), null);
    assert.deepEqual(g.pushed, []);

    await g.click("Weg hier");
    await act(() => void g.inDialog("Verwerfen").click());
    assert.deepEqual(g.pushed, ["/anderswo"]);
  });

  it("Zusatztasten und neue Tabs bleiben unberührt", async () => {
    const g = await mountGuard();
    await act(() => typeNative(g.root.querySelector("input[name='title']") as HTMLInputElement, "x"));
    await g.click("Weg hier", { ctrlKey: true });
    await g.click("Neuer Tab");
    assert.equal(g.root.querySelector("dialog"), null);
  });
});

describe("isNetworkError", () => {
  it("nur echte Netzwerkfehler: fetch-Meldungen der Browser ja, Programmierfehler (TypeError) nein", async () => {
    const { isNetworkError } = await import("./form-frame");
    assert.equal(isNetworkError(new TypeError("Failed to fetch")), true, "Chrome");
    assert.equal(isNetworkError(new TypeError("NetworkError when attempting to fetch resource.")), true, "Firefox");
    assert.equal(isNetworkError(new TypeError("Load failed")), true, "Safari");
    assert.equal(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')")), false);
    assert.equal(isNetworkError(new Error("Failed to fetch")), false, "kein TypeError");
  });
});
