import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assignLanes } from "./calendar-layout";

type Ev = { id: string; s: number; e: number };
const range = (x: Ev): [number, number] => [x.s, x.e];
const run = (events: Ev[]) => Object.fromEntries(assignLanes(events, range).map((p) => [p.item.id, [p.lane, p.lanes]]));

describe("assignLanes", () => {
  test("nacheinander: jeweils eine Spur", () => {
    assert.deepEqual(run([{ id: "a", s: 0, e: 60 }, { id: "b", s: 60, e: 120 }]), { a: [0, 1], b: [0, 1] });
  });
  test("Überlappung: nebeneinander", () => {
    assert.deepEqual(run([{ id: "a", s: 0, e: 90 }, { id: "b", s: 60, e: 120 }]), { a: [0, 2], b: [1, 2] });
  });
  test("Spur wird wiederverwendet, Gruppen sind unabhängig", () => {
    const r = run([
      { id: "a", s: 0, e: 60 },
      { id: "b", s: 30, e: 90 },
      { id: "c", s: 60, e: 120 }, // passt in Spur von a
      { id: "d", s: 300, e: 360 }, // eigene Gruppe
    ]);
    assert.deepEqual(r, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
  test("leere Liste", () => {
    assert.deepEqual(assignLanes([], range), []);
  });
});
