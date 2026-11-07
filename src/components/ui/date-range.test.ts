import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain, type } from "@/test/ui";

/** Zeitraum-Baustein: zwei Datumsfelder, Schnellauswahl, Meldungen. */
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

async function mountRange(props: Record<string, unknown> = {}, locale: "de" | "en" = "de") {
  const { DateRange } = await import("./date-range");
  view = await mountI18n(createElement("form", null, createElement(DateRange, props as never)), locale);
  const root = view.container;
  return { root, from: root.querySelector("input[name='from']") as HTMLInputElement, to: root.querySelector("input[name='to']") as HTMLInputElement, alert: () => plain(root.querySelector("[role='alert']")?.textContent) };
}

describe("DateRange", () => {
  it("zwei Datumsfelder mit Namen from/to (änderbar) in einer benannten Gruppe, Datum als JJJJ-MM-TT", async () => {
    const { root, from, to } = await mountRange({ defaultFrom: "2026-11-01", defaultTo: "2026-11-30" });
    assert.equal(from.type, "date");
    assert.equal(from.value, "2026-11-01");
    assert.equal(to.value, "2026-11-30");
    assert.match(plain(root.querySelector("legend")?.textContent), /Zeitraum/);
    assert.match(plain(root.textContent), /30 Tage/);
    await view?.unmount();
    const custom = await mountRange({ nameFrom: "start", nameTo: "end" });
    assert.ok(custom.root.querySelector("input[name='start']") && custom.root.querySelector("input[name='end']"));
  });

  it("Schnellauswahl setzt beide Felder (rechnet vom übergebenen „heute“ aus) und markiert die aktive Auswahl", async () => {
    const changes: Array<[{ from: string; to: string }, boolean]> = [];
    const { root, from, to } = await mountRange({ today: "2026-11-07", onChange: (range: { from: string; to: string }, valid: boolean) => changes.push([range, valid]) });
    await click(byText(root, "button", /^Letzte 7 Tage$/));
    assert.deepEqual([from.value, to.value], ["2026-11-01", "2026-11-07"]);
    assert.equal(byText(root, "button", /^Letzte 7 Tage$/)?.getAttribute("aria-pressed"), "true");
    assert.equal(byText(root, "button", /^Heute$/)?.getAttribute("aria-pressed"), "false");
    await click(byText(root, "button", /^Letzter Monat$/));
    assert.deepEqual([from.value, to.value], ["2026-10-01", "2026-10-31"]);
    assert.deepEqual(changes.at(-1), [{ from: "2026-10-01", to: "2026-10-31" }, true]);
  });

  it("ohne „heute“ gibt es keine Schnellauswahl; die Voreinstellungen sind wählbar", async () => {
    assert.equal((await mountRange()).root.querySelector("button"), null);
    await view?.unmount();
    const { root } = await mountRange({ today: "2026-11-07", presets: ["today", "thisYear"] });
    assert.deepEqual(Array.from(root.querySelectorAll("button")).map((b) => plain(b.textContent)), ["Heute", "Dieses Jahr"]);
  });

  it("Ende vor Beginn: Meldung als Hinweis (role=alert) und beide Felder ungültig; nach Korrektur weg", async () => {
    const { root, from, to, alert } = await mountRange({ defaultFrom: "2026-11-10", defaultTo: "2026-11-20" });
    await type(to, "2026-11-05");
    assert.equal(alert(), "Das Ende liegt vor dem Beginn.");
    assert.equal(from.getAttribute("aria-invalid"), "true");
    assert.equal(to.getAttribute("aria-invalid"), "true");
    assert.ok(from.getAttribute("aria-describedby"));
    await type(to, "2026-11-12");
    assert.equal(alert(), "");
    assert.equal(root.querySelector("[aria-invalid='true']"), null);
  });

  it("die Datumsauswahl des Geräts begrenzt sich selbst: Ende nicht vor Beginn, Beginn nicht nach Ende (min/max)", async () => {
    const { from, to } = await mountRange({ defaultFrom: "2026-11-10", defaultTo: "2026-11-20" });
    assert.equal(to.min, "2026-11-10");
    assert.equal(from.max, "2026-11-20");
  });

  it("zu langer Zeitraum nennt die Grenze; ein einzelnes Ende ist nur bei Pflicht ein Fehler", async () => {
    const { alert, to } = await mountRange({ defaultFrom: "2026-01-01", defaultTo: "2026-12-31", maxDays: 92 });
    assert.equal(alert(), "Der Zeitraum ist zu lang (höchstens 92 Tage).");
    await type(to, "2026-02-01");
    assert.equal(alert(), "");
    await view?.unmount();
    assert.equal((await mountRange({ defaultFrom: "2026-11-01" })).alert(), "", "ein einzelnes Ende ist als Filter zulässig");
    await view?.unmount();
    assert.equal((await mountRange({ defaultFrom: "2026-11-01", required: true })).alert(), "Bitte Beginn und Ende angeben.");
  });

  it("englisch", async () => {
    const { root } = await mountRange({ today: "2026-11-07" }, "en");
    assert.ok(byText(root, "button", /^Last 30 days$/));
    assert.match(plain(root.querySelector("legend")?.textContent), /Period/);
  });
});
