import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOWN_AFTER, RETRY_SECONDS, STALE_INTERVALS, availability, classifyHttpStatus, compactSamples, deviceStatus, hourStart, isStale, nextState, viewOf, type StateStep } from "./model";

/** Feste Uhr: nie die reale Zeit. */
const T0 = new Date("2026-03-10T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("HTTP-Statuszeile → Klasse", () => {
  it("2xx/3xx/4xx = erreichbar, 5xx = erreichbar mit Warnung, alles andere keine gültige Antwort", () => {
    assert.deepEqual(classifyHttpStatus(200), { ok: true, warn: false, statusClass: "2xx" });
    assert.deepEqual(classifyHttpStatus(204), { ok: true, warn: false, statusClass: "2xx" });
    assert.deepEqual(classifyHttpStatus(301), { ok: true, warn: false, statusClass: "3xx" });
    assert.deepEqual(classifyHttpStatus(302), { ok: true, warn: false, statusClass: "3xx" });
    assert.deepEqual(classifyHttpStatus(404), { ok: true, warn: false, statusClass: "4xx" });
    assert.deepEqual(classifyHttpStatus(503), { ok: true, warn: true, statusClass: "5xx" });
    for (const odd of [0, 99, 100, 199, 600, 999]) assert.deepEqual(classifyHttpStatus(odd), { ok: false, warn: false, statusClass: "protocol" }, String(odd));
  });
});

describe("Entprellung (Zustandsmaschine)", () => {
  const step = (state: StateStep["state"], failStreak = 0): StateStep => ({ state, failStreak });

  it("erste Messung: Erfolg → Auf, Warnung → Warnung; ein erster Fehlschlag macht noch kein „Ab“", () => {
    assert.deepEqual(nextState(step("unknown"), { ok: true, warn: false }, 300), { state: "up", failStreak: 0, event: null, nextInSeconds: 300 });
    assert.deepEqual(nextState(step("unknown"), { ok: true, warn: true }, 300), { state: "warn", failStreak: 0, event: null, nextInSeconds: 300 });
    assert.deepEqual(nextState(step("unknown"), { ok: false, warn: false }, 300), { state: "unknown", failStreak: 1, event: null, nextInSeconds: RETRY_SECONDS });
  });

  it("ein einzelner Fehlschlag ändert den bisherigen Zustand nicht; erst der zweite in Folge meldet „Ab“ samt Ausfall-Ereignis", () => {
    const first = nextState(step("up"), { ok: false, warn: false }, 300);
    assert.deepEqual(first, { state: "up", failStreak: 1, event: null, nextInSeconds: RETRY_SECONDS });
    const second = nextState(first, { ok: false, warn: false }, 300);
    assert.equal(DOWN_AFTER, 2);
    assert.deepEqual(second, { state: "down", failStreak: 2, event: "down", nextInSeconds: RETRY_SECONDS });
    // ab dann weiter im normalen Takt, ohne neues Ereignis
    const third = nextState(second, { ok: false, warn: false }, 300);
    assert.deepEqual(third, { state: "down", failStreak: 3, event: null, nextInSeconds: 300 });
  });

  it("ein Erfolg zwischen zwei Fehlschlägen setzt die Zählung zurück (kein Ausfall)", () => {
    const a = nextState(step("up"), { ok: false, warn: false }, 300);
    const b = nextState(a, { ok: true, warn: false }, 300);
    const c = nextState(b, { ok: false, warn: false }, 300);
    assert.deepEqual([b.state, b.failStreak, c.state, c.failStreak, c.event], ["up", 0, "up", 1, null]);
  });

  it("Wiederkehr aus „Ab“ erzeugt das Ereignis „up“ (auch mit Warnung); aus „Warnung“ nach „Auf“ nicht", () => {
    assert.equal(nextState(step("down", 4), { ok: true, warn: false }, 300).event, "up");
    assert.deepEqual(nextState(step("down", 4), { ok: true, warn: true }, 300), { state: "warn", failStreak: 0, event: "up", nextInSeconds: 300 });
    assert.equal(nextState(step("warn"), { ok: true, warn: false }, 300).event, null);
  });

  it("das erneute Prüfen nach einem Fehlschlag wartet nie länger als das Intervall", () => {
    assert.equal(nextState(step("up"), { ok: false, warn: false }, 60).nextInSeconds, 60);
    assert.equal(nextState(step("up"), { ok: false, warn: false }, 3600).nextInSeconds, RETRY_SECONDS);
  });
});

describe("Veraltet und Anzeigezustand", () => {
  it("nie gemessen oder älter als drei Intervalle = veraltet; genau drei Intervalle noch nicht", () => {
    assert.equal(STALE_INTERVALS, 3);
    assert.equal(isStale(null, 300, T0), true);
    assert.equal(isStale(at(-900), 300, T0), false);
    assert.equal(isStale(at(-901), 300, T0), true);
  });

  it("viewOf: frisch → der gemessene Zustand; veraltet → unbekannt mit stale; nie gemessen → unbekannt ohne stale; unbekannte Werte → unbekannt", () => {
    const t = { state: "up", lastCheckAt: at(-60), intervalSec: 300 };
    assert.deepEqual(viewOf(t, T0), { state: "up", stale: false });
    assert.deepEqual(viewOf({ ...t, lastCheckAt: at(-1000) }, T0), { state: "unknown", stale: true });
    assert.deepEqual(viewOf({ ...t, state: "down", lastCheckAt: at(-1000) }, T0), { state: "unknown", stale: true }, "auch ein alter Ausfall wird nicht als aktuell behauptet");
    assert.deepEqual(viewOf({ ...t, lastCheckAt: null }, T0), { state: "unknown", stale: false });
    assert.deepEqual(viewOf({ ...t, state: "unknown" }, T0), { state: "unknown", stale: false });
    assert.deepEqual(viewOf({ ...t, state: "kaputt" }, T0), { state: "unknown", stale: false });
  });
});

describe("Gerätestatus aus mehreren Zielen", () => {
  const target = (state: string, ageSeconds: number, latency: number | null = 10, intervalSec = 300) => ({ state, lastCheckAt: at(-ageSeconds), lastLatencyMs: latency, intervalSec });

  it("ohne Ziel: unbekannt (nie ein erfundener Wert)", () => {
    assert.deepEqual(deviceStatus([], T0), { state: "unknown", latencyMs: null, checkedAt: null, stale: false, targets: 0 });
  });

  it("alle erreichbar → online mit mittlerer Latenz; alle „Ab“ → offline; gemischt oder Warnung → eingeschränkt", () => {
    const online = deviceStatus([target("up", 10, 10), target("up", 20, 21)], T0);
    assert.deepEqual([online.state, online.latencyMs, online.stale], ["online", 16, false]);
    assert.equal(deviceStatus([target("down", 10, null), target("down", 10, null)], T0).state, "offline");
    assert.equal(deviceStatus([target("up", 10), target("down", 10, null)], T0).state, "degraded");
    assert.equal(deviceStatus([target("up", 10), target("warn", 10)], T0).state, "degraded");
    assert.equal(deviceStatus([target("warn", 10)], T0).state, "degraded");
  });

  it("veraltete Messungen zählen nicht: sind alle veraltet, ist der Zustand unbekannt (stale), nie grün", () => {
    const stale = deviceStatus([target("up", 5000)], T0);
    assert.deepEqual([stale.state, stale.stale, stale.latencyMs], ["unknown", true, null]);
    assert.ok(stale.checkedAt);
    // nur die frischen zählen
    assert.equal(deviceStatus([target("up", 5000), target("down", 10, null)], T0).state, "offline");
    // noch nie gemessen: unbekannt, aber nicht „veraltet“
    const never = deviceStatus([{ state: "unknown", lastCheckAt: null, lastLatencyMs: null, intervalSec: 300 }], T0);
    assert.deepEqual([never.state, never.stale, never.targets], ["unknown", false, 1]);
  });
});

describe("Verdichtung zu Stundenwerten", () => {
  it("Stundenbeginn in UTC", () => {
    assert.equal(hourStart(new Date("2026-03-10T10:59:59.999Z")).toISOString(), "2026-03-10T10:00:00.000Z");
    assert.equal(hourStart(new Date("2026-03-10T11:00:00.000Z")).toISOString(), "2026-03-10T11:00:00.000Z");
  });

  it("zählt Messungen und Fehlschläge, Latenz nur erfolgreicher Messungen (Summe, Anzahl, Maximum), sortiert nach Stunde", () => {
    const buckets = compactSamples([
      { at: new Date("2026-03-10T11:10:00Z"), ok: true, latencyMs: 40 },
      { at: new Date("2026-03-10T10:05:00Z"), ok: true, latencyMs: 10 },
      { at: new Date("2026-03-10T10:10:00Z"), ok: false, latencyMs: null },
      { at: new Date("2026-03-10T10:15:00Z"), ok: true, latencyMs: 30 },
    ]);
    assert.deepEqual(
      buckets.map((b) => ({ hour: b.hour.toISOString(), checks: b.checks, failures: b.failures, sum: b.latencySumMs, n: b.latencyCount, max: b.latencyMaxMs })),
      [
        { hour: "2026-03-10T10:00:00.000Z", checks: 3, failures: 1, sum: 40, n: 2, max: 30 },
        { hour: "2026-03-10T11:00:00.000Z", checks: 1, failures: 0, sum: 40, n: 1, max: 40 },
      ],
    );
    assert.deepEqual(compactSamples([]), []);
  });

  it("Verfügbarkeit in Prozent mit einer Nachkommastelle; ohne Messungen nichts", () => {
    assert.equal(availability(0, 0), null);
    assert.equal(availability(1000, 1), 99.9);
    assert.equal(availability(3, 1), 66.7);
    assert.equal(availability(10, 0), 100);
  });
});
