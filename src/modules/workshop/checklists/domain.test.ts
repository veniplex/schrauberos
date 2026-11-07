import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TEMPLATES } from "./defaults";
import { checkAnswer, itemDefProblem, normalizeName, openRequired, outOfRange, parseOptions, progress, sameItems, sameName, type ItemDef } from "./domain";

const def = (extra: Partial<ItemDef> = {}): ItemDef => ({ label: "Punkt", type: "check", unit: null, minValue: null, maxValue: null, targetValue: null, options: null, required: true, hint: null, ...extra });

describe("Antworten je Punktart", () => {
  it("Haken und Foto-Hinweis: nur der Haken zählt, keine Werte", () => {
    assert.deepEqual(checkAnswer({ type: "check", options: null }, { done: true, numberValue: 5, textValue: "x" }), { ok: true, done: true, numberValue: null, textValue: null });
    assert.deepEqual(checkAnswer({ type: "photo", options: null }, {}), { ok: true, done: false, numberValue: null, textValue: null });
  });

  it("Messwert und Drehmoment: eine Zahl macht den Punkt erledigt, „erledigt“ ohne Zahl ist ein Fehler, Unsinn wird abgewiesen, Werte außerhalb der Grenzen bleiben erlaubt", () => {
    const measure = { type: "measure", options: null };
    assert.deepEqual(checkAnswer(measure, { numberValue: 3.14159 }), { ok: true, done: true, numberValue: 3.142, textValue: null });
    assert.deepEqual(checkAnswer(measure, { done: true }), { ok: false, field: "numberValue", key: "checklists.errors.valueRequired" });
    assert.deepEqual(checkAnswer(measure, { done: false, numberValue: null }), { ok: true, done: false, numberValue: null, textValue: null });
    for (const bad of [Number.NaN, Infinity, 1e300, -2_000_000]) assert.equal(checkAnswer(measure, { numberValue: bad }).ok, false, String(bad));
    assert.equal(checkAnswer({ type: "torque", options: null }, { numberValue: 5000 }).ok, true);
  });

  it("Auswahl: nur Einträge der Liste; Freitext: begrenzt und getrimmt", () => {
    const choice = { type: "choice", options: "leer\n1/2\nvoll" };
    assert.deepEqual(checkAnswer(choice, { textValue: " voll " }), { ok: true, done: true, numberValue: null, textValue: "voll" });
    assert.equal(checkAnswer(choice, { textValue: "überfüllt" }).ok, false);
    assert.equal(checkAnswer(choice, { textValue: "" }).ok, true);
    const text = { type: "text", options: null };
    assert.deepEqual(checkAnswer(text, { textValue: "  Kratzer links \r\n" }), { ok: true, done: true, numberValue: null, textValue: "Kratzer links" });
    assert.equal(checkAnswer(text, { textValue: "x".repeat(1001) }).ok, false);
    assert.deepEqual(checkAnswer(text, { textValue: "   " }), { ok: true, done: false, numberValue: null, textValue: null });
  });

  it("Messwert außerhalb der Grenzen wird erkannt; ohne Grenzen oder bei anderen Arten nie", () => {
    const base = { type: "measure", minValue: 1.6, maxValue: 8, numberValue: 1.2 };
    assert.equal(outOfRange(base), true);
    assert.equal(outOfRange({ ...base, numberValue: 9 }), true);
    assert.equal(outOfRange({ ...base, numberValue: 4 }), false);
    assert.equal(outOfRange({ ...base, minValue: null, maxValue: null }), false);
    assert.equal(outOfRange({ ...base, type: "text" }), false);
    assert.equal(outOfRange({ ...base, numberValue: null }), false);
  });
});

describe("Auswahl, Pflicht, Fortschritt, Namen", () => {
  it("Auswahlmöglichkeiten: eine je Zeile, ohne Leere und Doppelte", () => {
    assert.deepEqual(parseOptions(" a \n\nb\r\na\n c"), ["a", "b", "c"]);
    assert.deepEqual(parseOptions(null), []);
  });

  it("Pflichtpunkte und Fortschritt", () => {
    const items = [
      { required: true, done: true },
      { required: true, done: false },
      { required: false, done: false },
    ];
    assert.equal(openRequired(items).length, 1);
    assert.deepEqual(progress(items), { done: 1, total: 3 });
  });

  it("Namen: Groß/Klein, Leerraum und Unicode-Schreibweise zählen nicht (wie bei der Freigabe)", () => {
    assert.equal(sameName("Erika  MUSTER", "erika muster"), true);
    assert.equal(sameName("Müller", "Müller"), true);
    assert.equal(sameName("Erika", "Erik"), false);
    assert.equal(sameName("", ""), false);
    assert.equal(normalizeName("A\u0000B"), "ab");
  });

  it("Vorlagen vergleichen: gleiche Punkte (auch mit anders geschriebener Auswahl) sind gleich, jede Änderung zählt", () => {
    const a = [def({ type: "choice", options: "a\nb" }), def({ label: "Zwei", type: "measure", unit: "mm", minValue: 1 })];
    assert.equal(sameItems(a, [def({ type: "choice", options: "a\r\nb" }), def({ label: "Zwei", type: "measure", unit: "mm", minValue: 1 })]), true);
    assert.equal(sameItems(a, [a[0], { ...a[1], minValue: 2 }]), false);
    assert.equal(sameItems(a, [a[1], a[0]]), false, "Reihenfolge zählt");
    assert.equal(sameItems(a, [a[0]]), false);
  });

  it("Punktdefinition: Bezeichnung, Auswahl braucht zwei Möglichkeiten, Grenzen in der richtigen Reihenfolge", () => {
    assert.equal(itemDefProblem(def()), null);
    assert.equal(itemDefProblem(def({ label: "  " }))?.field, "label");
    assert.equal(itemDefProblem(def({ type: "choice", options: "nur eine" }))?.key, "checklists.errors.optionsNeeded");
    assert.equal(itemDefProblem(def({ type: "measure", minValue: 5, maxValue: 2 }))?.key, "checklists.errors.rangeOrder");
    assert.equal(itemDefProblem(def({ type: "torque", targetValue: 1e9 }))?.field, "targetValue");
  });
});

describe("Mitgelieferte Vorlagen", () => {
  it("vier Vorlagen, jede gültig; das Annahmeprotokoll erlaubt eine Unterschrift, der Reifenwechsel hat ein Drehmoment mit Sollwert", () => {
    assert.deepEqual(DEFAULT_TEMPLATES.map((t) => t.key), ["intake", "oil", "tires", "hu"]);
    for (const template of DEFAULT_TEMPLATES) {
      assert.ok(template.items.length >= 8, template.key);
      for (const item of template.items) assert.equal(itemDefProblem(item), null, `${template.key}: ${item.label}`);
    }
    assert.equal(DEFAULT_TEMPLATES[0].signatureMode, "optional");
    const torque = DEFAULT_TEMPLATES[2].items.find((i) => i.type === "torque");
    assert.ok(torque && torque.unit === "Nm" && torque.targetValue !== null);
  });
});
