import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * Formular-Rahmen in einem echten Renderer (react-dom/client + happy-dom): Die Eingabe bleibt bei Fehlern erhalten (React setzt Formulare nach jeder Aktion zurück),
 * die Fehlerzusammenfassung nennt die Felder, ein Netzwerkfehler ist ein Zustand statt einer Fehlerseite, der Entwurf lebt in `sessionStorage` und nie mit Passwörtern.
 */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
  dom = installDom();
  // happy-dom: kein sessionStorage-Verhalten voraussetzen, der Test bringt seinen eigenen mit
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

type Action = (prev: { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string }, data: FormData) => Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string }>;

async function mountForm(action: Action, props: Record<string, unknown> = {}) {
  const { Form, FormActions, Field, Input } = await import("./form");
  view = await mount(
    await withProviders(
      createElement(
        Form,
        { action, ...props } as never,
        createElement("input", { type: "hidden", name: "version", value: "v1" }),
        createElement(Field as never, { label: "Nachname", name: "lastName", required: true }, createElement(Input, { name: "lastName", defaultValue: "" })),
        createElement(Field as never, { label: "E-Mail", name: "email" }, createElement(Input, { name: "email", type: "email", defaultValue: "" })),
        createElement(Field as never, { label: "Passwort", name: "password" }, createElement(Input, { name: "password", type: "password", defaultValue: "" })),
        createElement(FormActions, { submitLabel: "Sichern" }),
      ),
    ),
  );
  const root = view.container;
  const input = (name: string) => root.querySelector(`input[name='${name}']`) as HTMLInputElement;
  const type = async (name: string, value: string) =>
    act(() => {
      input(name).value = value;
      input(name).dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  const submit = async () => {
    await act(() => (root.querySelector("form") as HTMLFormElement).requestSubmit(root.querySelector("button[type='submit']:last-of-type") as HTMLButtonElement));
    // warten, bis die Aktion durch ist (der Absende-Knopf ist während der Aktion `aria-busy`)
    for (let i = 0; i < 50; i++) {
      await sleep(20);
      if (!root.querySelector("[aria-busy]")) break;
    }
    await sleep(20);
  };
  return { root, input, type, submit };
}

describe("Form", () => {
  it("Fehler: die eingegebenen Werte bleiben (nicht das Passwort), die Zusammenfassung nennt das Feld mit Beschriftung, das Feld ist beschrieben und als ungültig markiert", async () => {
    const f = await mountForm(async () => ({ fieldErrors: { email: "Bitte eine gültige E-Mail-Adresse eingeben." } }));
    await f.type("lastName", "Meier");
    await f.type("email", "kaputt");
    await f.type("password", "geheim123");
    await f.submit();
    assert.equal(f.input("lastName").value, "Meier");
    assert.equal(f.input("email").value, "kaputt");
    assert.equal(f.input("password").value, "", "Passwörter werden nie wiederhergestellt");
    const summary = f.root.querySelector("[data-form-errors]");
    assert.ok(summary, "Fehlerzusammenfassung");
    assert.match(summary.textContent ?? "", /Bitte prüfe diese Angabe/);
    assert.match(summary.textContent ?? "", /E-Mail: Bitte eine gültige E-Mail-Adresse/);
    assert.equal(document.activeElement, summary, "Fokus auf der Zusammenfassung");
    const email = f.input("email");
    assert.equal(email.getAttribute("aria-invalid"), "true");
    const describedBy = email.getAttribute("aria-describedby") ?? "";
    assert.ok(describedBy && f.root.querySelector(`[id='${describedBy}']`)?.textContent?.includes("gültige E-Mail"));
    assert.equal(f.root.querySelector("[name='lastName']")?.getAttribute("aria-required"), "true");
  });

  it("ein Klick auf den Eintrag der Zusammenfassung springt ins Feld", async () => {
    const f = await mountForm(async () => ({ fieldErrors: { lastName: "Pflichtfeld." } }));
    await f.submit();
    await act(() => (f.root.querySelector("[data-form-errors] button") as HTMLButtonElement).click());
    assert.equal(document.activeElement, f.input("lastName"));
  });

  it("Erfolg mit Meldung: Toast statt Inline-Text; das Formular wird wie bei React üblich zurückgesetzt", async () => {
    const f = await mountForm(async () => ({ ok: true, message: "Gespeichert." }));
    await f.type("lastName", "Meier");
    await f.submit();
    assert.match(document.querySelector("[data-flash='success']")?.textContent ?? "", /Gespeichert\./);
    assert.equal(f.input("lastName").value, "");
  });

  it("Netzwerkfehler: eigener Zustand „Keine Verbindung“, Eingabe bleibt, erneut absenden geht", async () => {
    let calls = 0;
    const f = await mountForm(async () => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { ok: true };
    });
    await f.type("lastName", "Meier");
    await f.submit();
    assert.match(f.root.textContent ?? "", /Keine Verbindung zum Server/);
    assert.equal(f.input("lastName").value, "Meier");
    assert.equal(f.root.querySelector("[data-form-errors]"), null);
    await f.submit();
    assert.equal(calls, 2);
    assert.doesNotMatch(f.root.textContent ?? "", /Keine Verbindung zum Server/);
  });

  it("Entwurf: wird beim Tippen gemerkt (ohne Passwort und ohne data-no-draft), beim Öffnen wiederhergestellt, nach dem Absenden gelöscht", async () => {
    const action: Action = async () => ({ fieldErrors: { lastName: "Pflichtfeld." } });
    let f = await mountForm(action, { draftKey: "customer:new" });
    await f.type("lastName", "Meier");
    await f.type("password", "geheim123");
    mock.timers.enable({ apis: ["setTimeout"] });
    await f.type("email", "a@b.de");
    await act(() => mock.timers.tick(500));
    mock.timers.reset();
    const stored = JSON.parse(sessionStorage.getItem("so_draft:customer:new") ?? "null") as { entries: Array<{ name: string; value: string }> };
    assert.deepEqual(stored.entries.map((e) => e.name).sort(), ["email", "lastName"]);
    await view!.unmount();

    f = await mountForm(action, { draftKey: "customer:new" });
    assert.equal(f.input("lastName").value, "Meier", "Entwurf wiederhergestellt");
    assert.equal(f.input("password").value, "");
    assert.match(f.root.textContent ?? "", /Entwurf wurde wiederhergestellt/);

    // Verwerfen löscht den Entwurf und setzt zurück
    await act(() => void [...f.root.querySelectorAll("button")].find((b) => /Entwurf verwerfen/.test(b.textContent ?? ""))!.click());
    assert.equal(sessionStorage.getItem("so_draft:customer:new"), null);
    assert.equal(f.input("lastName").value, "");
  });

  it("clearFormDrafts löscht alle Entwürfe (Abmelden)", async () => {
    const { clearFormDrafts } = await import("./form");
    sessionStorage.setItem("so_draft:a", "{}");
    sessionStorage.setItem("so_draft:b", "{}");
    sessionStorage.setItem("anderes", "x");
    clearFormDrafts();
    assert.equal(sessionStorage.getItem("so_draft:a"), null);
    assert.equal(sessionStorage.getItem("so_draft:b"), null);
    assert.equal(sessionStorage.getItem("anderes"), "x");
  });
});

describe("Field", () => {
  it("verbindet Beschriftung, Eingabe, Hinweis und Fehler; Fehler und Hinweis stehen nebeneinander; Pflichtfeld wird einheitlich markiert", async () => {
    const { Field, Input } = await import("./form");
    view = await mount(
      await withProviders(createElement(Field as never, { label: "FIN", error: "Zu kurz.", hint: "17 Zeichen", required: true }, createElement(Input, { name: "vin" }))),
    );
    const input = view.container.querySelector("input")!;
    const label = view.container.querySelector("label")!;
    assert.equal(label.htmlFor, input.id, "Beschriftung zeigt auf die Eingabe (automatische Id)");
    assert.ok(input.id);
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => view!.container.querySelector(`[id='${id}']`)?.textContent);
    assert.deepEqual(described, ["Zu kurz.", "17 Zeichen"]);
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(input.getAttribute("aria-required"), "true");
    assert.ok(label.querySelector(".required-mark"));
    assert.equal(view.container.querySelector("[role='alert']")?.textContent, "Zu kurz.", "außerhalb eines Formulars sagt der Fehler sich selbst an");
  });

  it("Gruppe: fieldset mit legend, Beschreibung an der Gruppe", async () => {
    const { Field, Checkbox } = await import("./form");
    view = await mount(await withProviders(createElement(Field as never, { label: "Rollen", group: true, hint: "Mehrere möglich" }, createElement(Checkbox, { label: "A", name: "a" }))));
    const set = view.container.querySelector("fieldset")!;
    assert.equal(set.querySelector("legend")?.textContent, "Rollen");
    assert.ok(set.getAttribute("aria-describedby"));
  });
});

describe("FileInput", () => {
  it("lehnt eine zu große Datei vor dem Absenden ab, leert das Feld und nennt die Grenze", async () => {
    const { FileInput } = await import("./form");
    view = await mount(await withProviders(createElement(FileInput, { name: "file", maxBytes: 2 * 1024 * 1024 })));
    const input = view.container.querySelector("input[type='file']") as HTMLInputElement;
    const big = new File(["x".repeat(3 * 1024 * 1024)], "gross.pdf");
    Object.defineProperty(input, "files", { configurable: true, value: [big] });
    await act(() => void input.dispatchEvent(new window.Event("change", { bubbles: true })));
    assert.match(view.container.textContent ?? "", /Datei zu groß \(max\. 2 MB\)/);
    assert.equal(input.getAttribute("aria-invalid"), "true");
  });
});
