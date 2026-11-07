import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement, createRef, useState, type ElementType } from "react";
import { act, installDom, mount, type MountedView } from "@/test/dom";

/** Eingabebausteine in einem echten Renderer (react-dom/client + happy-dom): Fokus, Referenzen, Tastatur-Hinweise. */
describe("numberInputMode", () => {
  it("Ganzzahlfelder (auch mit step=5) bekommen die Zahlentastatur, Felder mit Nachkommastellen die Dezimaltastatur", async () => {
    const { numberInputMode } = await import("./form");
    assert.equal(numberInputMode(undefined), "numeric");
    assert.equal(numberInputMode(1), "numeric");
    assert.equal(numberInputMode(5), "numeric");
    assert.equal(numberInputMode("10"), "numeric");
    assert.equal(numberInputMode("0.01"), "decimal");
    assert.equal(numberInputMode(0.5), "decimal");
    assert.equal(numberInputMode("any"), "decimal");
  });

  it("Input setzt inputMode am Zahlenfeld selbst, ein ausdrücklicher Wert gewinnt", async () => {
    const dom = installDom();
    const { Input } = await import("./form");
    const view = await mount(
      createElement("div", null, [
        createElement(Input, { key: "a", type: "number", step: 5, "data-t": "a" } as never),
        createElement(Input, { key: "b", type: "number", step: "0.01", "data-t": "b" } as never),
        createElement(Input, { key: "c", type: "number", inputMode: "text", "data-t": "c" } as never),
        createElement(Input, { key: "d", type: "text", "data-t": "d" } as never),
      ]),
    );
    const mode = (t: string) => view.container.querySelector(`[data-t='${t}']`)?.getAttribute("inputmode");
    assert.equal(mode("a"), "numeric");
    assert.equal(mode("b"), "decimal");
    assert.equal(mode("c"), "text");
    assert.equal(mode("d"), null);
    await view.unmount();
    await dom.close();
  });
});

describe("ColorPicker", () => {
  it("benannte Vorschläge heißen wie ihre Farbe (nicht wie der Hex-Wert); die gewählte ist aria-pressed; Hex-Werte ohne Namen bleiben möglich", async () => {
    const dom = installDom();
    let view: MountedView | null = null;
    try {
      const { ColorPicker } = await import("./form");
      const picked: string[] = [];
      view = await mount(
        createElement(ColorPicker, {
          name: "accentColor",
          value: "#0f766e",
          presets: [{ value: "#2459c9", label: "Blau" }, { value: "#0f766e", label: "Petrol" }, "#15803d"],
          onChange: (c: string) => picked.push(c),
          customLabel: "Eigene Farbe wählen",
        }),
      );
      const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("button")];
      assert.deepEqual(buttons.map((b) => b.getAttribute("aria-label")), ["Blau", "Petrol", "#15803d"]);
      assert.deepEqual(buttons.map((b) => b.getAttribute("aria-pressed")), ["false", "true", "false"]);
      await act(() => buttons[0].click());
      assert.deepEqual(picked, ["#2459c9"]);
    } finally {
      await view?.unmount();
      await dom.close();
    }
  });
});

describe("autoFocus der Eingabebausteine", () => {
  let view: MountedView | null = null;
  afterEach(async () => {
    await view?.unmount();
    view = null;
  });

  /** Formular mit einem Zähler, der bei jedem Klick neu rendert (wie ein Fehlerzustand nach dem Absenden). */
  async function mountForm(tag: "Input" | "Textarea" | "Select") {
    const form = await import("./form");
    const Field = form[tag] as unknown as ElementType;
    const inputRef = createRef<HTMLElement>();
    function Page() {
      const [count, setCount] = useState(0);
      return createElement(
        "div",
        null,
        createElement(Field, { id: "field", autoFocus: true, ref: inputRef }, tag === "Select" ? createElement("option", { value: "x" }, "x") : undefined),
        createElement("input", { id: "other", type: "text" }),
        createElement("button", { id: "rerender", type: "button", onClick: () => setCount(count + 1) }, `Zähler ${count}`),
      );
    }
    view = await mount(createElement(Page));
    return { inputRef, root: view.container };
  }

  for (const tag of ["Input", "Textarea", "Select"] as const) {
    it(`${tag}: am Desktop einmal beim Einhängen im Fokus; spätere Renderings holen den Fokus nicht zurück; die ref bleibt erhalten`, async () => {
      const dom = installDom({ width: 1440 });
      try {
        const { inputRef, root } = await mountForm(tag);
        const field = root.querySelector("#field") as HTMLElement;
        assert.equal(document.activeElement, field, "Fokus nach dem Einhängen");
        assert.equal(inputRef.current, field, "übergebene ref bleibt erhalten");
        // Nutzer wechselt in ein anderes Feld und löst ein Neuzeichnen aus
        (root.querySelector("#other") as HTMLElement).focus();
        await act(() => (root.querySelector("#rerender") as HTMLElement).click());
        assert.match(root.querySelector("#rerender")?.textContent ?? "", /1/, "Neuzeichnen hat stattgefunden");
        assert.equal(document.activeElement, root.querySelector("#other"), "Fokus wurde nicht ins Feld zurückgeholt");
      } finally {
        await view?.unmount();
        view = null;
        await dom.close();
      }
    });

    it(`${tag}: auf Touch-Geräten (schmaler Bildschirm) nie im Fokus`, async () => {
      const dom = installDom({ width: 390, height: 844 });
      try {
        const { root } = await mountForm(tag);
        assert.notEqual(document.activeElement, root.querySelector("#field"));
      } finally {
        await view?.unmount();
        view = null;
        await dom.close();
      }
    });
  }

  it("ohne autoFocus bleibt die ref erhalten und nichts bekommt den Fokus", async () => {
    const dom = installDom({ width: 1440 });
    try {
      const { Input } = await import("./form");
      const ref = createRef<HTMLInputElement>();
      view = await mount(createElement(Input, { ref, id: "plain" }));
      assert.equal(ref.current, view.container.querySelector("#plain"));
      assert.notEqual(document.activeElement, ref.current);
    } finally {
      await view?.unmount();
      view = null;
      await dom.close();
    }
  });
});
