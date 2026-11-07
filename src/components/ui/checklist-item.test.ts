import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain, rerenderI18n, wait } from "@/test/ui";

/** Punkt einer Checkliste: speichert einzeln, zeigt Fehler sichtbar und lässt sich wiederholen. */
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

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

async function mountItem(props: Record<string, unknown>) {
  const { ChecklistItem } = await import("./checklist-item");
  view = await mountI18n(createElement(ChecklistItem, { label: "Radmuttern nachgezogen", checked: false, ...props } as never));
  return {
    box: view.container.querySelector("input[type='checkbox']") as HTMLInputElement,
    status: () => plain(view!.container.querySelector("[role='status']")?.textContent),
    rerender: (next: Record<string, unknown>) => rerenderI18n(view!, createElement(ChecklistItem, { label: "Radmuttern nachgezogen", checked: false, ...next } as never)),
  };
}

describe("ChecklistItem", () => {
  it("Abhaken speichert sofort diesen einen Punkt; während des Speicherns gesperrt, danach bestätigt", async () => {
    const saves: boolean[] = [];
    const gate = deferred();
    const { box, status } = await mountItem({ onSave: (value: boolean) => (saves.push(value), gate.promise) });
    await click(box);
    assert.deepEqual(saves, [true]);
    assert.equal(box.checked, true, "der Haken steht sofort");
    assert.equal(box.disabled, true, "während des Speicherns gesperrt (kein Doppeltippen)");
    assert.match(status(), /Wird gespeichert/);
    await act(async () => {
      gate.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(box.disabled, false);
    assert.equal(box.checked, true);
    assert.equal(view!.container.querySelector("[role='status'] :not(.sr-only)"), null, "nach Erfolg keine sichtbare Meldung");
    assert.match(view!.container.querySelector("[role='status'] .sr-only")?.textContent ?? "", /Gespeichert/, "für Hilfstechnik steht „Gespeichert“ da");
  });

  it("Fehler: der Haken bleibt sichtbar stehen, „Nicht gespeichert“ und „Erneut versuchen“ erscheinen; Wiederholen speichert denselben Zustand", async () => {
    let fail = true;
    const saves: boolean[] = [];
    const { box, status } = await mountItem({
      onSave: async (value: boolean) => {
        saves.push(value);
        if (fail) throw new Error("kein Netz");
      },
    });
    await click(box);
    await wait();
    assert.equal(box.checked, true, "kein stilles Zurückspringen");
    assert.match(status(), /Nicht gespeichert/);
    assert.equal(box.getAttribute("aria-invalid"), "true");
    const retry = byText(view!.container, "button", /Erneut versuchen/);
    assert.ok(retry, "Wiederholen ist sichtbar");
    fail = false;
    await click(retry);
    await wait();
    assert.deepEqual(saves, [true, true]);
    assert.equal(byText(view!.container, "button", /Erneut versuchen/), undefined);
    assert.doesNotMatch(status(), /Nicht gespeichert/);
  });

  it("ein Punkt wieder abhaken speichert false; mehrere Punkte speichern unabhängig voneinander", async () => {
    const { ChecklistItem } = await import("./checklist-item");
    const a: boolean[] = [];
    const b: boolean[] = [];
    view = await mountI18n(
      createElement("div", null, createElement(ChecklistItem, { label: "A", checked: true, onSave: async (v: boolean) => void a.push(v) } as never), createElement(ChecklistItem, { label: "B", checked: false, onSave: async (v: boolean) => void b.push(v) } as never)),
    );
    const boxes = Array.from(view.container.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
    await click(boxes[0]);
    await wait();
    await click(boxes[1]);
    await wait();
    assert.deepEqual([a, b], [[false], [true]]);
  });

  it("der Stand vom Server folgt, solange nichts aussteht; bei einem Fehler bleibt die eigene Eingabe (sonst ginge sie verloren)", async () => {
    const { box, rerender } = await mountItem({ onSave: async () => undefined });
    await rerender({ checked: true, onSave: async () => undefined });
    assert.equal(box.checked, true);
    const failing = await mountItem({
      onSave: async () => {
        throw new Error("x");
      },
    });
    await click(failing.box);
    await wait();
    await failing.rerender({
      checked: false,
      onSave: async () => {
        throw new Error("x");
      },
    });
    assert.equal(failing.box.checked, true, "der nicht gespeicherte Haken bleibt");
  });

  it("die ganze Zeile ist das Ziel (Label, mindestens 44 px), Hinweis und Zusatzfelder stehen darunter", async () => {
    const { box } = await mountItem({ onSave: async () => undefined, hint: "Drehmoment 120 Nm", children: createElement("span", { id: "extra" }, "Messwert") });
    const label = box.closest("label");
    assert.ok(label);
    assert.match(label.className, /min-h-11/);
    assert.match(plain(label.textContent), /Drehmoment 120 Nm/);
    assert.ok(view!.container.querySelector("#extra"));
  });
});
