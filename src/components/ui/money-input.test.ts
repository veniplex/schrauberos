import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, useState } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { blur, mountI18n, type } from "@/test/ui";

/** Geldbetragsfeld: Zehnerblock, Schreibweise der Oberfläche, nichts wird still umgedeutet. */
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

async function mountMoney(props: Record<string, unknown> = {}, locale: "de" | "en" = "de") {
  const { MoneyInput } = await import("./money-input");
  view = await mountI18n(createElement(MoneyInput, { name: "price", "aria-label": "Preis", ...props } as never), locale);
  return view.container.querySelector("input") as HTMLInputElement;
}

describe("MoneyInput", () => {
  it("Textfeld mit Zehnerblock (inputMode decimal), nicht type=number, Währung als Beschriftung am Rand", async () => {
    const input = await mountMoney();
    assert.equal(input.type, "text");
    assert.equal(input.getAttribute("inputmode"), "decimal");
    assert.equal(input.getAttribute("autocomplete"), "off");
    assert.equal(input.name, "price");
    assert.match(view!.container.textContent ?? "", /€/);
  });

  it("ungesteuert: Anfangswert in Cent in der Schreibweise der Oberfläche (de Komma, en Punkt)", async () => {
    assert.equal((await mountMoney({ defaultValue: 1990 })).value, "19,90");
    await view?.unmount();
    assert.equal((await mountMoney({ defaultValue: 1990 }, "en")).value, "19.90");
    await view?.unmount();
    assert.equal((await mountMoney({ defaultValue: null })).value, "");
  });

  it("nach dem Verlassen wird ein lesbarer Betrag einheitlich geschrieben, onValueChange meldet Text und Cent", async () => {
    const seen: Array<[string, number | null]> = [];
    const input = await mountMoney({ onValueChange: (text: string, cents: number | null) => seen.push([text, cents]) });
    await type(input, "1.234,5");
    assert.deepEqual(seen.at(-1), ["1.234,5", 123450]);
    await blur(input);
    assert.equal(input.value, "1234,50");
    assert.deepEqual(seen.at(-1), ["1234,50", 123450]);
    assert.equal(input.getAttribute("aria-invalid"), null);
  });

  it("englische Oberfläche: „12,5“ und „12.5“ werden zu „12.50“", async () => {
    const input = await mountMoney({}, "en");
    await type(input, "12,5");
    await blur(input);
    assert.equal(input.value, "12.50");
  });

  it("ein nicht lesbarer Text bleibt stehen und ist als ungültig markiert; leer bleibt leer (kein Fehler)", async () => {
    const seen: Array<number | null> = [];
    const input = await mountMoney({ onValueChange: (_t: string, cents: number | null) => seen.push(cents) });
    await type(input, "zwölf");
    await blur(input);
    assert.equal(input.value, "zwölf");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(seen.at(-1), null);
    await type(input, "");
    await blur(input);
    assert.equal(input.getAttribute("aria-invalid"), null);
  });

  it("gesteuert: der Wert gehört dem Aufrufer (Rückruf rechnet aus dem aktuellen Zustand)", async () => {
    const { MoneyInput } = await import("./money-input");
    function Controlled() {
      const [text, setText] = useState("5");
      return createElement("div", null, createElement(MoneyInput, { value: text, onValueChange: setText, "aria-label": "x" } as never), createElement("output", null, `[${text}]`));
    }
    view = await mountI18n(createElement(Controlled));
    const input = view.container.querySelector("input") as HTMLInputElement;
    await type(input, "7,25");
    assert.match(view.container.querySelector("output")?.textContent ?? "", /\[7,25\]/);
    await blur(input);
    assert.equal(input.value, "7,25");
  });
});
