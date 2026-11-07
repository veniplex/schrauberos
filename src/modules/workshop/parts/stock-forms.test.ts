import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { mountI18n as mountPlain, plain } from "@/test/ui";

/** Inventur-Liste in einem echten Renderer: Struktur für Handy und Tablet (der Artikelname behält mindestens eine volle Zeile). */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;

async function mountI18n(element: ReturnType<typeof createElement>) {
  const { ToastProvider } = await import("@/components/ui/toast");
  return mountPlain(createElement(ToastProvider, null, element));
}
before(async () => {
  dom = installDom();
  env = await createTestEnv();
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

const LONG = "Bremsscheibe vorne belüftet 288 mm für VW Golf VII Variant Kombi";
const ROWS = [
  { id: "a1", number: "BS-288-V", name: LONG, unit: "Stk", stock: "12" },
  { id: "a2", number: "OEL-5W30", name: "Motoröl", unit: "l", stock: "40,5" },
];

describe("CountForm: Inventur-Liste", () => {
  it("unter md steht jeder Artikel gestapelt: Name und Nummer umbrechen in voller Breite, die Eingabe darunter; die Spaltenaufteilung gilt erst ab md", async () => {
    const { CountForm } = await import("./stock-forms");
    view = await mountI18n(createElement(CountForm, { rows: ROWS, cancelHref: "/parts" }));
    const items = Array.from(view.container.querySelectorAll<HTMLElement>("[data-count-row]"));
    assert.equal(items.length, 2);
    for (const li of items) {
      const classes = li.className.split(/\s+/);
      assert.ok(classes.includes("grid-cols-1"), "unter md eine Spalte");
      assert.ok(classes.some((c) => /^md:grid-cols-\[minmax\(0,1fr\)_7rem_8rem\]$/.test(c)), "drei Spalten erst ab md");
      assert.ok(!classes.some((c) => /^grid-cols-\[/.test(c)), "keine feste Spaltenaufteilung ohne Breakpoint");
    }
    const first = items[0];
    const name = first.querySelector("p") as HTMLElement;
    assert.equal(name.textContent, LONG);
    const nameClasses = name.className.split(/\s+/);
    assert.ok(nameClasses.includes("break-words"), "der Name umbricht");
    assert.ok(!nameClasses.includes("truncate"), "unter md nie abgeschnitten");
    assert.ok(nameClasses.includes("md:truncate"), "ab md einzeilig");
    // Nummer und Soll stehen unter dem Namen (die Sollspalte gibt es nur ab md – nichts steht doppelt auf dem Handy)
    assert.match(plain(first.textContent), /BS-288-V · Soll 12 Stk/);
    const sollColumn = Array.from(first.querySelectorAll<HTMLElement>("span")).find((s) => plain(s.textContent) === "12 Stk")!;
    assert.deepEqual(sollColumn.className.split(/\s+/).filter((c) => c === "hidden" || c === "md:block"), ["hidden", "md:block"]);
    // Eingabe: volle Breite unter md (Baustein-Eingabe mit Tippfläche), gebunden an den Artikel
    const input = first.querySelector("input[name='count.a1']") as HTMLInputElement;
    assert.ok(input);
    assert.equal(input.getAttribute("inputmode"), "decimal");
    assert.ok(first.querySelector("label.sr-only, .sr-only"), "die Beschriftung der Eingabe bleibt für Screenreader");
  });

  it("Hinweis (mehr als eine Seite Artikel) erscheint über der Liste; ohne Hinweis nichts", async () => {
    const { CountForm } = await import("./stock-forms");
    view = await mountI18n(createElement(CountForm, { rows: ROWS, cancelHref: "/parts", notice: createElement("p", { "data-notice": "" }, "Es gibt mehr Artikel") }));
    const root = view.container;
    const notice = root.querySelector("[data-notice]") as HTMLElement;
    assert.ok(notice);
    assert.equal(notice.compareDocumentPosition(root.querySelector("[data-count-row]")!) & 4, 4, "der Hinweis steht vor der Liste");
    await view.unmount();
    view = await mountI18n(createElement(CountForm, { rows: ROWS, cancelHref: "/parts", draftKey: "count:BS-1" }));
    assert.equal(view.container.querySelector("[data-notice]"), null);
    assert.equal(view.container.querySelector("form")!.getAttribute("data-draft-key"), "count:BS-1");
  });
});
