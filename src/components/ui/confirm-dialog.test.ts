import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";

/**
 * Rückfrage vor Aktionen (ConfirmDialog, ConfirmSubmitButton) und Schalter mit Rückfrage (SubmitSwitch) in einem echten Renderer:
 * Der Klick sendet nichts ab, der Dialog benennt die Aktion, erst die Bestätigung sendet das Formular; „Abbrechen“ und Escape schließen ohne Wirkung;
 * bei Tipp-Bestätigung ist die Bestätigung gesperrt, bis das Wort stimmt, und Enter im Feld sendet das umgebende Formular nicht.
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

async function withProviders(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("./toast");
  const { de } = await import("@/i18n/messages/de");
  return createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, child));
}

async function mountDelete(props: Record<string, unknown> = {}) {
  const { Form } = await import("./form");
  const { ConfirmSubmitButton } = await import("./confirm-dialog");
  const submitted: FormData[] = [];
  const action = async (_prev: unknown, data: FormData) => {
    submitted.push(data);
    return { ok: true };
  };
  view = await mount(
    await withProviders(
      createElement(
        Form,
        { action: action as never },
        createElement("input", { type: "hidden", name: "id", value: "42" }),
        createElement(ConfirmSubmitButton as never, { message: "Der Kunde und seine Notizen werden gelöscht.", ...props }, "Kunde löschen"),
      ),
    ),
  );
  const root = view.container;
  const trigger = () => [...root.querySelectorAll("button")].find((b) => b.textContent?.includes("Kunde löschen") && !b.closest("dialog")) as HTMLButtonElement;
  const dialog = () => root.querySelector("dialog") as HTMLDialogElement | null;
  const inDialog = (label: RegExp) => [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement;
  return { root, trigger, dialog, inDialog, submitted };
}

describe("ConfirmSubmitButton", () => {
  it("der Klick öffnet die Rückfrage (benennt die Aktion, erklärt die Folgen) und sendet noch nichts", async () => {
    const c = await mountDelete();
    assert.equal(c.dialog(), null);
    await act(() => c.trigger().click());
    assert.ok(c.dialog()?.open, "modaler Dialog offen");
    assert.equal(c.dialog()?.querySelector("h2")?.textContent, "Kunde löschen?");
    assert.match(c.dialog()?.textContent ?? "", /Der Kunde und seine Notizen werden gelöscht\./);
    assert.equal(c.submitted.length, 0);
  });

  it("Abbrechen schließt ohne Wirkung; die Bestätigung sendet das Formular mit seinen Feldern ab", async () => {
    const c = await mountDelete();
    await act(() => c.trigger().click());
    await act(() => c.inDialog(/^Abbrechen$/).click());
    assert.equal(c.dialog(), null);
    assert.equal(c.submitted.length, 0);

    await act(() => c.trigger().click());
    await act(() => c.inDialog(/^Kunde löschen$/).click());
    await sleep(20);
    assert.equal(c.submitted.length, 1);
    assert.equal(c.submitted[0].get("id"), "42");
    assert.equal(c.dialog(), null);
  });

  it("Escape (cancel-Ereignis des Dialogs) schließt, ohne etwas abzusenden", async () => {
    const c = await mountDelete();
    await act(() => c.trigger().click());
    await act(() => void c.dialog()!.dispatchEvent(new window.Event("cancel", { cancelable: true })));
    assert.equal(c.dialog(), null);
    assert.equal(c.submitted.length, 0);
  });

  it("Tipp-Bestätigung: gesperrt, bis das Wort stimmt (Groß-/Kleinschreibung egal); Enter im Feld sendet nicht das umgebende Formular", async () => {
    const c = await mountDelete({ typeToConfirm: "wiederherstellen" });
    await act(() => c.trigger().click());
    const confirm = c.inDialog(/^Kunde löschen$/);
    assert.equal(confirm.disabled, true);
    const field = c.dialog()!.querySelector("input") as HTMLInputElement;
    const type = async (value: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(field, value);
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    await type("wieder");
    assert.equal(c.inDialog(/^Kunde löschen$/).disabled, true);
    await act(() => void field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await sleep(20);
    assert.equal(c.submitted.length, 0, "Enter mit falschem Wort tut nichts");
    await type("WIEDERHERSTELLEN");
    assert.equal(c.inDialog(/^Kunde löschen$/).disabled, false);
  });
});

describe("ConfirmSubmitButton: Fokus, Tipp-Bestätigung, Hintergrund, Name", () => {
  const typeInto = (field: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

  it("nach Abbrechen und nach Escape steht der Fokus wieder auf dem Auslöser (WCAG 2.4.3)", async () => {
    const c = await mountDelete();
    c.trigger().focus();
    await act(() => c.trigger().click());
    await act(() => c.inDialog(/^Abbrechen$/).click());
    assert.equal(c.dialog(), null);
    assert.ok(document.activeElement === c.trigger(), "Fokus nach Abbrechen auf dem Auslöser");

    c.trigger().focus();
    await act(() => c.trigger().click());
    await act(() => void c.dialog()!.dispatchEvent(new window.Event("cancel", { cancelable: true })));
    assert.ok(document.activeElement === c.trigger(), "Fokus nach Escape auf dem Auslöser");
  });

  it("Tipp-Bestätigung: das richtige Wort gibt frei und sendet; nach Abbrechen und erneutem Öffnen ist wieder alles gesperrt und das Feld leer", async () => {
    const c = await mountDelete({ typeToConfirm: "wiederherstellen" });
    await act(() => c.trigger().click());
    await typeInto(c.dialog()!.querySelector("input") as HTMLInputElement, "Wiederherstellen");
    assert.equal(c.inDialog(/^Kunde löschen$/).disabled, false, "freigegeben");
    await act(() => c.inDialog(/^Abbrechen$/).click());

    await act(() => c.trigger().click());
    assert.equal((c.dialog()!.querySelector("input") as HTMLInputElement).value, "", "frisch geöffnet: Feld leer");
    assert.equal(c.inDialog(/^Kunde löschen$/).disabled, true, "frisch geöffnet: gesperrt");
    assert.equal(c.submitted.length, 0);

    await typeInto(c.dialog()!.querySelector("input") as HTMLInputElement, "wiederherstellen");
    await act(() => c.inDialog(/^Kunde löschen$/).click());
    await sleep(20);
    assert.equal(c.submitted.length, 1, "positiver Pfad: das Formular wurde abgesendet");
  });

  it("Enter mit dem richtigen Wort bestätigt, ohne das Formular zweimal abzusenden", async () => {
    const c = await mountDelete({ typeToConfirm: "löschen" });
    await act(() => c.trigger().click());
    const field = c.dialog()!.querySelector("input") as HTMLInputElement;
    await typeInto(field, "LÖSCHEN");
    await act(() => void field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await sleep(20);
    assert.equal(c.submitted.length, 1);
  });

  it("ein Klick auf den Hintergrund schließt nur, wenn auch das Drücken dort begann (Text markieren und außerhalb loslassen schließt nicht)", async () => {
    const c = await mountDelete();
    await act(() => c.trigger().click());
    const dialog = c.dialog()!;
    await act(() => void dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.ok(c.dialog(), "Klick ohne Drücken auf dem Hintergrund (Markierung gezogen): offen");

    await act(() => void dialog.querySelector("h2")!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
    await act(() => void dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.ok(c.dialog(), "Drücken im Dialog, Loslassen auf dem Hintergrund: offen");

    await act(() => void dialog.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
    await act(() => void dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.equal(c.dialog(), null, "Drücken und Loslassen auf dem Hintergrund: geschlossen");
  });

  it("`target` macht den Knopf unterscheidbar: Name „Aktion: Ziel“, Titel der Rückfrage ebenso – der sichtbare Text bleibt im Namen enthalten", async () => {
    const c = await mountDelete({ target: "Meier, 3.–7. Mai" });
    assert.equal(c.trigger().getAttribute("aria-label"), "Kunde löschen: Meier, 3.–7. Mai");
    await act(() => c.trigger().click());
    assert.equal(c.dialog()?.querySelector("h2")?.textContent, "Kunde löschen: Meier, 3.–7. Mai?");
    assert.equal(c.inDialog(/^Kunde löschen$/) !== undefined, true, "Bestätigung trägt weiter die Beschriftung der Aktion");
  });
});

describe("SubmitSwitch", () => {
  async function mountSwitch(checked: boolean) {
    const { Form } = await import("./form");
    const { SubmitSwitch } = await import("./switch");
    const submitted: FormData[] = [];
    const action = async (_prev: unknown, data: FormData) => {
      submitted.push(data);
      return { ok: true };
    };
    view = await mount(
      await withProviders(
        createElement(
          Form,
          { action: action as never },
          createElement("input", { type: "hidden", name: "enabled", value: String(!checked) }),
          createElement(SubmitSwitch as never, { checked, label: "Funktion Termine", confirm: { title: "Ausschalten: Funktion Termine?", message: "Abhängige Funktionen werden unbenutzbar.", confirmLabel: "Ausschalten" } }),
        ),
      ),
    );
    return { root: view.container, submitted, toggle: () => view!.container.querySelector("[role='switch']") as HTMLButtonElement };
  }

  it("ein eingeschalteter Schalter fragt beim Ausschalten nach; ein ausgeschalteter schaltet sofort ein", async () => {
    const on = await mountSwitch(true);
    assert.equal(on.toggle().getAttribute("aria-checked"), "true");
    assert.equal(on.toggle().getAttribute("aria-label"), "Funktion Termine");
    await act(() => on.toggle().click());
    assert.ok(on.root.querySelector("dialog")?.open);
    assert.equal(on.submitted.length, 0);
    await act(() => void [...on.root.querySelectorAll("dialog button")].find((b) => b.textContent === "Ausschalten")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await sleep(20);
    assert.equal(on.submitted.length, 1);
    assert.equal(on.submitted[0].get("enabled"), "false");
    await view!.unmount();
    view = null;

    const off = await mountSwitch(false);
    assert.equal(off.toggle().getAttribute("aria-checked"), "false");
    await act(() => void off.toggle().dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })));
    await act(() => (off.root.querySelector("form") as HTMLFormElement).requestSubmit(off.toggle()));
    await sleep(20);
    assert.equal(off.root.querySelector("dialog"), null);
    assert.equal(off.submitted.at(-1)?.get("enabled"), "true");
  });
});
