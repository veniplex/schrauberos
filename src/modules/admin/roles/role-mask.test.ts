import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/** Rollenmaske: einklappbare Gruppen, Suche, Vorlagen, ausgeschaltete Funktionen eingeklappt, Vorschau – und gesendet wird immer die ganze Auswahl. */
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

const key = (k: string, label: string, hint: string, mark?: string) => ({ key: k, label, hint, mark });
const sections = [
  {
    moduleId: "workshop",
    moduleName: "Werkstatt",
    groups: [
      { group: "customers", label: "Kunden", inactive: false, keys: [key("customers.view", "Kunden ansehen", "Kunden ansehen."), key("customers.edit", "Kunden bearbeiten", "Kunden ändern."), key("customers.export", "Kunden exportieren", "Als CSV laden.", "Export")] },
      { group: "tires", label: "Reifenlager", inactive: false, keys: [key("tires.view", "Reifenlager ansehen", "Sätze ansehen."), key("tires.stock", "Sätze ein-/ausbuchen", "Ein- und ausbuchen.")] },
    ],
  },
  { moduleId: "office", moduleName: "Büro", groups: [{ group: "invoices", label: "Rechnungsarchiv", inactive: true, keys: [key("invoices.view", "Rechnungen ansehen", "Rechnungen ansehen.")] }] },
];
const preview = {
  nav: [
    { id: "c", feature: "workshop.customers", permission: "customers.view", label: "Kunden-Navigation", moduleName: "Werkstatt" },
    { id: "i", feature: "office.invoices", permission: "invoices.view", label: "Rechnungen-Navigation", moduleName: "Büro" },
  ],
  widgets: [{ id: "w", feature: "workshop.tires", permission: "tires.view", label: "Reifen-Baustein", moduleName: "Werkstatt" }],
  actions: [{ id: "a", feature: "workshop.customers", permission: "customers.edit", label: "Neuer Kunde", moduleName: "Werkstatt" }],
  inactiveFeatures: ["office.invoices"],
};
const templates = [{ id: "mechanic", name: "Mechaniker", description: "Termine, Reifen", permissions: ["tires.view", "tires.stock", "customers.view"] }];

async function mountMask(props: { initial?: string[]; locked?: string[] } = {}) {
  const { RoleMask } = await import("./role-mask");
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const templated: string[] = [];
  const element = createElement(
    I18nProvider,
    { locale: "de", messages: de } as never,
    createElement("form", { id: "f" }, createElement(RoleMask, { initialPermissions: props.initial ?? [], sections, lockedPermissions: props.locked ?? [], templates, preview, onTemplate: (t: { name: string }) => templated.push(t.name) })),
  );
  view = await mount(element);
  const root = view.container;
  const form = root.querySelector("form") as HTMLFormElement;
  const sent = () => new FormData(form).getAll("permission").map(String).sort();
  const box = (value: string) => root.querySelector(`input[type='checkbox'][value='${value}']`) as HTMLInputElement;
  const visible = (el: Element | null) => {
    for (let n: Element | null = el; n && n !== root; n = n.parentElement) if (n.hasAttribute("hidden")) return false;
    return true;
  };
  const buttonNamed = (re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(b.textContent ?? "")) as HTMLButtonElement;
  const search = root.querySelector("input[type='search']") as HTMLInputElement;
  const type = (value: string) =>
    act(() => {
      // React verfolgt den Wert gesteuerter Felder: nativer Setter, dann das Ereignis
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(search, value);
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  return { root, sent, box, visible, buttonNamed, search, type, templated };
}

describe("RoleMask", () => {
  it("neue Rolle: alle Gruppen zugeklappt, Kontrollkästchen bleiben im Dokument; Gruppen mit gewählten Rechten sind offen", async () => {
    const m = await mountMask();
    assert.equal(m.visible(m.box("customers.view")), false);
    await act(() => m.box("customers.view").click());
    assert.deepEqual(m.sent(), ["customers.view"], "auch zugeklappt gesendet");
    await view!.unmount();
    const prefilled = await mountMask({ initial: ["tires.view"] });
    assert.equal(prefilled.visible(prefilled.box("tires.view")), true, "Gruppe mit gewähltem Recht ist offen");
    assert.equal(prefilled.visible(prefilled.box("customers.view")), false);
  });

  it("Alle aufklappen / zuklappen; Gruppenkopf zählt die gewählten Rechte", async () => {
    const m = await mountMask({ initial: ["customers.view"] });
    assert.match(m.root.textContent ?? "", /1 von 3 gewählt/);
    await act(() => m.buttonNamed(/Alle aufklappen/).click());
    assert.equal(m.visible(m.box("tires.stock")), true);
    await act(() => m.buttonNamed(/Alle zuklappen/).click());
    assert.equal(m.visible(m.box("tires.stock")), false);
  });

  it("Bearbeiten setzt Ansehen mit (Regel der Maske) und die Vorschau folgt der Auswahl", async () => {
    const m = await mountMask({ initial: ["customers.view"] });
    assert.match(m.root.querySelector("aside")!.textContent ?? "", /Kunden-Navigation/);
    assert.equal(/Neuer Kunde/.test(m.root.querySelector("aside")!.textContent ?? ""), false);
    await act(() => m.box("customers.edit").click());
    assert.deepEqual(m.sent(), ["customers.edit", "customers.view"]);
    assert.match(m.root.querySelector("aside")!.textContent ?? "", /Neuer Kunde/);
  });

  it("Vorschau: ausgeschaltete Funktionen erscheinen nicht, werden aber als wartend gemeldet", async () => {
    const m = await mountMask({ initial: ["invoices.view", "tires.view"] });
    const aside = m.root.querySelector("aside")!.textContent ?? "";
    assert.equal(aside.includes("Rechnungen-Navigation"), false);
    assert.match(aside, /Reifen-Baustein/);
    assert.match(aside, /1 weiterer Eintrag erscheint/);
  });

  it("Suche blendet nicht Passendes aus, klappt Treffer auf, zählt – und die ganze Auswahl wird weiter gesendet", async () => {
    const m = await mountMask({ initial: ["tires.view"] });
    await m.type("EXPORT");
    assert.equal(m.visible(m.box("customers.export")), true);
    assert.equal(m.visible(m.box("customers.view")), false);
    assert.equal(m.visible(m.box("tires.view")), false);
    assert.match(m.root.textContent ?? "", /1 Recht passt/);
    assert.deepEqual(m.sent(), ["tires.view"], "ausgeblendet heißt nicht abgewählt");
    await m.type("gibtesnicht");
    assert.match(m.root.textContent ?? "", /Kein Recht passt/);
    await m.type("");
    assert.equal(m.visible(m.box("customers.export")), false, "ohne Suche wieder zugeklappt");
  });

  it("Enter in der Suche sendet das Formular nicht ab", async () => {
    const m = await mountMask();
    const enter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(() => void m.search.dispatchEvent(enter));
    assert.equal(enter.defaultPrevented, true);
  });

  it("ausgeschaltete Funktionen stehen eingeklappt hinter einem Hinweis, nicht als offene Liste", async () => {
    const m = await mountMask();
    assert.equal(m.visible(m.box("invoices.view")), false);
    const toggle = m.buttonNamed(/Ausgeschaltete Funktion \(1\)/);
    assert.ok(toggle);
    assert.match(toggle.textContent ?? "", /Module & Funktionen/);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  });

  it("Vorlage ersetzt die Auswahl, meldet sich und lässt gesperrte Rechte unberührt", async () => {
    const m = await mountMask({ initial: ["customers.edit", "customers.view", "customers.export"], locked: ["customers.export"] });
    await act(() => m.buttonNamed(/Mechaniker/).click());
    assert.deepEqual(m.sent(), ["customers.export", "customers.view", "tires.stock", "tires.view"]);
    assert.equal(m.root.querySelector("input[type='hidden'][name='permission'][value='customers.export']") !== null, true, "gesperrtes vorhandenes Recht bleibt erhalten");
    assert.deepEqual(m.templated, ["Mechaniker"]);
    assert.match(m.root.textContent ?? "", /Vorlage „Mechaniker“ übernommen/);
    assert.equal(m.box("customers.export").disabled, true);
  });

  it("zeigt Kurzbeschreibung und Kennzeichnung je Recht", async () => {
    const m = await mountMask();
    assert.match(m.root.textContent ?? "", /Als CSV laden\./);
    assert.match(m.root.textContent ?? "", /Export/);
  });
});
