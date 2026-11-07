import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHONE_MIN_DIGITS, phoneKey, phoneTerm, searchKey, searchTerms } from "./search-key";

/** Wie die Spalte durchsucht wird: jedes Wort des Suchtextes muss irgendwo in der Zeichenfolge vorkommen. */
const finds = (key: string, term: string) => searchTerms(term).length > 0 && searchTerms(term).every((word) => key.includes(word));

describe("searchKey / searchTerms", () => {
  const key = searchKey("Hans-Peter", "Müller", "Müller & Söhne GmbH", "K-1001");
  it("Groß-/Kleinschreibung spielt auch bei Umlauten keine Rolle", () => {
    assert.ok(finds(key, "MÜLLER"));
    assert.ok(finds(key, "müller"));
    assert.ok(finds(key, "söhne"));
  });
  it("Umlaut oder Zwei-Buchstaben-Schreibung oder ohne Punkte", () => {
    assert.ok(finds(key, "mueller"));
    assert.ok(finds(key, "Muller"));
    assert.ok(finds(key, "soehne"));
    assert.ok(finds(key, "sohne"));
  });
  it("ß wird zu ss, Akzente fallen weg", () => {
    assert.ok(finds(searchKey("Straße"), "strasse"));
    assert.ok(finds(searchKey("Straße"), "STRAßE"));
    assert.ok(finds(searchKey("Straße"), "strase") === false);
    assert.ok(finds(searchKey("André Çelik"), "andre celik"));
    assert.ok(finds(searchKey("André Çelik"), "andre"));
    assert.ok(finds(searchKey("André Çelik"), "celik"));
  });
  it("Bindestrich, Punkt und Leerzeichen sind gleich; die Reihenfolge der Wörter ist egal", () => {
    assert.ok(finds(key, "hans peter"));
    assert.ok(finds(key, "peter-hans"));
    assert.ok(finds(key, "k 1001"));
    assert.ok(finds(key, "müller hans"));
  });
  it("nicht Vorhandenes wird nicht gefunden; leerer Suchtext hat keine Wörter", () => {
    assert.equal(finds(key, "meier"), false);
    assert.deepEqual(searchTerms("  - . "), []);
    assert.deepEqual(searchTerms(""), []);
  });
  it("leere Teile und null werden übergangen", () => {
    assert.equal(searchKey(null, undefined, ""), "");
    assert.equal(searchKey("Golf", null, "VW"), "golf vw");
  });
  it("Prozentzeichen und Unterstrich sind keine Platzhalter mehr (werden zu Trennern)", () => {
    assert.deepEqual(searchTerms("a%b_c"), ["a", "b", "c"]);
  });
  it("Unicode: zerlegtes Ü (Mac) gleicht dem zusammengesetzten", () => {
    assert.equal(searchKey("Übel"), searchKey("Übel"));
  });
});

describe("phoneKey / phoneTerm", () => {
  it("Trenner und Landesvorwahl fallen weg", () => {
    assert.equal(phoneKey("0171/123456"), "0171123456");
    assert.equal(phoneKey("0171 123 456"), "0171123456");
    assert.equal(phoneKey("+49 171 123456"), "0171123456");
    assert.equal(phoneKey("0049 171 123456"), "0171123456");
    assert.equal(phoneKey("+49 (0)171 123456"), "0171123456");
    assert.equal(phoneKey("+41 44 123 45 67"), "0441234567");
    assert.equal(phoneKey("+43 1 234"), "01234");
  });
  it("leer ohne Ziffern", () => {
    assert.equal(phoneKey(null), "");
    assert.equal(phoneKey("n/a"), "");
  });
  it("ein Suchtext gilt erst ab drei Ziffern und ohne Buchstaben als Telefonnummer", () => {
    assert.equal(phoneTerm("0171 12"), "017112");
    assert.equal(phoneTerm("12"), null);
    assert.equal(phoneTerm("Meier 0171"), null);
    assert.equal(phoneTerm("+49 171"), "0171");
    assert.ok(PHONE_MIN_DIGITS >= 3);
  });
});
