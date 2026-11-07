import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain } from "@/test/ui";

/** Diagramm: Marken je Wert, Werte ohne Hover sichtbar, Tabellen-Alternative, Tokenfarben, leerer Zustand. */
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

const euro = (cents: number) => `${(cents / 100).toFixed(0)} €`;
const MONTHS = ["Aug", "Sep", "Okt", "Nov"];

async function mountChart(props: Record<string, unknown>, locale: "de" | "en" = "de") {
  const { Chart } = await import("./chart");
  view = await mountI18n(createElement(Chart, { title: "Umsatz je Monat", categories: MONTHS, formatValue: euro, ...props } as never), locale);
  return view.container;
}

describe("Chart", () => {
  it("Balken: ein Rechteck je Wert, Werte stehen am Balken (ohne Hover), die Grafik hat Namen und Beschreibung", async () => {
    const root = await mountChart({ type: "bar", series: [{ id: "a", label: "Umsatz", values: [120000, 150000, 90000, 180000] }] });
    const svg = root.querySelector("svg") as SVGElement;
    assert.equal(svg.getAttribute("role"), "img");
    const name = (svg.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => root.querySelector(`[id="${id}"]`)?.textContent);
    assert.equal(name[0], "Umsatz je Monat");
    assert.match(name[1] ?? "", /Balkendiagramm: 1 Reihen, 4 Werte/);
    const bars = svg.querySelectorAll("rect");
    assert.equal(bars.length, 4);
    for (const bar of bars) assert.match(bar.getAttribute("class") ?? "", /fill-chart-1/);
    for (const text of ["1200 €", "1500 €", "900 €", "1800 €"]) assert.ok(Array.from(svg.querySelectorAll("text")).some((t) => t.textContent === text), `${text} steht als Beschriftung da`);
    assert.ok(svg.querySelector("rect > title")?.textContent?.includes("Umsatz, Aug: 1200 €"), "Tooltip zusätzlich");
    // höherer Wert = höherer Balken
    const heights = Array.from(bars).map((b) => Number(b.getAttribute("height")));
    assert.ok(heights[3] > heights[1] && heights[1] > heights[0] && heights[0] > heights[2]);
  });

  it("mehrere Reihen bekommen die Tokenfarben der Reihe nach und eine Legende; Linien tragen verschiedene Marken (nicht nur Farbe)", async () => {
    const root = await mountChart({
      type: "line",
      series: [
        { id: "a", label: "2025", values: [10, 20, 15, 30] },
        { id: "b", label: "2026", values: [12, 18, null, 28] },
      ],
    });
    const paths = Array.from(root.querySelectorAll("svg path"));
    assert.equal(paths.length, 2);
    assert.match(paths[0].getAttribute("class") ?? "", /stroke-chart-1/);
    assert.match(paths[1].getAttribute("class") ?? "", /stroke-chart-2/);
    assert.equal(root.querySelectorAll("svg[role='img'] circle").length, 4, "Reihe 1: Kreise");
    assert.equal(root.querySelectorAll("svg[role='img'] g > rect").length, 3, "Reihe 2: Quadrate, ein Wert fehlt");
    assert.equal(root.querySelectorAll("ul[aria-label='Legende'] svg").length, 2, "die Legende zeigt dieselben Marken");
    const legend = Array.from(root.querySelectorAll("ul[aria-label='Legende'] li")).map((li) => plain(li.textContent));
    assert.deepEqual(legend, ["2025", "2026"]);
  });

  it("Tabellen-Alternative: dieselben Werte als Tabelle mit Beschriftung, fehlende Werte als Strich, und zurück", async () => {
    const root = await mountChart({ type: "line", series: [{ id: "a", label: "Umsatz", values: [100, null, 300, 400] }] });
    await click(byText(root, "button", /Als Tabelle/));
    assert.equal(root.querySelector("svg"), null);
    const table = root.querySelector("table");
    assert.ok(table);
    assert.equal(plain(table.querySelector("caption")?.textContent), "Umsatz je Monat");
    const cells = Array.from(table.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("th,td")).map((c) => plain(c.textContent)));
    assert.deepEqual(cells, [["Aug", "1 €"], ["Sep", "–"], ["Okt", "3 €"], ["Nov", "4 €"]]);
    assert.equal(byText(root, "button", /Als Diagramm/)?.getAttribute("aria-pressed"), "true");
    await click(byText(root, "button", /Als Diagramm/));
    assert.ok(root.querySelector("svg"));
  });

  it("ohne Daten: freundlicher Hinweis statt leerer Grafik", async () => {
    assert.match(plain((await mountChart({ type: "bar", series: [] })).textContent), /Keine Daten/);
    await view?.unmount();
    assert.match(plain((await mountChart({ type: "bar", series: [{ id: "a", label: "A", values: [null, null, null, null] }] })).textContent), /Keine Daten/);
    await view?.unmount();
    assert.match(plain((await mountChart({ type: "bar", categories: [], series: [{ id: "a", label: "A", values: [] }] })).textContent), /Keine Daten/);
  });

  it("viele Balken: keine Wertbeschriftung (zu eng), die Tabelle bleibt der Weg zu den Zahlen; englische Texte", async () => {
    const categories = Array.from({ length: 12 }, (_, i) => `M${i}`);
    const root = await mountChart({ type: "bar", categories, series: [{ id: "a", label: "A", values: categories.map((_, i) => i * 10) }, { id: "b", label: "B", values: categories.map((_, i) => i * 5) }] }, "en");
    assert.equal(root.querySelectorAll("svg rect").length, 24);
    assert.equal(Array.from(root.querySelectorAll("svg text")).filter((t) => /^\d+ €$/.test(t.textContent ?? "") && !t.getAttribute("text-anchor")?.includes("end")).length, 0);
    assert.ok(byText(root, "button", /As table/));
  });

  it("Farben sind die Tokens (Hell und Dunkel stecken in den Tokens), keine Rohwerte im Baustein", async () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/ui/chart.tsx"), "utf8");
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    const globals = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    for (let i = 1; i <= 6; i++) assert.match(globals, new RegExp(`--color-chart-${i}: var\\(--chart-${i}\\)`));
  });
});
