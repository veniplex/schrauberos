import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dependentsOf, effectiveFeatureIds, featureStatus, type FeatureLike, type ModuleLike } from "./catalog-logic";

const modules: ModuleLike[] = [{ id: "a" }, { id: "b" }, { id: "core", required: true }];
const features: FeatureLike[] = [
  { id: "x", module: "a" },
  { id: "y", module: "a", requires: ["a.x"] },
  { id: "z", module: "a", requires: ["a.y"] },
  { id: "p", module: "b" },
  { id: "q", module: "b", requires: ["a.x"] }, // modulübergreifend
  { id: "admin", module: "core", required: true },
];
const on = (o: Record<string, boolean> = {}) => [...effectiveFeatureIds(modules, features, o)].sort();

describe("effectiveFeatureIds", () => {
  test("ohne Einstellungen ist alles an", () => {
    assert.deepEqual(on(), ["a.x", "a.y", "a.z", "b.p", "b.q", "core.admin"]);
  });
  test("Modul aus: alle seine Funktionen fallen weg, Abhängige in anderen Modulen auch", () => {
    assert.deepEqual(on({ a: false }), ["b.p", "core.admin"]);
  });
  test("Funktion aus: Abhängige fallen (auch transitiv und modulübergreifend)", () => {
    assert.deepEqual(on({ "a.x": false }), ["b.p", "core.admin"]);
    assert.deepEqual(on({ "a.y": false }), ["a.x", "b.p", "b.q", "core.admin"]);
  });
  test("Wieder einschalten stellt Abhängige wieder her (Einstellungen der Abhängigen blieben unberührt)", () => {
    assert.deepEqual(on({ "a.x": true }), on());
  });
  test("Pflichtmodul und Pflichtfunktion lassen sich nicht abschalten", () => {
    assert.ok(on({ core: false, "core.admin": false }).includes("core.admin"));
  });
});

describe("featureStatus", () => {
  const st = (id: string, o: Record<string, boolean> = {}) => {
    const f = features.find((x) => `${x.module}.${x.id}` === id)!;
    return featureStatus(f, modules, features, o);
  };
  test("on / off / module-off", () => {
    assert.deepEqual(st("a.x"), { state: "on" });
    assert.deepEqual(st("a.x", { "a.x": false }), { state: "off" });
    assert.deepEqual(st("a.x", { a: false }), { state: "module-off" });
  });
  test("blocked nennt die fehlende Funktion", () => {
    assert.deepEqual(st("a.y", { "a.x": false }), { state: "blocked", missing: ["a.x"] });
    assert.deepEqual(st("b.q", { "a.x": false }), { state: "blocked", missing: ["a.x"] });
  });
  test("Pflichtfunktion bleibt on", () => assert.deepEqual(st("core.admin", { core: false }), { state: "on" }));
});

describe("dependentsOf", () => {
  test("direkt und transitiv", () => {
    assert.deepEqual(dependentsOf("a.x", features).sort(), ["a.y", "a.z", "b.q"]);
    assert.deepEqual(dependentsOf("a.y", features), ["a.z"]);
    assert.deepEqual(dependentsOf("b.p", features), []);
  });
});

describe("defaultEnabled (Standard aus für neue Funktionen)", () => {
  const mods: ModuleLike[] = [{ id: "old" }, { id: "fresh", defaultEnabled: false }, { id: "core", required: true }];
  const feats: FeatureLike[] = [
    { id: "kept", module: "old" },
    { id: "added", module: "old", defaultEnabled: false },
    { id: "dep", module: "old", requires: ["old.added"] },
    { id: "all", module: "fresh" },
    { id: "pf", module: "core", required: true, defaultEnabled: false },
  ];
  const active = (o: Record<string, boolean> = {}) => [...effectiveFeatureIds(mods, feats, o)].sort();
  const status = (id: string, o: Record<string, boolean> = {}) => featureStatus(feats.find((f) => `${f.module}.${f.id}` === id)!, mods, feats, o);

  test("ohne Einstellung gilt der Standard: Bestand an, neue Funktionen und Module aus", () => {
    assert.deepEqual(active(), ["core.pf", "old.kept"]);
    assert.deepEqual(status("old.added"), { state: "off" });
    assert.deepEqual(status("fresh.all"), { state: "module-off" });
  });
  test("Einschalten ist eine gespeicherte Abweichung; Abhängige folgen, sobald alles Benötigte an ist", () => {
    assert.deepEqual(active({ "old.added": true }), ["core.pf", "old.added", "old.dep", "old.kept"]);
    assert.deepEqual(active({ "old.dep": false, "old.added": true }), ["core.pf", "old.added", "old.kept"]);
  });
  test("ein neues Modul einzuschalten genügt, wenn seine Funktionen Standard an haben; Bestand lässt sich ausschalten", () => {
    assert.deepEqual(active({ fresh: true }), ["core.pf", "fresh.all", "old.kept"]);
    assert.deepEqual(active({ fresh: true, "fresh.all": false }), ["core.pf", "old.kept"]);
    assert.deepEqual(active({ "old.kept": false }), ["core.pf"]);
  });
  test("Pflichtfunktionen sind immer an, auch mit defaultEnabled: false oder gespeichertem Aus", () => {
    assert.ok(active({ core: false, "core.pf": false }).includes("core.pf"));
    assert.deepEqual(status("core.pf", { core: false }), { state: "on" });
  });
  test("blocked: eine eingeschaltete Funktion, deren Voraussetzung noch aus ist", () => {
    assert.deepEqual(status("old.dep"), { state: "blocked", missing: ["old.added"] });
  });
});
