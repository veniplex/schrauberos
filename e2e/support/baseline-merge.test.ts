import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertGrowthAllowed, budgetFor, mergeBaseline, mergeBudget, type Baseline } from "./baseline-merge";

/** Die Regel „Baseline-Listen und JS-Budgets dürfen nur schrumpfen“ wird beim Neuschreiben erzwungen (Browser-CI, e2e/global-teardown.ts). */
const old: Baseline = {
  iphone: { overflow: { "/a": ["div", "form"], "/b": ["table"] }, touch: { "/a": ["a.x"] } },
  desktop: { "axe-light": { "/a": ["label"] } },
};

describe("Baseline neu schreiben", () => {
  it("ein Teillauf ändert nur die geprüften Seiten und löscht nichts anderes", () => {
    const { next, growth } = mergeBaseline(old, [{ project: "iphone", rule: "overflow", pageKey: "/a", found: ["div"] }]);
    assert.deepEqual(next.iphone.overflow, { "/a": ["div"], "/b": ["table"] });
    assert.deepEqual(next.iphone.touch, { "/a": ["a.x"] });
    assert.deepEqual(next.desktop, old.desktop);
    assert.deepEqual(growth, []);
  });

  it("erledigte Einträge verschwinden samt leerer Regeln und Projekte", () => {
    const { next, growth } = mergeBaseline(old, [
      { project: "desktop", rule: "axe-light", pageKey: "/a", found: [] },
      { project: "iphone", rule: "touch", pageKey: "/a", found: [] },
    ]);
    assert.equal("desktop" in next, false);
    assert.equal("touch" in next.iphone, false);
    assert.deepEqual(growth, []);
  });

  it("neue Verstöße gelten als Wachstum – auch bei einer neuen Seite oder Regel", () => {
    const { growth } = mergeBaseline(old, [
      { project: "iphone", rule: "overflow", pageKey: "/a", found: ["div", "form", "section"] },
      { project: "iphone", rule: "font", pageKey: "/c", found: ["input"] },
    ]);
    assert.equal(growth.length, 2);
    assert.match(growth[0], /iphone \/ overflow \/ \/a: neu section/);
  });

  it("das Original wird nicht verändert", () => {
    const copy = JSON.parse(JSON.stringify(old)) as Baseline;
    mergeBaseline(old, [{ project: "iphone", rule: "overflow", pageKey: "/a", found: [] }]);
    assert.deepEqual(old, copy);
  });
});

describe("JS-Budget neu schreiben", () => {
  it("Messung + 10 %, auf 5 KB aufgerundet", () => {
    assert.equal(budgetFor(100), 110);
    assert.equal(budgetFor(101), 115);
  });

  it("ein Budget darf sinken, aber nicht steigen; neue Routen bekommen ihr Budget", () => {
    const { next, growth } = mergeBudget({ "/a": 200, "/b": 100 }, { "/a": 150, "/b": 120, "/neu": 50 });
    assert.equal(next["/a"], 165);
    assert.equal(next["/b"], 135);
    assert.equal(next["/neu"], 55);
    assert.deepEqual(growth, ["JS-Budget /b: 100 KB -> 135 KB"]);
  });

  it("nicht gemessene Routen behalten ihr Budget", () => {
    assert.deepEqual(mergeBudget({ "/a": 200, "/b": 100 }, { "/a": 100 }).next, { "/a": 110, "/b": 100 });
  });
});

describe("Wachstum nur mit Begründung", () => {
  it("ohne Wachstum immer erlaubt", () => assert.doesNotThrow(() => assertGrowthAllowed([], undefined)));
  it("mit Wachstum ohne oder mit zu kurzer Begründung Abbruch, mit Begründung erlaubt", () => {
    const growth = ["iphone / overflow / /a: neu div"];
    assert.throws(() => assertGrowthAllowed(growth, undefined), /nur schrumpfen/);
    assert.throws(() => assertGrowthAllowed(growth, "kurz"), /nur schrumpfen/);
    assert.throws(() => assertGrowthAllowed(growth, "   "), /nur schrumpfen/);
    assert.doesNotThrow(() => assertGrowthAllowed(growth, "Neue Seite /a, Fix folgt in Paket 6"));
  });
});
