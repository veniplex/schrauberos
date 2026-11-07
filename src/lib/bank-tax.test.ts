import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatIban, formatVatId, isValidBic, isValidIban, isValidTaxNumber, isValidVatId, normalizeIban, normalizeVatId } from "./bank-tax";

describe("IBAN", () => {
  it("erkennt gültige IBAN (Prüfsumme mod 97) in jeder Schreibweise", () => {
    for (const iban of ["DE89 3704 0044 0532 0130 00", "de89370400440532013000", "AT61 1904 3002 3457 3201", "CH93 0076 2011 6238 5295 7", "LI21 0881 0000 2324 013A A", "GB82 WEST 1234 5698 7654 32", "FR14 2004 1010 0505 0001 3M02 606"]) assert.ok(isValidIban(iban), iban);
  });

  it("lehnt Tippfehler, falsche Länge und Unsinn ab", () => {
    for (const iban of ["DE89 3704 0044 0532 0130 01", "DE89 3704 0044 0532 0130 0", "DE89 3704 0044 0532 0130 000", "AT61 1904 3002 3457 320", "CH93 0076 2011 6238 5295", "DE00 0000 0000 0000 0000 00", "", "1234", "DE8937040044053201300!"]) assert.ok(!isValidIban(iban), iban);
    // vertauschte Ziffern fallen auf
    assert.ok(!isValidIban("DE89 3704 0044 0532 0310 00"));
  });

  it("normalisiert und formatiert in Vierergruppen", () => {
    assert.equal(normalizeIban(" de89 3704 0044 0532 0130 00 "), "DE89370400440532013000");
    assert.equal(formatIban("DE89370400440532013000"), "DE89 3704 0044 0532 0130 00");
  });
});

describe("BIC", () => {
  it("8 oder 11 Zeichen", () => {
    for (const bic of ["COBADEFFXXX", "cobadeff", "GENODEF1S02", "POFICHBEXXX"]) assert.ok(isValidBic(bic), bic);
    for (const bic of ["COBADEF", "COBADEFFXX", "1234DEFF", "COBA-DEFF"]) assert.ok(!isValidBic(bic), bic);
  });
});

describe("USt-IdNr.", () => {
  it("Deutschland: DE und neun Ziffern", () => {
    for (const id of ["DE123456789", "DE 123 456 789", "de123456789"]) assert.ok(isValidVatId(id), id);
    for (const id of ["DE12345678", "DE1234567890", "DE12345678A", "123456789"]) assert.ok(!isValidVatId(id), id);
  });

  it("Österreich: ATU und acht Ziffern", () => {
    assert.ok(isValidVatId("ATU12345678") && isValidVatId("AT U 12345678"));
    for (const id of ["AT12345678", "ATU1234567", "ATU123456789"]) assert.ok(!isValidVatId(id), id);
  });

  it("Schweiz: UID mit Zusatz MWST, TVA oder IVA", () => {
    for (const id of ["CHE-123.456.789 MWST", "CHE123456789MWST", "CHE-123.456.789 TVA", "CHE-123.456.789 IVA", "CHE-123.456.789"]) assert.ok(isValidVatId(id), id);
    for (const id of ["CHE-123.456.78 MWST", "CH123456789", "CHE-123.456.789 XYZ"]) assert.ok(!isValidVatId(id), id);
    assert.equal(formatVatId("CHE123456789MWST"), "CHE-123.456.789 MWST");
    assert.equal(normalizeVatId("DE 123.456-789"), "DE123456789");
  });

  it("andere EU-Länder nachsichtig, Nicht-EU nicht", () => {
    assert.ok(isValidVatId("FR12345678901") && isValidVatId("IT12345678901") && isValidVatId("NL123456789B01"));
    assert.ok(!isValidVatId("US123456789") && !isValidVatId("XX123456789") && !isValidVatId("FR1"));
  });
});

describe("Steuernummer", () => {
  it("nimmt übliche Schreibweisen an", () => {
    for (const number of ["21/815/08150", "181/815/08155", "2181508150123", "12-345/6789", "93 815 08152"]) assert.ok(isValidTaxNumber(number), number);
  });
  it("lehnt Buchstaben, zu kurze und zu lange Eingaben ab", () => {
    for (const number of ["", "abc", "12/34", "21/815/08150a", "1234567890123456789012", "/21/815/08150"]) assert.ok(!isValidTaxNumber(number), number);
  });
});
