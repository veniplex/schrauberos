import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { FEATURES, MODULES } from "./catalog";
import { effectiveFeatureIds } from "./catalog-logic";
import { PRESETS, planPreset, presetChoices } from "./presets";

const lookup = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

describe("Presets (ausgeliefert)", () => {
  it("nennen nur existierende, schaltbare Funktionen – und haben Namen und Beschreibung in beiden Sprachen", () => {
    assert.ok(PRESETS.length >= 2);
    assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
    for (const preset of PRESETS) {
      for (const lang of [de, en]) {
        assert.equal(typeof lookup(lang, preset.nameKey), "string", preset.nameKey);
        assert.equal(typeof lookup(lang, preset.descriptionKey), "string", preset.descriptionKey);
      }
      const plan = planPreset(preset, MODULES, FEATURES);
      assert.deepEqual(plan.skipped.filter((s) => s.reason !== "alreadyOn"), [], `${preset.id}: unbekannte oder nicht schaltbare Funktion`);
      for (const id of preset.enable) {
        const feature = FEATURES.find((f) => `${f.module}.${f.id}` === id);
        assert.ok(feature, `${preset.id}: ${id} gibt es nicht`);
        assert.ok(!("required" in feature && feature.required), `${preset.id}: ${id} ist eine Pflichtfunktion`);
      }
    }
  });

  it("das erste Preset ist der Standard und ändert nichts; heute gibt es keine Wahl in der Einrichtung", () => {
    assert.deepEqual(PRESETS[0].enable, []);
    assert.deepEqual(planPreset(PRESETS[0], MODULES, FEATURES), { overrides: {}, skipped: [] });
    assert.deepEqual(presetChoices(PRESETS, MODULES, FEATURES).map((p) => p.id), ["basic"], "solange kein Preset etwas einschaltet");
  });
});

describe("planPreset (Mechanismus mit einem Beispielkatalog)", () => {
  const modules = [{ id: "shop" }, { id: "extra", defaultEnabled: false }, { id: "admin", required: true }];
  const features = [
    { id: "base", module: "shop" },
    { id: "orders", module: "shop", defaultEnabled: false, requires: ["shop.base"] },
    { id: "invoicing", module: "shop", defaultEnabled: false, requires: ["shop.orders"] },
    { id: "gadget", module: "extra", defaultEnabled: false },
    { id: "users", module: "admin", required: true },
  ];

  it("schaltet die Funktion samt harten Abhängigkeiten und ausgeschaltetem Modul ein", () => {
    const plan = planPreset({ enable: ["shop.invoicing"] }, modules, features);
    assert.deepEqual(Object.keys(plan.overrides).sort(), ["shop.invoicing", "shop.orders"]);
    assert.deepEqual(planPreset({ enable: ["extra.gadget"] }, modules, features).overrides, { extra: true, "extra.gadget": true });
    const on = effectiveFeatureIds(modules, features, { ...planPreset({ enable: ["shop.invoicing", "extra.gadget"] }, modules, features).overrides });
    assert.deepEqual([...on].sort(), ["admin.users", "extra.gadget", "shop.base", "shop.invoicing", "shop.orders"]);
  });

  it("unbekannte IDs, Pflichtfunktionen und schon eingeschaltete Funktionen werden übersprungen und gemeldet – der Rest wird trotzdem angewendet", () => {
    const plan = planPreset({ enable: ["shop.gibtesnicht", "admin.users", "shop.base", "shop.orders"] }, modules, features);
    assert.deepEqual(plan.skipped, [
      { id: "shop.gibtesnicht", reason: "unknown" },
      { id: "admin.users", reason: "required" },
      { id: "shop.base", reason: "alreadyOn" },
    ]);
    assert.deepEqual(plan.overrides, { "shop.orders": true });
  });

  it("presetChoices: das erste Preset immer, weitere nur, wenn sie etwas einschalten", () => {
    const presets = [
      { id: "basic", nameKey: "x", descriptionKey: "y", enable: [] },
      { id: "empty", nameKey: "x", descriptionKey: "y", enable: [] },
      { id: "orders", nameKey: "x", descriptionKey: "y", enable: ["shop.orders"] },
    ] as never;
    assert.deepEqual(presetChoices(presets, modules, features).map((p) => p.id), ["basic", "orders"]);
  });
});
