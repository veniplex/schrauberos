import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_MONEY_CENTS } from "./money";
import { moneyCents } from "./zod-fields";
import {
  computeTotals,
  createEditorState,
  editorReducer,
  evaluateRow,
  evaluateRows,
  lineExceedsLimit,
  lineResult,
  mulDiv,
  parseDraft,
  parsePercentBp,
  parseQuantity,
  parseScaled,
  rowsFromItems,
  scaledToInput,
  serializeDraft,
  serializeSubmit,
  type ParsedLine,
} from "./line-items";
import { lineItemsInput } from "./line-items-schema";

const line = (quantityMilli: number, unitCents: number, taxBp = 1900, discountBp = 0): ParsedLine => ({ quantityMilli, unitCents, taxBp, discountBp });

describe("mulDiv (kaufmännisch gerundet, exakt)", () => {
  it("rundet halbe Einheiten weg von null, auch negativ", () => {
    assert.equal(mulDiv(1, 1, 2), 1);
    assert.equal(mulDiv(-1, 1, 2), -1);
    assert.equal(mulDiv(1, 1, 3), 0);
    assert.equal(mulDiv(2, 1, 3), 1);
    assert.equal(mulDiv(5, 1, 10), 1);
    assert.equal(mulDiv(4, 1, 10), 0);
    assert.equal(mulDiv(-14, 1, 10), -1);
    assert.equal(mulDiv(-15, 1, 10), -2);
  });

  it("bleibt bei sehr großen Produkten exakt (Gleitkomma würde falsch runden)", () => {
    const exact = mulDiv(999_999_999, 999_999_999, 1000);
    assert.equal(exact, 999_999_998_000_000);
    assert.ok(Number.isSafeInteger(exact));
  });
});

describe("Position", () => {
  it("Menge × Einzelpreis, Rabatt, Netto", () => {
    assert.deepEqual(lineResult(line(1500, 8500)), { baseCents: 12750, discountCents: 0, netCents: 12750 }); // 1,5 Std. × 85,00 €
    assert.deepEqual(lineResult(line(2000, 5000, 1900, 1000)), { baseCents: 10000, discountCents: 1000, netCents: 9000 }); // 2 × 50 € − 10 %
    assert.deepEqual(lineResult(line(333, 100)), { baseCents: 33, discountCents: 0, netCents: 33 }); // 0,333 × 1,00 € = 33,3 Cent → 33
    assert.deepEqual(lineResult(line(1, 1000)), { baseCents: 1, discountCents: 0, netCents: 1 }); // 0,001 × 10,00 € = 1 Cent
  });

  it("negative Menge ergibt eine Gutschriftsposition", () => {
    assert.equal(lineResult(line(-1000, 2500)).netCents, -2500);
  });

  it("Rabatt 100 % ergibt 0", () => {
    assert.equal(lineResult(line(3000, 1234, 1900, 10_000)).netCents, 0);
  });
});

describe("Summen: Steuer je Satz auf der Summe gerundet", () => {
  it("die Steuer wird aus der Summe gebildet, nicht je Position (der Unterschied ist ein Cent)", () => {
    const small = computeTotals([line(1000, 7), line(1000, 7), line(1000, 7)]); // 3 × 0,07 € = 21 Cent netto
    const perLine = 3 * mulDiv(7, 1900, 10_000); // je Position: round(1,33) = 1 → 3 Cent
    assert.equal(small.netCents, 21);
    assert.equal(small.taxCents, mulDiv(21, 1900, 10_000)); // auf der Summe: round(3,99) = 4 Cent
    assert.equal(small.taxCents, 4);
    assert.notEqual(small.taxCents, perLine);
  });

  it("mehrere Sätze: je Satz eine Gruppe, absteigend sortiert, Brutto = Netto + Steuer", () => {
    const totals = computeTotals([line(1000, 10_000, 1900), line(2000, 2_500, 700), line(1000, 1_000, 0)]);
    assert.deepEqual(totals.taxGroups, [
      { taxBp: 1900, netCents: 10_000, taxCents: 1900 },
      { taxBp: 700, netCents: 5_000, taxCents: 350 },
      { taxBp: 0, netCents: 1_000, taxCents: 0 },
    ]);
    assert.equal(totals.netCents, 16_000);
    assert.equal(totals.taxCents, 2250);
    assert.equal(totals.grossCents, 18_250);
  });

  it("Rabatt wirkt vor der Steuer; die Summe der Rabatte wird ausgewiesen", () => {
    const totals = computeTotals([line(1000, 10_000, 1900, 1000), line(1000, 5_000, 1900, 0)]);
    assert.equal(totals.baseCents, 15_000);
    assert.equal(totals.discountCents, 1000);
    assert.equal(totals.netCents, 14_000);
    assert.equal(totals.taxCents, 2660);
    assert.equal(totals.grossCents, 16_660);
  });

  it("steuerfrei (Kleinunternehmer): keine Steuer, eine Gruppe mit Satz 0, Brutto = Netto", () => {
    const totals = computeTotals([line(1000, 10_000, 1900), line(1000, 5_000, 700)], { exempt: true });
    assert.deepEqual(totals.taxGroups, [{ taxBp: 0, netCents: 15_000, taxCents: 0 }]);
    assert.equal(totals.taxCents, 0);
    assert.equal(totals.grossCents, 15_000);
  });

  it("ohne Positionen alles 0, keine Gruppen", () => {
    const totals = computeTotals([]);
    assert.deepEqual([totals.netCents, totals.taxCents, totals.grossCents, totals.taxGroups.length], [0, 0, 0, 0]);
  });

  it("Gutschrift (negativ) gegen Rechnung ergibt die Summe 0 – auch bei krummen Beträgen", () => {
    const original = [line(1500, 3333), line(1000, 1999, 700)];
    const credit = original.map((l) => ({ ...l, quantityMilli: -l.quantityMilli }));
    const together = computeTotals([...original, ...credit]);
    assert.equal(together.netCents, 0);
    assert.equal(together.taxCents, 0);
    assert.equal(together.grossCents, 0);
  });
});

describe("Eingabetexte", () => {
  it("parseScaled: Komma und Punkt, Vorzeichen, Grenzen der Nachkommastellen", () => {
    assert.equal(parseScaled("1,5", 3), 1500);
    assert.equal(parseScaled("1.5", 3), 1500);
    assert.equal(parseScaled("2", 3), 2000);
    assert.equal(parseScaled("0,001", 3), 1);
    assert.equal(parseScaled("-2,25", 3), -2250);
    assert.equal(parseScaled("1.234,5", 3), 1234500);
    assert.equal(parseScaled("1,234.5", 3), 1234500);
    assert.equal(parseScaled("0,0001", 3), null, "mehr Nachkommastellen als erlaubt: nichts wird abgeschnitten");
    assert.equal(parseScaled("", 3), null);
    assert.equal(parseScaled("abc", 3), null);
    assert.equal(parseScaled("1,2,3", 3), null);
    assert.equal(parseScaled("1e3", 3), null);
  });

  it("Menge und Prozent haben Grenzen", () => {
    assert.equal(parseQuantity("1.000.000,001"), null);
    assert.equal(parseQuantity("1000000"), 1_000_000_000);
    assert.equal(parsePercentBp("19"), 1900);
    assert.equal(parsePercentBp("5,5"), 550);
    assert.equal(parsePercentBp("100,01"), null);
    assert.equal(parsePercentBp("-1"), null);
    assert.equal(parsePercentBp("7,555"), null);
  });

  it("scaledToInput gibt kurze Texte (ohne Endnullen) in der Sprache der Oberfläche", () => {
    assert.equal(scaledToInput(1500, 3), "1,5");
    assert.equal(scaledToInput(1500, 3, "en"), "1.5");
    assert.equal(scaledToInput(2000, 3), "2");
    assert.equal(scaledToInput(1, 3), "0,001");
    assert.equal(scaledToInput(-2250, 3), "-2,25");
    assert.equal(scaledToInput(1900, 2), "19");
  });

  it("evaluateRow: Pflichtfelder, leerer Rabatt = 0 %", () => {
    assert.deepEqual(evaluateRow({ quantity: "2", unitPrice: "49,90", taxRate: "19", discount: "" }).parsed, { quantityMilli: 2000, unitCents: 4990, taxBp: 1900, discountBp: 0 });
    const bad = evaluateRow({ quantity: "", unitPrice: "abc", taxRate: "200", discount: "x" });
    assert.equal(bad.parsed, null);
    assert.deepEqual(Object.keys(bad.issues).sort(), ["discount", "quantity", "taxRate", "unitPrice"]);
  });
});

describe("Zustand des Editors (Reducer)", () => {
  const start = () => createEditorState([{ description: "Ölwechsel", unitPrice: "49,90" }]);

  it("jede Änderung rechnet aus dem aktuellen Zustand: zwei Änderungen hintereinander verlieren keine", () => {
    let state = start();
    const key = state.rows[0].key;
    // wie die Wiederherstellung eines Entwurfs: mehrere Felder nacheinander, jedes mit dem Stand nach dem vorigen
    state = editorReducer(state, { type: "set", key, field: "quantity", value: "3" });
    state = editorReducer(state, { type: "set", key, field: "discount", value: "10" });
    assert.equal(state.rows[0].quantity, "3");
    assert.equal(state.rows[0].discount, "10");
    assert.equal(state.rows[0].description, "Ölwechsel");
  });

  it("neue Zeile übernimmt den Steuersatz der letzten und bekommt einen neuen Schlüssel; Entfernen und Verschieben", () => {
    let state = start();
    state = editorReducer(state, { type: "set", key: state.rows[0].key, field: "taxRate", value: "7" });
    state = editorReducer(state, { type: "add" });
    assert.equal(state.rows[1].taxRate, "7");
    assert.notEqual(state.rows[1].key, state.rows[0].key);
    const [a, b] = state.rows.map((r) => r.key);
    state = editorReducer(state, { type: "move", key: b, delta: -1 });
    assert.deepEqual(state.rows.map((r) => r.key), [b, a]);
    state = editorReducer(state, { type: "move", key: b, delta: -1 });
    assert.deepEqual(state.rows.map((r) => r.key), [b, a], "über den Rand hinaus passiert nichts");
    state = editorReducer(state, { type: "remove", key: a });
    assert.deepEqual(state.rows.map((r) => r.key), [b]);
    const key = editorReducer(state, { type: "add" }).rows[1].key;
    assert.notEqual(key, a, "ein entfernter Schlüssel wird nie wiederverwendet");
  });

  it("Entwurf: Zustand → Text → Zeilen ist verlustfrei und der Text bleibt für gleiche Zeilen gleich (Voraussetzung der Wiederherstellung)", () => {
    const state = createEditorState([
      { description: "Bremsbeläge vorn", quantity: "1", unit: "Satz", unitPrice: "89,00", taxRate: "19", discount: "5" },
      { description: "Arbeit", quantity: "1,5", unit: "Std.", unitPrice: "85,00", taxRate: "19", discount: "" },
    ]);
    const text = serializeDraft(state.rows);
    const restored = editorReducer(createEditorState([]), { type: "replace", rows: parseDraft(text) });
    assert.equal(serializeDraft(restored.rows), text);
    assert.deepEqual(parseDraft("kein json"), []);
    assert.deepEqual(parseDraft('{"a":1}'), []);
    assert.equal(parseDraft('[["a","1","Stk","2","19","",5]]').length, 1);
  });

  it("ein manipulierter Entwurf (Zahlen, Objekte, überlange Texte) bringt nichts durcheinander", () => {
    const rows = parseDraft(JSON.stringify([[1, {}, null, "x".repeat(10_000), ["a"], "ok"]]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, "");
    assert.equal(rows[0].unit, "");
    assert.ok(rows[0].unitPrice.length <= 500);
  });

  it("höchstens 200 Positionen", () => {
    let state = createEditorState(Array.from({ length: 200 }, () => ({ description: "x" })));
    state = editorReducer(state, { type: "add" });
    assert.equal(state.rows.length, 200);
    assert.equal(editorReducer(state, { type: "replace", rows: Array.from({ length: 300 }, () => ({})) }).rows.length, 200);
  });
});

describe("Auswertung und Übergabe an den Server", () => {
  it("evaluateRows rechnet gültige Zeilen und meldet, ob alle gültig sind", () => {
    const rows = createEditorState([
      { description: "A", quantity: "2", unitPrice: "10,00", taxRate: "19" },
      { description: "B", quantity: "1", unitPrice: "kaputt", taxRate: "19" },
    ]).rows;
    const result = evaluateRows(rows);
    assert.equal(result.valid, false);
    assert.equal(result.totals.netCents, 2000);
    assert.equal(result.rows[1].issues.unitPrice, "invalid");
  });

  it("serializeSubmit → Server-Schema → computeTotals ergibt dieselben Summen wie der Editor", () => {
    const rows = createEditorState([
      { description: "Bremsbeläge", quantity: "1", unit: "Satz", unitPrice: "89,90", taxRate: "19", discount: "5" },
      { description: "Arbeit", quantity: "1,5", unit: "Std.", unitPrice: "85,00", taxRate: "19" },
      { description: "Altteilentsorgung", quantity: "1", unitPrice: "5,00", taxRate: "7" },
    ]).rows;
    const client = evaluateRows(rows).totals;
    const items = lineItemsInput().parse(serializeSubmit(rows));
    assert.deepEqual(computeTotals(items), client);
  });

  it("das Schema lehnt ungültige Felder an der richtigen Zeile ab (Pfad <i>.<feld>)", () => {
    const rows = createEditorState([{ description: "A", unitPrice: "1,00" }, { description: "", unitPrice: "x" }]).rows;
    const result = lineItemsInput().safeParse(serializeSubmit(rows));
    assert.equal(result.success, false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    assert.ok(paths.includes("1.description") && paths.includes("1.unitCents"), paths.join(", "));
    assert.ok(!paths.some((p) => p.startsWith("0.")));
    assert.equal(lineItemsInput().safeParse("{kaputt").success, false);
    const two = createEditorState([{ description: "a", unitPrice: "1" }, { description: "b", unitPrice: "1" }]).rows;
    assert.equal(lineItemsInput({ max: 1 }).safeParse(serializeSubmit(two)).success, false);
  });

  it("rowsFromItems → Editor → Absendefeld ist verlustfrei (Bearbeiten)", () => {
    const items = [{ description: "Arbeit", unit: "Std.", quantityMilli: 1500, unitCents: 8500, taxBp: 1900, discountBp: 250 }];
    const rows = createEditorState(rowsFromItems(items)).rows;
    assert.deepEqual(rows[0], { key: "r0", description: "Arbeit", unit: "Std.", quantity: "1,5", unitPrice: "85,00", taxRate: "19", discount: "2,5", kind: "", refType: "", refId: "" });
    assert.deepEqual(lineItemsInput().parse(serializeSubmit(rows)), [{ ...items[0] }]);
    const english = createEditorState(rowsFromItems(items, "en")).rows[0];
    assert.deepEqual([english.quantity, english.unitPrice, english.discount], ["1.5", "85.00", "2.5"]);
  });

  it("Art und Verweis (kind, refType/refId) laufen mit durch – und fehlen im Absendefeld, wenn der Aufrufer sie nicht nutzt", () => {
    const plain = createEditorState([{ description: "a", unitPrice: "1" }]).rows;
    assert.deepEqual(JSON.parse(serializeSubmit(plain))[0], { description: "a", unit: "", quantityMilli: 1000, unitCents: 100, taxBp: 1900, discountBp: 0 });
    const rows = createEditorState(rowsFromItems([{ description: "Filter", unit: "Stk", quantityMilli: 2000, unitCents: 1250, taxBp: 1900, kind: "part", refType: "article", refId: "abc" }])).rows;
    assert.deepEqual([rows[0].kind, rows[0].refType, rows[0].refId], ["part", "article", "abc"]);
    const parsed = lineItemsInput().parse(serializeSubmit(rows));
    assert.deepEqual([parsed[0].kind, parsed[0].refType, parsed[0].refId], ["part", "article", "abc"]);
    // ein Verweis ohne Kennung wird nicht halb übertragen
    assert.equal(JSON.parse(serializeSubmit([{ ...rows[0], refId: "" }]))[0].refType, undefined);
    // auch der Entwurf trägt die Zusätze
    const restored = editorReducer(createEditorState([]), { type: "replace", rows: parseDraft(serializeDraft(rows)) }).rows[0];
    assert.deepEqual([restored.kind, restored.refType, restored.refId], ["part", "article", "abc"]);
  });
});

describe("Überlaufschutz (Int-Spalten, exakte Summen)", () => {
  const submit = (items: Array<Record<string, unknown>>) => JSON.stringify(items.map((i) => ({ description: "x", unit: "", taxBp: 1900, discountBp: 0, ...i })));

  it("eine Position über der Betragsgrenze wird erkannt (Menge × Preis kann bis 10^15 Cent erreichen)", () => {
    assert.equal(lineExceedsLimit(line(1_000_000_000, 1_000_000_000)), true);
    assert.equal(lineExceedsLimit(line(-1_000_000_000, 1_000_000_000)), true);
    assert.equal(lineExceedsLimit(line(1000, MAX_MONEY_CENTS)), false);
    assert.equal(lineExceedsLimit(line(1001, MAX_MONEY_CENTS)), true);
    assert.equal(computeTotals([line(1_000_000_000, 1_000_000_000)]).exceedsLimit, true);
    assert.equal(computeTotals([line(1500, 8500)]).exceedsLimit, false);
  });

  it("200 Maximalpositionen: das Schema lehnt jede einzelne und die Summe ab – kein stiller Überlauf", () => {
    const max = Array.from({ length: 200 }, () => ({ quantityMilli: 1_000_000_000, unitCents: 1_000_000_000 }));
    const result = lineItemsInput().safeParse(submit(max));
    assert.equal(result.success, false);
    const issues = result.success ? [] : result.error.issues;
    assert.equal(issues.length, 200, "eine Meldung je Position");
    assert.ok(issues.every((issue) => issue.message === "validation.tooLarge" && issue.path[1] === "unitCents"));
    assert.equal(computeTotals(max.map((m) => line(m.quantityMilli, m.unitCents))).exceedsLimit, true);
  });

  it("jede Position für sich gültig, aber die Summe über der Grenze: Fehler an der Gesamtliste", () => {
    // 200 × 100.000,00 € = 20 Mio. netto, brutto mit 19 % über der Grenze von 21,47 Mio.
    const many = Array.from({ length: 200 }, () => ({ quantityMilli: 1000, unitCents: 10_000_000 }));
    const result = lineItemsInput().safeParse(submit(many));
    assert.equal(result.success, false);
    const issues = result.success ? [] : result.error.issues;
    assert.deepEqual(issues.map((i) => [i.path.length, i.message]), [[0, "validation.tooLarge"]]);
    // knapp darunter geht es
    const fine = Array.from({ length: 200 }, () => ({ quantityMilli: 1000, unitCents: 5_000_000 }));
    const parsed = lineItemsInput().parse(submit(fine));
    const totals = computeTotals(parsed);
    assert.equal(totals.exceedsLimit, false);
    assert.equal(totals.netCents, 1_000_000_000);
    assert.equal(totals.grossCents, 1_190_000_000);
    assert.ok(Number.isSafeInteger(totals.grossCents));
  });

  it("Gutschriften heben sich auf: große Positionen mit Gegenposition bleiben gültig, solange jede unter der Grenze liegt", () => {
    const items = [{ quantityMilli: 1000, unitCents: 1_000_000_000 }, { quantityMilli: -1000, unitCents: 1_000_000_000 }];
    const totals = computeTotals(lineItemsInput().parse(submit(items)));
    assert.deepEqual([totals.netCents, totals.grossCents, totals.exceedsLimit], [0, 0, false]);
  });

  it("der Editor markiert Menge und Preis einer zu großen Position, rechnet sie nicht mit und meldet zu große Summen", () => {
    const big = evaluateRow({ quantity: "1.000.000".replace(".", ""), unitPrice: "10000000", taxRate: "19", discount: "" });
    assert.equal(big.parsed, null);
    assert.deepEqual([big.issues.quantity, big.issues.unitPrice], ["tooLarge", "tooLarge"]);
    const rows = createEditorState(Array.from({ length: 200 }, () => ({ description: "x", quantity: "1", unitPrice: "100000", taxRate: "19" }))).rows;
    const result = evaluateRows(rows);
    assert.equal(result.tooLarge, true);
    assert.equal(result.valid, false);
    assert.ok(result.rows.every((row) => row.parsed !== null), "jede Zeile für sich ist gültig");
    assert.equal(evaluateRows(rows.slice(0, 100)).valid, true);
  });

  it("Geldbeträge in Formularen (moneyCents) sind auf die Int-Spalte begrenzt", () => {
    const schema = moneyCents("x");
    assert.equal(schema.safeParse("21474836,47").success, true);
    assert.equal(schema.safeParse("21474836,48").success, false);
    assert.equal(schema.safeParse("-21474836,48").success, false);
    assert.equal(schema.safeParse("99999999999999").success, false);
  });
});
