import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decimalToCents, einvoiceDay, readEInvoice, type EInvoiceProposal } from "./extract";
import { XML_LIMITS, XmlError, parseXml } from "./xml";

const bytes = (text: string) => new TextEncoder().encode(text);

/** Selbst erzeugte Minimalbeispiele (UBL und CII), keine fremden Dateien. */
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>RE-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-03-14</cbc:IssueDate>
  <cbc:DueDate>2026-04-13</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Teile Müller</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:RegistrationName>Teile Müller &amp; Söhne GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Werkstatt Beispiel</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>2026-77</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20261105</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Reifen Großhandel AG</ram:Name></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Werkstatt Beispiel</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261205</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>840.34</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">159.66</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>1000.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>1000.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

const proposal = (xml: string): EInvoiceProposal => {
  const result = readEInvoice(bytes(xml));
  assert.ok(result.ok, JSON.stringify(result));
  return result.proposal;
};
const error = (xml: string | Uint8Array) => {
  const result = readEInvoice(typeof xml === "string" ? bytes(xml) : xml);
  assert.ok(!result.ok, "sollte abgelehnt werden");
  return result.error;
};

describe("E-Rechnung lesen: Vorschlag", () => {
  it("UBL-Rechnung: Nummer, Daten, Lieferant (Name des Rechtsträgers, mit Entität &amp;), Beträge", () => {
    assert.deepEqual(proposal(UBL), {
      syntax: "ubl",
      creditNote: false,
      number: "RE-2026-0042",
      issueDate: "2026-03-14",
      dueDate: "2026-04-13",
      seller: "Teile Müller & Söhne GmbH",
      buyer: "Werkstatt Beispiel",
      currency: "EUR",
      netCents: 10000,
      vatCents: 1900,
      grossCents: 11900,
      warnings: [],
    });
  });

  it("CII-Rechnung: Format 102 für Datum, Beträge aus der Summenzeile", () => {
    assert.deepEqual(proposal(CII), {
      syntax: "cii",
      creditNote: false,
      number: "2026-77",
      issueDate: "2026-11-05",
      dueDate: "2026-12-05",
      seller: "Reifen Großhandel AG",
      buyer: "Werkstatt Beispiel",
      currency: "EUR",
      netCents: 84034,
      vatCents: 15966,
      grossCents: 100000,
      warnings: [],
    });
  });

  it("UBL-Gutschrift (CreditNote): Beträge stehen negativ im Vorschlag", () => {
    const credit = UBL.replace("<Invoice ", "<CreditNote ").replace("</Invoice>", "</CreditNote>").replace("Invoice-2", "CreditNote-2");
    const p = proposal(credit);
    assert.equal(p.creditNote, true);
    assert.deepEqual([p.netCents, p.vatCents, p.grossCents], [-10000, -1900, -11900]);
  });

  it("CII mit TypeCode 381 ist eine Gutschrift", () => {
    const p = proposal(CII.replace("<ram:TypeCode>380", "<ram:TypeCode>381"));
    assert.equal(p.creditNote, true);
    assert.equal(p.grossCents, -100000);
  });

  it("warnt bei Fremdwährung, abweichender Summe und fehlenden Angaben", () => {
    assert.deepEqual(proposal(UBL.replace("<cbc:DocumentCurrencyCode>EUR", "<cbc:DocumentCurrencyCode>USD")).warnings, ["currency"]);
    assert.deepEqual(proposal(UBL.replace('currencyID="EUR">19.00', 'currencyID="EUR">25.00')).warnings, ["sum"]);
    assert.ok(proposal(UBL.replace("<cbc:ID>RE-2026-0042</cbc:ID>", "")).warnings.includes("missing"));
  });

  it("fehlende Steuer wird aus Brutto und Netto abgeleitet", () => {
    const p = proposal(UBL.replace(/<cac:TaxTotal>.*<\/cac:TaxTotal>/, ""));
    assert.equal(p.vatCents, 1900);
  });

  it("Steuer in der Dokumentwährung hat Vorrang vor einer zweiten Steuersumme in anderer Währung", () => {
    const two = UBL.replace("<cac:TaxTotal>", '<cac:TaxTotal><cbc:TaxAmount currencyID="CZK">470.00</cbc:TaxAmount></cac:TaxTotal><cac:TaxTotal>');
    assert.equal(proposal(two).vatCents, 1900);
  });

  it("nimmt Byte-Order-Mark, Leerraum vor der Deklaration, CDATA und Zeichenverweise an", () => {
    const p = proposal(`﻿  ${UBL.replace("Teile Müller &amp; Söhne GmbH", "<![CDATA[Teile <Müller>]]> &#x26; Co&#33;")}`);
    assert.equal(p.seller, "Teile <Müller> & Co!");
  });
});

describe("E-Rechnung lesen: Zahlen und Tage", () => {
  it("decimalToCents rundet ab der dritten Stelle kaufmännisch und lehnt Unfug ab", () => {
    assert.equal(decimalToCents("1234.56"), 123456);
    assert.equal(decimalToCents("0.005"), 1);
    assert.equal(decimalToCents("0.004"), 0);
    assert.equal(decimalToCents("-12.5"), -1250);
    assert.equal(decimalToCents("100"), 10000);
    assert.equal(decimalToCents("1,5"), null);
    assert.equal(decimalToCents("1e3"), null);
    assert.equal(decimalToCents(""), null);
    assert.equal(decimalToCents("9".repeat(13)), null);
  });
  it("einvoiceDay versteht JJJJ-MM-TT und JJJJMMTT und nur echte Tage", () => {
    assert.equal(einvoiceDay("2026-02-28"), "2026-02-28");
    assert.equal(einvoiceDay("20260228", "102"), "2026-02-28");
    assert.equal(einvoiceDay("2026-02-30"), null);
    assert.equal(einvoiceDay("20260229", "102"), null);
    assert.equal(einvoiceDay("202602", "610"), null);
    assert.equal(einvoiceDay("2026-02-28+01:00"), "2026-02-28");
    assert.equal(einvoiceDay("morgen"), null);
  });
});

describe("E-Rechnung lesen: nur bekannte Wurzeln, keine DTD, keine Entitäten", () => {
  it("unbekannte Wurzel oder falscher Namensraum: unsupported", () => {
    assert.equal(error('<?xml version="1.0"?><Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>'), "unsupported");
    assert.equal(error('<?xml version="1.0"?><Invoice xmlns="urn:fremd"><ID>1</ID></Invoice>'), "unsupported");
    assert.equal(error('<?xml version="1.0"?><Invoice><ID>1</ID></Invoice>'), "unsupported");
  });

  it("DOCTYPE wird abgelehnt – an jeder Stelle, auch hinter 2 KB (die Upload-Prüfung sieht nur den Anfang)", () => {
    assert.equal(error(`<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY x "y">]>${UBL}`), "doctype");
    assert.equal(error(UBL.replace("<cbc:ID>", `<!--${"x".repeat(4000)}--><!DOCTYPE a><cbc:ID>`)), "doctype");
  });

  it("externe Entität (XXE) und interne Entitäten (Billion Laughs) werden nie aufgelöst: Fehler", () => {
    assert.equal(error(`<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>&xxe;</ID></Invoice>`), "doctype");
    // ohne DOCTYPE bleibt eine unbekannte Entität ein Fehler
    assert.equal(error(UBL.replace("RE-2026-0042", "&xxe;")), "entity");
    assert.equal(error(UBL.replace("RE-2026-0042", "&lol9;")), "entity");
    assert.equal(error(UBL.replace("RE-2026-0042", "&amp")), "entity");
    assert.equal(error(UBL.replace("RE-2026-0042", "&#0;")), "entity");
    assert.equal(error(UBL.replace("RE-2026-0042", "&#xD800;")), "entity");
    assert.equal(error(UBL.replace("RE-2026-0042", "&#123456789;")), "entity");
    assert.equal(error(UBL.replace('currencyID="EUR">19.00', 'currencyID="&ext;">19.00')), "entity");
  });

  it("Verarbeitungsanweisungen (xml-stylesheet) und ein zweites <?xml ?> werden abgelehnt", () => {
    assert.equal(error(UBL.replace("<cbc:ID>", '<?xml-stylesheet href="x.xsl"?><cbc:ID>')), "instruction");
    assert.equal(error(UBL.replace("<cbc:ID>", '<?php echo 1 ?><cbc:ID>')), "instruction");
    assert.equal(error(UBL.replace("<Invoice ", '<?xml version="1.0"?><Invoice ')), "instruction");
  });

  it("nicht wohlgeformt: falsche Schachtelung, zweite Wurzel, Text außerhalb, ungeschlossen, doppeltes Attribut, unbekanntes Präfix", () => {
    for (const bad of [
      UBL.replace("</cbc:ID>", "</cbc:IssueDate>"),
      `${UBL}<Invoice/>`,
      `${UBL}text`,
      UBL.replace("</Invoice>", ""),
      UBL.replace('xmlns:cbc="', 'a="1" a="2" xmlns:cbc="'),
      UBL.replace("<cbc:ID>", "<zzz:ID>"),
      UBL.replace("<cbc:ID>", "<cbc:ID a=1>"),
      UBL.replace("<cbc:ID>", "<cbc:ID a='<'>"),
      "",
      "kein xml",
    ]) {
      assert.ok(["malformed", "notXml"].includes(error(bad)), bad.slice(0, 60));
    }
  });

  it("andere Kodierungen als UTF-8 werden abgelehnt (Deklaration und Bytes)", () => {
    assert.equal(error(UBL.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')), "encoding");
    assert.equal(error(new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x61, 0x3e])), "encoding");
  });
});

describe("E-Rechnung lesen: Obergrenzen und Laufzeit", () => {
  const nested = (depth: number) => `<a:r xmlns:a="x">${"<a:e>".repeat(depth)}${"</a:e>".repeat(depth)}</a:r>`;

  it("zu tief, zu viele Elemente, zu viele Attribute, zu groß, zu langer Name", () => {
    assert.throws(() => parseXml(bytes(nested(XML_LIMITS.depth + 2))), (e) => e instanceof XmlError && e.code === "tooDeep");
    assert.doesNotThrow(() => parseXml(bytes(nested(XML_LIMITS.depth - 2))));
    assert.throws(() => parseXml(bytes(`<r>${"<e/>".repeat(XML_LIMITS.elements + 1)}</r>`)), (e) => e instanceof XmlError && e.code === "tooManyNodes");
    const attrs = Array.from({ length: XML_LIMITS.attributes + 1 }, (_, i) => `a${i}="1"`).join(" ");
    assert.throws(() => parseXml(bytes(`<r ${attrs}/>`)), (e) => e instanceof XmlError && e.code === "tooManyAttributes");
    assert.throws(() => parseXml(new Uint8Array(XML_LIMITS.bytes + 1)), (e) => e instanceof XmlError && e.code === "tooLarge");
    assert.throws(() => parseXml(bytes(`<${"n".repeat(XML_LIMITS.name + 10)}/>`)), (e) => e instanceof XmlError && e.code === "malformed");
  });

  it("linear: pathologische Eingaben (viele &, viele <, lange Kommentare/Attribute) brauchen Millisekunden, nicht Sekunden", () => {
    const inputs = [
      `<r>${"&amp;".repeat(500_000)}</r>`,
      `<r>${"&".repeat(200_000)}</r>`,
      `<r>${"<!-- -->".repeat(200_000)}</r>`,
      `<r a="${"x".repeat(2_000_000)}"/>`,
      `<r>${"<e a='1'/>".repeat(100_000)}</r>`,
      `<r>${"<![CDATA[x]]>".repeat(100_000)}</r>`,
      `<?xml version="1.0" encoding="${"U".repeat(2_000_000)}"?><r/>`,
      `<?xml ${" ".repeat(2_000_000)}`,
      `<r>${"<".repeat(100_000)}`,
      `<r>${"a ".repeat(1_000_000)}</r>`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      try {
        parseXml(bytes(input));
      } catch (e) {
        assert.ok(e instanceof XmlError, "nur XmlError");
      }
      assert.ok(performance.now() - started < 8_000, `zu langsam: ${input.slice(0, 30)}`); // großzügig: ein quadratischer Parser brauchte hier Minuten bis Stunden, die Grenze soll nur Hänger finden, keine Last abbilden
    }
  });
});
