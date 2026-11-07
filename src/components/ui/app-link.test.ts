import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/** AppLink (P3-6): ein gewöhnlicher Link mit gedrosseltem Vorladen bei Datensparmodus; die Entscheidung selbst: `lib/connection.test.ts`. */
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
  delete (navigator as unknown as Record<string, unknown>).connection;
});

async function show(props: Record<string, unknown> = {}) {
  const { AppLink } = await import("./app-link");
  view = await mount((await withRouter(createElement(AppLink, { href: "/customers/1", ...props }, "Kunde") as ReactElement)) as ReactElement);
  return view.container.querySelector("a") as HTMLAnchorElement;
}

describe("AppLink", () => {
  it("rendert wie ein gewöhnlicher Link – mit und ohne Datensparmodus; Hover, Fokus und Berührung stören nicht", async () => {
    const plain = await show();
    assert.equal(plain.getAttribute("href"), "/customers/1");
    await view!.unmount();
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    const saving = await show({ className: "x" });
    assert.equal(saving.getAttribute("href"), "/customers/1");
    assert.equal(saving.className, "x");
    await act(() => {
      saving.dispatchEvent(new Event("mouseover", { bubbles: true }));
      saving.dispatchEvent(new Event("focus"));
      saving.dispatchEvent(new Event("touchstart", { bubbles: true }));
    });
    assert.equal(saving.textContent, "Kunde");
  });

  it("die Bausteine für Listen und Navigation nutzen ihn statt next/link (sonst gäbe es dort kein gedrosseltes Vorladen)", () => {
    for (const file of ["layout.tsx", "data-table.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), "src", "components", "ui", file), "utf8");
      assert.match(source, /import \{ AppLink as Link \} from "\.\/app-link";/, file);
      assert.doesNotMatch(source, /from "next\/link"/, file);
    }
  });
});
