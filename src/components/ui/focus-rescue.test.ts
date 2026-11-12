import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { installDom, sleep, type TestDom } from "@/test/dom";

/**
 * Fokussicherung nach Aktionen (`installFocusRescue`): Wird das fokussierte Element ersetzt oder entfernt, bleibt der Fokus nach Tastaturbedienung auf der Seite
 * (gleiche `id`, sonst nächster Vorfahr, sonst Hauptüberschrift) – nie auf `<body>`. Nach Mausbedienung greift nichts ein.
 */
let dom: TestDom;
let stop: (() => void) | null = null;
before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = "";
});

const press = (key = "Enter") => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));

async function setup(html: string) {
  const { installFocusRescue } = await import("./focus-rescue");
  document.body.innerHTML = html;
  stop = installFocusRescue(document);
}

describe("installFocusRescue", () => {
  it("Statuswechsel per Tastatur: der Knopf wird ersetzt, der Fokus bleibt in derselben Karte", async () => {
    await setup(`<main><h1>Auftrag</h1><section id="card"><button id="start">Arbeit beginnen</button></section></main>`);
    (document.getElementById("start") as HTMLElement).focus();
    press("Enter");
    document.getElementById("start")!.replaceWith(Object.assign(document.createElement("button"), { id: "done", textContent: "Fertig melden" }));
    await sleep(20);
    assert.equal(document.activeElement?.id, "card", "nächster vorhandener Vorfahr");
    assert.ok(document.activeElement !== document.body);
  });

  it("gleiche id: das neue Element bekommt den Fokus", async () => {
    await setup(`<main><h1>Seite</h1><div><button id="save">Speichern</button></div></main>`);
    (document.getElementById("save") as HTMLElement).focus();
    press(" ");
    document.getElementById("save")!.replaceWith(Object.assign(document.createElement("button"), { id: "save", textContent: "Speichern" }));
    await sleep(20);
    assert.equal(document.activeElement?.id, "save");
    assert.equal((document.activeElement as HTMLElement).tagName, "BUTTON");
  });

  it("nichts Näheres übrig: Hauptüberschrift", async () => {
    await setup(`<main><h1>Termine</h1><div id="gone"><a href="/x" id="link">Termin</a></div></main>`);
    (document.getElementById("link") as HTMLElement).focus();
    press("Enter");
    document.getElementById("gone")!.remove();
    await sleep(20);
    assert.equal(document.activeElement?.tagName, "H1");
  });

  it("vorübergehend gesperrt (disabled beim Speichern): der Fokus kommt zurück, sobald das Element wieder frei ist", async () => {
    await setup(`<main><h1>Seite</h1><button id="b">Speichern</button></main>`);
    const button = document.getElementById("b") as HTMLButtonElement;
    button.focus();
    press("Enter");
    button.blur(); // der Browser setzt den Fokus auf body, wenn ein fokussiertes Element gesperrt wird (happy-dom lässt ein gesperrtes nicht mehr los: erst lösen)
    button.disabled = true;
    await sleep(20);
    assert.ok(document.activeElement === document.body, "gesperrt: noch nichts zu tun");
    button.disabled = false;
    await sleep(20);
    assert.ok(document.activeElement === button, "wieder frei: der Fokus ist zurück");
  });

  it("nach Mausbedienung greift nichts ein (kein Fokus zu verlieren)", async () => {
    await setup(`<main><h1>Seite</h1><button id="b">Los</button></main>`);
    const button = document.getElementById("b") as HTMLElement;
    button.focus();
    document.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    button.remove();
    await sleep(20);
    assert.ok(document.activeElement === document.body);
  });

  it("ohne vorherige Taste (länger als das Zeitfenster) bleibt es beim Browserverhalten", async () => {
    const { installFocusRescue } = await import("./focus-rescue");
    document.body.innerHTML = `<main><h1>Seite</h1><button id="b">Los</button></main>`;
    let clock = 0;
    stop = installFocusRescue(document, () => clock);
    const button = document.getElementById("b") as HTMLElement;
    button.focus();
    press("Enter");
    clock = 60_000;
    button.remove();
    await sleep(20);
    assert.ok(document.activeElement === document.body);
  });

  it("ein Fokus, der woanders steht, wird nie verschoben", async () => {
    await setup(`<main><h1>Seite</h1><button id="a">A</button><button id="b">B</button></main>`);
    (document.getElementById("a") as HTMLElement).focus();
    press("Tab");
    (document.getElementById("b") as HTMLElement).focus();
    document.getElementById("a")!.remove();
    await sleep(20);
    assert.equal(document.activeElement?.id, "b");
  });
});
