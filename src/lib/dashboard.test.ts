import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DASHBOARD_VISIBLE, checklistProgress, pickWidgets } from "./dashboard";

const w = (id: string, priority: number, order: number) => ({ id, priority, order });

describe("pickWidgets (4 sichtbar, Rest zugeklappt)", () => {
  it("die vier wichtigsten stehen offen (Anzeige nach order), der Rest nach Wichtigkeit zugeklappt", () => {
    const list = [w("a", 50, 1), w("b", 10, 5), w("c", 20, 3), w("d", 30, 4), w("e", 5, 9), w("f", 60, 2)];
    const { shown, more } = pickWidgets(list);
    assert.equal(DASHBOARD_VISIBLE, 4);
    assert.deepEqual(shown.map((x) => x.id), ["c", "d", "b", "e"]);
    assert.deepEqual(more.map((x) => x.id), ["a", "f"]);
  });
  it("Gleichstand: order, dann ID; weniger als vier: alles offen, nichts zugeklappt", () => {
    assert.deepEqual(pickWidgets([w("x", 1, 2), w("y", 1, 1)]).shown.map((x) => x.id), ["y", "x"]);
    assert.deepEqual(pickWidgets([w("x", 1, 2), w("y", 1, 1)]).more, []);
    assert.deepEqual(pickWidgets([w("b", 1, 1), w("a", 1, 1), w("c", 1, 1)], 1).shown.map((x) => x.id), ["a"]);
  });
  it("leer bleibt leer", () => {
    assert.deepEqual(pickWidgets([]), { shown: [], more: [] });
  });
});

describe("checklistProgress", () => {
  it("zählt erledigte Punkte, nennt offene (Pflicht vor Empfehlung) und erkennt „alles erledigt“", () => {
    const items = [
      { id: "a", done: true, recommended: false },
      { id: "b", done: false, recommended: true },
      { id: "c", done: false, recommended: false },
    ];
    const progress = checklistProgress(items);
    assert.deepEqual([progress.done, progress.total, progress.complete], [1, 3, false]);
    assert.deepEqual(progress.open.map((i) => i.id), ["c", "b"]);
    assert.equal(checklistProgress(items.map((i) => ({ ...i, done: true }))).complete, true);
    assert.equal(checklistProgress([]).complete, false, "keine Punkte ist nicht „erledigt“");
  });
});
