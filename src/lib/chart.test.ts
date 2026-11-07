import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutChart, niceScale, seriesColorIndex } from "./chart";

describe("niceScale", () => {
  it("runde Schritte (1, 2, 5 × 10ⁿ), Bereich umschließt die Daten, Null bei Balken immer dabei", () => {
    assert.deepEqual(niceScale(0, 97).ticks, [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceScale(12, 87).ticks, [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceScale(0, 1).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
    const money = niceScale(0, 12_345_00);
    assert.ok(money.max >= 12_345_00 && money.min === 0);
    assert.ok(money.ticks.length >= 3 && money.ticks.length <= 8, `${money.ticks.length} Teilstriche`);
  });

  it("negative Werte: Null liegt im Bereich", () => {
    const s = niceScale(-35, 80);
    assert.ok(s.min <= -35 && s.max >= 80);
    assert.ok(s.ticks.includes(0));
  });

  it("Linien dürfen ohne Null beginnen (includeZero = false)", () => {
    const s = niceScale(1000, 1040, 5, false);
    assert.ok(s.min > 0 && s.min <= 1000 && s.max >= 1040);
  });

  it("gleiche Werte, keine Werte und unendliche Werte teilen nie durch null", () => {
    for (const s of [niceScale(5, 5), niceScale(0, 0), niceScale(Infinity, -Infinity), niceScale(NaN, NaN), niceScale(7, 7, 5, false)]) {
      assert.ok(s.ticks.length >= 2 && s.max > s.min && Number.isFinite(s.step) && s.step > 0, JSON.stringify(s));
    }
  });

  it("Kommazahlen ohne Gleitkommareste", () => {
    for (const t of niceScale(0, 0.7).ticks) assert.equal(String(t).length < 8, true, String(t));
  });
});

describe("layoutChart: Balken", () => {
  const input = { type: "bar" as const, categories: ["Jan", "Feb", "Mär"], series: [{ id: "a", label: "A", values: [10, 20, 30] }, { id: "b", label: "B", values: [5, null, 15] }] };

  it("ein Balken je vorhandenem Wert; Höhe proportional; Balken stehen auf der Nulllinie; innerhalb des Zeichenbereichs", () => {
    const layout = layoutChart(input);
    assert.equal(layout.bars.length, 5);
    for (const bar of layout.bars) {
      assert.ok(bar.x >= layout.plot.left && bar.x + bar.width <= layout.plot.right + 0.001);
      assert.ok(bar.y >= layout.plot.top - 0.001 && bar.y + bar.height <= layout.plot.bottom + 0.001);
      assert.ok(Math.abs(bar.y + bar.height - layout.zeroY) < 0.001, "positive Balken enden auf der Nulllinie");
    }
    const [a1, a2] = layout.bars.filter((b) => b.series === 0);
    assert.ok(Math.abs(a2.height / a1.height - 2) < 0.001, "20 ist doppelt so hoch wie 10");
  });

  it("Reihen einer Kategorie stehen nebeneinander, ohne sich zu überlappen", () => {
    const layout = layoutChart(input);
    const first = layout.bars.filter((b) => b.category === 0).sort((a, b) => a.x - b.x);
    assert.equal(first.length, 2);
    assert.ok(first[0].x + first[0].width <= first[1].x + 0.001);
  });

  it("negative Balken hängen unter der Nulllinie", () => {
    const layout = layoutChart({ type: "bar", categories: ["a", "b"], series: [{ id: "x", label: "X", values: [-10, 10] }] });
    const [neg, pos] = layout.bars;
    assert.ok(Math.abs(neg.y - layout.zeroY) < 0.001);
    assert.ok(Math.abs(pos.y + pos.height - layout.zeroY) < 0.001);
  });

  it("Beschriftungen der Kategorien werden ausgedünnt, wenn sie nicht nebeneinander passen", () => {
    const many = Array.from({ length: 36 }, (_, i) => `Kalenderwoche ${i + 1}`);
    const layout = layoutChart({ type: "bar", categories: many, series: [{ id: "a", label: "A", values: many.map((_, i) => i) }] });
    const shown = layout.categories.filter((c) => c.show);
    assert.ok(shown.length < many.length && shown.length >= 2);
    for (let i = 1; i < shown.length; i++) assert.ok(shown[i].x - shown[i - 1].x >= "Kalenderwoche 36".length * 6.4, "gezeigte Beschriftungen überlappen nicht");
    assert.ok(layoutChart({ type: "bar", categories: ["a", "b"], series: [] }).categories.every((c) => c.show));
  });

  it("leere Reihen, null Kategorien: kein Absturz, keine Balken", () => {
    const empty = layoutChart({ type: "bar", categories: [], series: [] });
    assert.deepEqual([empty.bars.length, empty.lines.length], [0, 0]);
  });
});

describe("layoutChart: Linien", () => {
  it("ein Pfad je Reihe; fehlende Werte unterbrechen die Linie; Punkte nur für vorhandene Werte", () => {
    const layout = layoutChart({ type: "line", categories: ["a", "b", "c", "d"], series: [{ id: "x", label: "X", values: [1, 2, null, 4] }] });
    const [line] = layout.lines;
    assert.equal(line.points.length, 3);
    assert.equal((line.path.match(/M/g) ?? []).length, 2, "zwei Teilstücke");
    assert.equal((line.path.match(/L/g) ?? []).length, 1);
    assert.ok(line.points.every((p) => p.y >= layout.plot.top - 0.001 && p.y <= layout.plot.bottom + 0.001));
    assert.ok(line.points[0].y > line.points[1].y, "höherer Wert liegt weiter oben");
  });

  it("Platz links wächst mit der Länge der Teilstrich-Beschriftung (kein abgeschnittener Betrag)", () => {
    const short = layoutChart({ type: "line", categories: ["a"], series: [{ id: "x", label: "X", values: [1] }] });
    const long = layoutChart({ type: "line", categories: ["a"], series: [{ id: "x", label: "X", values: [1] }], formatTick: (v) => `${v.toFixed(2)} €` });
    assert.ok(long.plot.left > short.plot.left);
  });
});

describe("Farben", () => {
  it("Reihe 1…6 bekommen die Tokens 1…6, weitere teilen sich das neutrale sechste", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(seriesColorIndex), [1, 2, 3, 4, 5, 6, 6, 6]);
  });
});

describe("niceScale für Anzahlen (integer)", () => {
  it("teilt nur bei ganzen Zahlen: 0 bis 1 ergibt 0 und 1, nie 0,2 oder 0,5", () => {
    assert.deepEqual(niceScale(0, 1, 5, true, true).ticks, [0, 1]);
    assert.deepEqual(niceScale(0, 3, 5, true, true).ticks, [0, 1, 2, 3]);
    assert.ok(niceScale(0, 1, 5, true, false).ticks.some((tick) => !Number.isInteger(tick)), "ohne integer teilt die Achse fein");
    const big = niceScale(0, 47, 5, true, true);
    assert.ok(big.ticks.every(Number.isInteger) && big.step >= 1);
  });
});
