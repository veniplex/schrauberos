import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { click, mountI18n, plain } from "@/test/ui";

/** Druckansicht: Werkzeugleiste nur am Bildschirm, A4-Seite, Seitenumbruch, Drucken-Knopf. */
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

describe("PrintLayout", () => {
  it("setzt die A4-Seite, die Werkzeugleiste trägt no-print, der Inhalt steht im Ausdruck", async () => {
    const { PrintLayout, PrintPageBreak, PrintKeep } = await import("./print-layout");
    view = await mountI18n(createElement(PrintLayout, { toolbar: createElement("span", { id: "extra" }, "Extra") } as never, createElement("h1", null, "Auftragskarte"), createElement(PrintKeep, null, "Unterschrift"), createElement(PrintPageBreak)));
    const root = view.container;
    assert.ok(root.querySelector(".print-a4"));
    const toolbar = root.querySelector(".no-print") as HTMLElement;
    assert.ok(toolbar.querySelector("#extra"), "zusätzliche Knöpfe stehen in der Werkzeugleiste");
    assert.match(plain(toolbar.textContent), /Drucken/);
    assert.equal(toolbar.contains(root.querySelector("h1")), false, "der Inhalt ist nicht Teil der Werkzeugleiste");
    assert.ok(root.querySelector(".print-keep"));
    assert.equal(root.querySelector(".print-break")?.getAttribute("aria-hidden"), "true");
  });

  it("„Drucken“ öffnet den Druckdialog des Geräts", async () => {
    let printed = 0;
    (window as unknown as { print: () => void }).print = () => void printed++;
    const { PrintButton } = await import("./print-layout");
    view = await mountI18n(createElement(PrintButton));
    await click(view.container.querySelector("button"));
    assert.equal(printed, 1);
    assert.match(view.container.querySelector("button")?.className ?? "", /no-print/);
  });

  it("die Druckregeln stehen in globals.css: benannte A4-Seite mit 15 mm Rand, no-print, Umbruch, Zusammenhalten, immer hell", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    assert.match(css, /@page a4 \{\s*size: A4 portrait;\s*margin: 15mm;/);
    assert.match(css, /\.print-a4 \{\s*page: a4;/);
    assert.match(css, /\.print-break \{\s*break-before: page;/);
    assert.match(css, /\.print-keep \{\s*break-inside: avoid;/);
    assert.match(css, /@media print \{\s*\.no-print \{\s*display: none !important;/);
    assert.match(css, /@media print \{\s*:root \{\s*color-scheme: light;/);
  });
});
