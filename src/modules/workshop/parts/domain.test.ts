import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookableLines, normalizeArticleNumber, reversalsFor, stockState, sumByArticle } from "./domain";

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
