import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { resetWorkshopZone, setWorkshopZone, instantOf } from "@/lib/zone";
import { assignLanes, eventSpan, eventSpanOnDay, initialSlot, moveSlot, overlapsDay } from "./calendar-layout";

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

describe("eventSpan", () => {
  const at = (h: number, m = 0, day = 5) => new Date(2030, 4, day, h, m);
  test("Beginn und Ende in Minuten", () => {
    assert.deepEqual(eventSpan(at(8), at(9, 30), 30), [480, 570]);
  });
  test("ein kurzer Termin belegt mindestens einen Rasterschritt (mindestens 15 Minuten)", () => {
    assert.deepEqual(eventSpan(at(8), at(8, 10), 30), [480, 510]);
    assert.deepEqual(eventSpan(at(8), at(8, 10), 5), [480, 495], "nie unter 15");
    assert.deepEqual(eventSpan(at(8), at(8), 15), [480, 495], "Ende = Beginn");
  });
  test("zwei kurze Termine hintereinander bekommen eigene Spuren nur, wenn sie sich überlappen würden – mit Rasterschritt nie", () => {
    const events = [{ s: at(8), e: at(8, 10) }, { s: at(8, 30), e: at(8, 40) }];
    const lanes = assignLanes(events, (x) => eventSpan(x.s, x.e, 30));
    assert.deepEqual(lanes.map((p) => [p.lane, p.lanes]), [[0, 1], [0, 1]]);
  });
  test("endet am Folgetag: bis Mitternacht", () => {
    assert.deepEqual(eventSpan(at(22), at(2, 0, 6), 30), [1320, 1440]);
  });
});

describe("moveSlot", () => {
  const size = { cols: 3, rows: 10 };
  test("Pfeiltasten bewegen um einen Schritt", () => {
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "ArrowDown", size), { col: 1, row: 5 });
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "ArrowUp", size), { col: 1, row: 3 });
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "ArrowRight", size), { col: 2, row: 4 });
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "ArrowLeft", size), { col: 0, row: 4 });
  });
  test("am Rand bleibt es stehen (null: nichts bewegt sich)", () => {
    assert.equal(moveSlot({ col: 0, row: 0 }, "ArrowUp", size), null);
    assert.equal(moveSlot({ col: 0, row: 0 }, "ArrowLeft", size), null);
    assert.equal(moveSlot({ col: 2, row: 9 }, "ArrowDown", size), null);
    assert.equal(moveSlot({ col: 2, row: 9 }, "ArrowRight", size), null);
  });
  test("Bild auf/ab, Pos1 und Ende springen in der Spalte und halten am Rand", () => {
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "PageDown", size), { col: 1, row: 8 });
    assert.deepEqual(moveSlot({ col: 1, row: 8 }, "PageDown", size), { col: 1, row: 9 });
    assert.deepEqual(moveSlot({ col: 1, row: 2 }, "PageUp", size), { col: 1, row: 0 });
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "Home", size), { col: 1, row: 0 });
    assert.deepEqual(moveSlot({ col: 1, row: 4 }, "End", size), { col: 1, row: 9 });
  });
  test("andere Tasten tun nichts", () => {
    assert.equal(moveSlot({ col: 1, row: 4 }, "a", size), null);
    assert.equal(moveSlot({ col: 1, row: 4 }, "Enter", size), null);
  });
});

describe("initialSlot", () => {
  const days = [1, 2, 3].map((d) => new Date(2030, 4, d));
  test("heute im Raster: das jetzige Zeitfenster dieses Tages", () => {
    assert.deepEqual(initialSlot({ days, now: new Date(2030, 4, 2, 10, 20), startMin: 8 * 60, slotMinutes: 30, rows: 20 }), { col: 1, row: 4 });
  });
  test("vor dem Raster und nach dem Raster: erste bzw. letzte Zeile", () => {
    assert.deepEqual(initialSlot({ days, now: new Date(2030, 4, 2, 6), startMin: 8 * 60, slotMinutes: 30, rows: 20 }), { col: 1, row: 0 });
    assert.deepEqual(initialSlot({ days, now: new Date(2030, 4, 2, 23), startMin: 8 * 60, slotMinutes: 30, rows: 20 }), { col: 1, row: 19 });
  });
  test("heute nicht sichtbar: erstes Zeitfenster der ersten Spalte", () => {
    assert.deepEqual(initialSlot({ days, now: new Date(2030, 5, 9, 10), startMin: 8 * 60, slotMinutes: 30, rows: 20 }), { col: 0, row: 0 });
  });
});

describe("Termine über Mitternacht (P4b-1)", () => {
  afterEach(() => resetWorkshopZone());
  const berlin = (month: number, day: number, hour: number, minute = 0) => {
    setWorkshopZone("Europe/Berlin");
    return instantOf(2030, month, day, hour, minute, 0, 0, "Europe/Berlin");
  };

  test("ein Termin 22:00–02:00 gehört zu beiden Tagen, nicht zum übernächsten", () => {
    const a = { startsAt: berlin(5, 5, 22), endsAt: berlin(5, 6, 2) };
    assert.equal(overlapsDay(a, "2030-05-05"), true);
    assert.equal(overlapsDay(a, "2030-05-06"), true);
    assert.equal(overlapsDay(a, "2030-05-04"), false);
    assert.equal(overlapsDay(a, "2030-05-07"), false);
  });

  test("ein Termin bis genau 00:00 Uhr gehört nicht zum Folgetag", () => {
    const a = { startsAt: berlin(5, 5, 22), endsAt: berlin(5, 6, 0) };
    assert.equal(overlapsDay(a, "2030-05-05"), true);
    assert.equal(overlapsDay(a, "2030-05-06"), false);
    assert.deepEqual(eventSpanOnDay(a.startsAt, a.endsAt, "2030-05-05", 30), [1320, 1440]);
  });

  test("Lage je Tag: am Starttag bis 24:00, am Folgetag ab 0:00 bis zum Ende; ein kurzer Rest ist mindestens einen Rasterschritt hoch", () => {
    const start = berlin(5, 5, 22);
    assert.deepEqual(eventSpanOnDay(start, berlin(5, 6, 2), "2030-05-05", 30), [1320, 1440]);
    assert.deepEqual(eventSpanOnDay(start, berlin(5, 6, 2), "2030-05-06", 30), [0, 120]);
    assert.deepEqual(eventSpanOnDay(start, berlin(5, 6, 0, 5), "2030-05-06", 30), [0, 30]);
  });

  test("über drei Tage: der mittlere Tag ist ganz belegt", () => {
    const a = { startsAt: berlin(5, 5, 20), endsAt: berlin(5, 7, 8) };
    assert.deepEqual(eventSpanOnDay(a.startsAt, a.endsAt, "2030-05-06", 30), [0, 1440]);
    assert.equal(overlapsDay(a, "2030-05-06"), true);
  });

  test("Sommerzeit-Nacht: 30.3. 22:00 bis 31.3. 09:00 Ortszeit (Tag mit 23 Stunden) endet am Folgetag um 9:00 der Wanduhr", () => {
    const start = berlin(3, 30, 22);
    const end = berlin(3, 31, 9);
    assert.equal((end.getTime() - start.getTime()) / 3_600_000, 10, "zehn echte Stunden, elf auf der Wanduhr");
    assert.deepEqual(eventSpanOnDay(start, end, "2030-03-31", 30), [0, 540]);
    assert.deepEqual(eventSpanOnDay(start, end, "2030-03-30", 30), [1320, 1440]);
  });

  test("Rückstellnacht: 26.10. 22:00 bis 27.10. 03:00 Ortszeit (Tag mit 25 Stunden)", () => {
    const start = berlin(10, 26, 22);
    const end = berlin(10, 27, 3);
    assert.deepEqual(eventSpanOnDay(start, end, "2030-10-27", 30), [0, 180]);
    assert.equal(overlapsDay({ startsAt: start, endsAt: end }, "2030-10-27"), true);
  });
});
