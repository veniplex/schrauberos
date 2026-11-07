import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, useState } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/** Umschalter als Optionsgruppe: Roving-Tabindex, Pfeiltasten wählen und führen den Fokus, Namen und Sprache der Optionen. */
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

async function mountControl() {
  const { SegmentedControl } = await import("./segmented");
  const changes: string[] = [];
  function Demo() {
    const [value, setValue] = useState("de");
    return createElement(SegmentedControl<string>, {
      label: "Sprache",
      value,
      onChange: (v) => {
        changes.push(v);
        setValue(v);
      },
      options: [
        { value: "de", label: "DE", title: "Deutsch", lang: "de" },
        { value: "en", label: "EN", title: "English", lang: "en" },
        { value: "fr", label: "FR", title: "Français", lang: "fr" },
      ],
    });
  }
  view = await mount(createElement(Demo));
  const radios = () => [...view!.container.querySelectorAll<HTMLButtonElement>("[role='radio']")];
  const key = (k: string) => act(() => void (document.activeElement as HTMLElement).dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
  return { radios, key, changes };
}

describe("SegmentedControl", () => {
  it("nur die gewählte Option ist per Tab erreichbar; Namen beginnen mit dem sichtbaren Kürzel und tragen ihre Sprache", async () => {
    const c = await mountControl();
    assert.deepEqual(c.radios().map((r) => r.tabIndex), [0, -1, -1]);
    assert.deepEqual(c.radios().map((r) => r.getAttribute("aria-label")), ["Deutsch", "English", "Français"]);
    assert.deepEqual(c.radios().map((r) => r.getAttribute("lang")), ["de", "en", "fr"]);
    assert.ok(c.radios().every((r) => r.getAttribute("aria-label")!.toLowerCase().includes(r.textContent!.toLowerCase())), "sichtbarer Text im Namen");
  });

  it("Pfeiltasten wählen die nächste/vorige Option (zyklisch) und führen den Fokus mit", async () => {
    const c = await mountControl();
    c.radios()[0].focus();
    await c.key("ArrowRight");
    assert.deepEqual(c.changes, ["en"]);
    assert.ok(document.activeElement === c.radios()[1]);
    assert.deepEqual(c.radios().map((r) => r.getAttribute("aria-checked")), ["false", "true", "false"]);
    assert.deepEqual(c.radios().map((r) => r.tabIndex), [-1, 0, -1]);
    await c.key("ArrowDown");
    await c.key("ArrowDown"); // fr → zurück zu de
    assert.deepEqual(c.changes, ["en", "fr", "de"]);
    await c.key("ArrowLeft");
    assert.ok(document.activeElement === c.radios()[2], "von der ersten zur letzten");
  });
});
