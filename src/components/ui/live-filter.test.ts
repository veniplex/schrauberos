import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";
import { LIVE_FILTER_DELAY_MS, liveFilterUrl } from "./live-filter-url";

/** Live-Filter: filtert wie das Absenden des Formulars (gleiche Adresse), Texteingaben erst nach einer Pause, Auswahlfelder sofort. */
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

describe("liveFilterUrl", () => {
  it("entspricht dem Absenden des Formulars: alle Felder in Reihenfolge, auch leere; Dateifelder entfallen", () => {
    assert.equal(liveFilterUrl("/customers", [["q", "müller hans"], ["sort", "name"], ["status", ""]]), "/customers?q=m%C3%BCller+hans&sort=name&status=");
    assert.equal(liveFilterUrl("/customers", [["file", new File(["x"], "a.txt")]]), "/customers");
    assert.equal(liveFilterUrl("/help", []), "/help");
  });
});

async function mountForm() {
  const { LiveFilter } = await import("./live-filter");
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const pushed: string[] = [];
  const form = createElement(
    "form",
    { action: "/customers", method: "get" },
    createElement("input", { name: "q", type: "search", defaultValue: "" }),
    createElement("select", { name: "status", defaultValue: "" }, createElement("option", { value: "" }, "Alle"), createElement("option", { value: "open" }, "Offen")),
    createElement("input", { name: "sort", type: "hidden", defaultValue: "name" }),
    createElement(LiveFilter),
  );
  view = await mount(await withRouter(createElement(I18nProvider, { locale: "de", messages: de } as never, form), { pushed }));
  const root = view.container;
  const input = root.querySelector("input[name='q']") as HTMLInputElement;
  const select = root.querySelector("select") as HTMLSelectElement;
  const type = async (value: string) =>
    act(() => {
      input.value = value;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  return { pushed, input, select, type };
}

describe("LiveFilter", () => {
  it("Texteingabe: erst nach der Pause, jeder Tastendruck setzt die Wartezeit zurück; die Adresse enthält alle Felder", async () => {
    const f = await mountForm();
    await f.type("m");
    await sleep(LIVE_FILTER_DELAY_MS - 150);
    await f.type("mü");
    await sleep(LIVE_FILTER_DELAY_MS - 150);
    assert.deepEqual(f.pushed, [], "noch innerhalb der Wartezeit");
    await sleep(250);
    assert.deepEqual(f.pushed, ["/customers?q=m%C3%BC&status=&sort=name"]);
  });

  it("Auswahlfeld: sofort", async () => {
    const f = await mountForm();
    await act(() => {
      f.select.value = "open";
      f.select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await sleep(20);
    assert.deepEqual(f.pushed, ["/customers?q=&status=open&sort=name"]);
  });

  it("Absenden des Formulars (Enter) verwirft die ausstehende Wartezeit", async () => {
    const f = await mountForm();
    await f.type("abc");
    await act(() => void f.input.form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await sleep(LIVE_FILTER_DELAY_MS + 100);
    assert.deepEqual(f.pushed, []);
  });

  it("zeigt den Wartezustand für Hilfsmittel als Statusmeldung (Bereich vorhanden, sonst leer)", async () => {
    const f = await mountForm();
    const status = view!.container.querySelector("[role='status']")!;
    assert.equal(status.textContent, "");
    assert.ok(f.input);
  });
});

describe("ResetFilterButton", () => {
  it("leert Text, Kontrollkästchen und stellt Auswahlfelder auf den neutralen Eintrag – versteckte Felder (Sortierung) bleiben – und lädt die Liste ohne Filter", async () => {
    const { ResetFilterButton } = await import("./live-filter");
    const pushed: string[] = [];
    const form = createElement(
      "form",
      null,
      createElement("input", { name: "q", type: "search", defaultValue: "müller" }),
      createElement("input", { name: "due", type: "checkbox", defaultChecked: true }),
      createElement("select", { name: "status", defaultValue: "open" }, createElement("option", { value: "" }, "Alle"), createElement("option", { value: "open" }, "Offen")),
      createElement("input", { name: "sort", type: "hidden", defaultValue: "name" }),
      // eslint-disable-next-line react/no-children-prop -- die Props verlangen children; createElement(Komponente, props, children) passt nicht zu dieser Signatur
      createElement(ResetFilterButton, { href: "/customers", children: "Zurücksetzen" }),
    );
    view = await mount(await withRouter(form, { pushed }));
    const root = view.container;
    await act(() => (root.querySelector("button") as HTMLButtonElement).click());
    assert.equal((root.querySelector("input[name='q']") as HTMLInputElement).value, "");
    assert.equal((root.querySelector("input[name='due']") as HTMLInputElement).checked, false);
    assert.equal((root.querySelector("select") as HTMLSelectElement).value, "");
    assert.equal((root.querySelector("input[name='sort']") as HTMLInputElement).value, "name");
    assert.deepEqual(pushed, ["/customers"]);
  });
});
