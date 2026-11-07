import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { mountI18n, plain } from "@/test/ui";

/** Verlauf und Stufenanzeige: Reihenfolge, Zustand als Text (nicht nur Farbe), aktueller Schritt für Hilfstechnik. */
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

const STEPS = [
  { id: "accepted", label: "Angenommen" },
  { id: "working", label: "In Arbeit" },
  { id: "ready", label: "Abholbereit" },
  { id: "done", label: "Abgeholt" },
];

describe("Stepper", () => {
  it("stepStates: davor erledigt, aktueller Schritt, danach offen; übersprungene bleiben übersprungen; unbekannter Schritt: nichts erledigt", async () => {
    const { stepStates } = await import("./timeline");
    assert.deepEqual(stepStates(STEPS, "working"), ["done", "current", "upcoming", "upcoming"]);
    assert.deepEqual(stepStates(STEPS, "done"), ["done", "done", "done", "current"]);
    assert.deepEqual(stepStates(STEPS, "ready", ["working"]), ["done", "skipped", "current", "upcoming"]);
    assert.deepEqual(stepStates(STEPS, "gibt-es-nicht"), ["upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("eine Liste; nur der aktuelle Schritt trägt aria-current=step; der Zustand steht als Text für Hilfstechnik", async () => {
    const { Stepper } = await import("./timeline");
    view = await mountI18n(createElement(Stepper, { steps: STEPS, current: "ready", label: "Auftragsstatus" } as never));
    const list = view.container.querySelector("ol");
    assert.equal(list?.getAttribute("aria-label"), "Auftragsstatus");
    const items = Array.from(view.container.querySelectorAll("li"));
    assert.equal(items.length, 4);
    assert.deepEqual(items.map((li) => li.getAttribute("aria-current")), [null, null, "step", null]);
    assert.match(plain(items[0].textContent), /Angenommen\s*erledigt/);
    assert.match(plain(items[2].textContent), /Abholbereit\s*aktuell/);
    assert.match(plain(items[3].textContent), /Abgeholt\s*folgt noch/);
    assert.equal(items[0].querySelector("svg") !== null, true, "erledigt trägt ein Häkchen");
    assert.equal(items[3].querySelector("svg") !== null, false, "ein offener Schritt trägt eine Nummer statt des Häkchens");
  });

  it("englisch", async () => {
    const { Stepper } = await import("./timeline");
    view = await mountI18n(createElement(Stepper, { steps: STEPS, current: "accepted", skipped: ["working"] } as never), "en");
    const items = Array.from(view.container.querySelectorAll("li"));
    assert.match(plain(items[0].textContent), /current/);
    assert.match(plain(items[1].textContent), /skipped/);
  });
});

describe("Timeline", () => {
  it("Einträge in der gegebenen Reihenfolge mit Zeit und Beschreibung; Standardname der Liste; Trennlinie nur zwischen den Einträgen", async () => {
    const { Timeline } = await import("./timeline");
    view = await mountI18n(
      createElement(Timeline, {
        items: [
          { id: "1", title: "Auftrag angenommen", time: "07.11.2026, 08:15", description: "Kilometerstand 120.500", tone: "info" },
          { id: "2", title: "Fertig gemeldet", time: "07.11.2026, 16:40", tone: "success" },
        ],
      } as never),
    );
    const list = view.container.querySelector("ol");
    assert.equal(list?.getAttribute("aria-label"), "Verlauf");
    const items = Array.from(view.container.querySelectorAll("li"));
    assert.deepEqual(items.map((li) => li.querySelector("p")?.textContent), ["Auftrag angenommen", "Fertig gemeldet"]);
    assert.match(plain(items[0].textContent), /07\.11\.2026, 08:15/);
    assert.match(plain(items[0].textContent), /Kilometerstand 120\.500/);
    assert.equal(items[0].querySelectorAll("span[aria-hidden]").length, 2, "Linie und Punkt");
    assert.equal(items[1].querySelectorAll("span[aria-hidden]").length, 1, "der letzte Eintrag hat keine Linie darunter");
  });
});
