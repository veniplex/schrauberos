import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookableLines, closingDeltas, normalizeArticleNumber, reversalsFor, shortages, stockState, sumByArticle } from "./domain";

describe("Artikelnummer", () => {
  it("getrimmt, Großbuchstaben, innere Leerzeichen zusammengefasst", () => {
    assert.equal(normalizeArticleNumber("  oel  5w30 "), "OEL 5W30");
    assert.equal(normalizeArticleNumber("of-123"), "OF-123");
  });
});

describe("Bestandszustand", () => {
  it("negativ vor niedrig vor in Ordnung; ohne Mindestbestand nie „niedrig“; auf dem Mindestbestand gilt als niedrig", () => {
    assert.equal(stockState(-1, 5000), "negative");
    assert.equal(stockState(-1, 0), "negative");
    assert.equal(stockState(0, 0), "ok");
    assert.equal(stockState(5000, 5000), "low");
    assert.equal(stockState(5001, 5000), "ok");
    assert.equal(stockState(0, 1), "low");
  });
});

describe("Buchung beim Abschluss", () => {
  const line = (over: Record<string, unknown>) => ({ id: "l", kind: "part", description: "x", quantityMilli: 1000, refType: "article", refId: "a1", ...over });

  it("gebucht werden nur Teile-Positionen mit Artikelverweis und Menge ≠ 0", () => {
    const lines = [line({ id: "1" }), line({ id: "2", kind: "labor" }), line({ id: "3", refType: null }), line({ id: "4", refId: null }), line({ id: "5", refType: "anderes" }), line({ id: "6", quantityMilli: 0 }), line({ id: "7", quantityMilli: -500 })];
    assert.deepEqual(bookableLines(lines).map((l) => l.id), ["1", "7"]);
  });

  it("derselbe Artikel in mehreren Positionen wird zusammengezählt", () => {
    const sums = sumByArticle([{ refId: "a", quantityMilli: 2000 }, { refId: "b", quantityMilli: 500 }, { refId: "a", quantityMilli: 1000 }]);
    assert.deepEqual([...sums], [["a", 3000], ["b", 500]]);
  });

  it("Rückbuchung = Saldo der Bewegungen des Auftrags: nur was noch abgebucht ist; schon zurückgebucht ergibt nichts", () => {
    assert.deepEqual([...reversalsFor([{ articleId: "a", quantityMilli: -3000 }, { articleId: "b", quantityMilli: -1000 }])], [["a", 3000], ["b", 1000]]);
    assert.deepEqual([...reversalsFor([{ articleId: "a", quantityMilli: -3000 }, { articleId: "a", quantityMilli: 3000 }])], []);
    assert.deepEqual([...reversalsFor([{ articleId: "a", quantityMilli: -3000 }, { articleId: "a", quantityMilli: 3000 }, { articleId: "a", quantityMilli: -5000 }])], [["a", 5000]]);
    assert.deepEqual([...reversalsFor([])], []);
  });
});

describe("Bilanz und Abschluss (Fix-Runde 12b)", () => {
  it("Rückbuchung in beide Richtungen: Abgang wird zurückgebucht, Zugang (negative Menge) wieder abgezogen, Bilanz 0 ergibt nichts", () => {
    assert.deepEqual([...reversalsFor([{ articleId: "a", quantityMilli: 2000 }])], [["a", -2000]]);
    assert.deepEqual([...reversalsFor([{ articleId: "a", quantityMilli: 2000 }, { articleId: "a", quantityMilli: -2000 }])], []);
    assert.deepEqual([...reversalsFor([{ articleId: "a", quantityMilli: -3000 }, { articleId: "b", quantityMilli: 1000 }])], [["a", 3000], ["b", -1000]]);
  });

  it("Abschluss bucht Verbrauch minus Bilanz: normal der Verbrauch, schon gebucht nichts, geändert die Differenz, nicht mehr verbrauchte Artikel werden zurückgebucht", () => {
    const sums = (entries: Array<[string, number]>) => new Map(entries);
    assert.deepEqual([...closingDeltas(sums([["a", 3000]]), [])], [["a", -3000]]);
    assert.deepEqual([...closingDeltas(sums([["a", 3000]]), [{ articleId: "a", quantityMilli: -3000 }])], []);
    assert.deepEqual([...closingDeltas(sums([["a", 5000]]), [{ articleId: "a", quantityMilli: -3000 }])], [["a", -2000]]);
    assert.deepEqual([...closingDeltas(sums([["a", 1000]]), [{ articleId: "a", quantityMilli: -3000 }])], [["a", 2000]]);
    assert.deepEqual([...closingDeltas(sums([]), [{ articleId: "a", quantityMilli: -3000 }])], [["a", 3000]]);
    assert.deepEqual([...closingDeltas(sums([["a", -2000]]), [])], [["a", 2000]], "Gutschrift: Zugang");
  });

  it("Bestand reicht nicht: je Artikel gegen die Summe der Positionen (zwei Positionen à 3 bei Bestand 4), Gutschriften zählen nicht", () => {
    const stock = new Map([["a", 4000], ["b", 1000]]);
    assert.deepEqual([...shortages([{ refId: "a", quantityMilli: 3000 }, { refId: "a", quantityMilli: 3000 }], stock)], ["a"]);
    assert.deepEqual([...shortages([{ refId: "a", quantityMilli: 3000 }, { refId: "b", quantityMilli: 1000 }], stock)], []);
    assert.deepEqual([...shortages([{ refId: "b", quantityMilli: -5000 }, { refId: "unbekannt", quantityMilli: 9000 }], stock)], []);
  });
});
