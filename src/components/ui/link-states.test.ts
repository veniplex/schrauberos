import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/**
 * Z6-5 N11: Das Warte-Symbol eines Link-Knopfs verdeckt nicht den letzten Buchstaben (es sitzt mittig, die Beschriftung hat einen eigenen Rahmen und tritt beim Warten zurück), und ein Link im Fließtext einer
 * Meldung sprengt mit seiner Tap-Mindesthöhe nicht den Zeilenabstand (Knöpfe in Meldungen behalten ihre Höhe).
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

const show = async (element: ReactElement) => {
  view = await mount((await withRouter(element)) as ReactElement);
  return view.container;
};

describe("LinkButton und Meldung", () => {
  it("der Link-Knopf hat einen Beschriftungsrahmen und ein mittiges Warte-Symbol (nicht am rechten Rand)", async () => {
    const { LinkButton } = await import("./buttons");
    const root = await show(createElement(LinkButton, { href: "/x" }, "Neuer Termin"));
    const link = root.querySelector("a.btn")!;
    const label = link.querySelector(":scope > .btn-label");
    assert.equal(label?.textContent, "Neuer Termin");
    const spinner = link.querySelector(":scope > span[aria-hidden]")!;
    assert.match(spinner.className, /\binset-0\b/);
    assert.match(spinner.className, /\bm-auto\b/);
    assert.doesNotMatch(spinner.className, /right-0\.5/);
  });

  it("die Beschriftung tritt beim Warten zurück (Regel in globals.css)", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    assert.match(css, /\.btn:has\(> \[data-pending\]\) > \.btn-label\s*\{\s*opacity:/);
  });

  it("ein Link im Fließtext einer Meldung wird als Fließtext-Link gesetzt (inline, ohne Tap-Mindesthöhe); die Meldung selbst verkleinert keine anderen Links oder Knöpfe", async () => {
    const { Alert, TextLink } = await import("./layout");
    const { LinkButton } = await import("./buttons");
    const root = await show(
      createElement(Alert as never, { tone: "warning" }, "Es fehlt eine Anschrift. ", createElement(TextLink, { href: "/settings", className: "inline! min-h-0! min-w-0!" }, "Adresse eintragen"), createElement(LinkButton, { href: "/x" }, "Los"), createElement(TextLink, { href: "/y" }, "Eigene Zeile")),
    );
    const alert = root.querySelector("[role=status]")!;
    assert.doesNotMatch(alert.className, /min-h-0/, "die Meldung ändert keine Zielgrößen (Links neben dem Text brauchen das Touch-Ziel, axe target-size)");
    const links = [...alert.querySelectorAll("a")];
    const inline = links.find((a) => a.textContent === "Adresse eintragen")!;
    assert.match(inline.className, /inline!/);
    assert.match(inline.className, /min-h-0!/);
    const other = links.find((a) => a.textContent === "Eigene Zeile")!;
    assert.match(other.className, /min-h-\(--tap-row\)/, "ein gewöhnlicher TextLink behält die Tap-Mindesthöhe");
    assert.ok(alert.querySelector("a.btn"));
  });
});
