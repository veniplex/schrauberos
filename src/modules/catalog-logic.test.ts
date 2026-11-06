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
