import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTotals } from "@/lib/line-items";
import { writeEinvoiceSample } from "@/test/einvoice-samples";
import { readEInvoice } from "./extract";
import { SMALL_BUSINESS_NOTE, buildUblXml, decimalCents, einvoiceProblems, EinvoiceError, unitCode, xmlText, type EinvoiceInput } from "./ubl";

/**
 * XRechnung (UBL): Pflichtangaben, Maskierung, Beträge, Vorzeichen der Gutschrift und die **Rundreise** über den Leser der Anwendung (`extract.ts`). Diese Datei schreibt ihre Beispiele
 * nach `EINVOICE_SAMPLES_DIR`; die Pipeline (Job `xrechnung`) prüft sie mit dem KoSIT-Prüfer – lokal läuft dieser Prüfer nicht (Java), hier gelten nur Struktur und Rundreise.
 */
const seller = { name: "Autohaus Müller & Söhne GmbH", street: "Hauptstraße 1", zip: "10115", city: "Berlin", email: "info@mueller.example", phone: "030 123456", contactName: "Erika Müller", vatId: "DE123456789", registerNumber: "HRB 12345" };
const buyer = { name: "Max Mustermann", street: "Nebenweg 2", zip: "50667", city: "Köln", email: "max@kunde.example" };
const base: EinvoiceInput = {
  type: "invoice",
  number: "2026-0001",
  issueDate: "2026-03-10",
  dueDate: "2026-03-24",
  serviceFrom: "2026-03-09",
  serviceTo: null,
  buyerReference: "KD-1001",
  orderNumber: "A-2026-0007",
  seller,
  buyer,
  smallBusiness: false,
  taxNote: null,
  lines: [
    { description: "Ölwechsel <inkl. Filter> & Entsorgung", unit: "Stk", quantityMilli: 1000, unitCents: 8900, taxBp: 1900, discountBp: 0 },
    { description: "Arbeitszeit", unit: "Std", quantityMilli: 1500, unitCents: 7500, taxBp: 1900, discountBp: 1000 },
    { description: "Fachbuch Reparaturanleitung", unit: "Stk", quantityMilli: 2000, unitCents: 1850, taxBp: 700, discountBp: 0 },
  ],
  payment: { method: "transfer", iban: "DE89370400440532013000", bic: "COBADEFFXXX", accountHolder: "Autohaus Müller & Söhne GmbH", reference: "Rechnung 2026-0001" },
  paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
  prepaid: { cents: 0, refs: [] },
};
const sample = (name: string, input: EinvoiceInput) => {
  const xml = buildUblXml(input);
  writeEinvoiceSample(name, xml);
  return xml;
};

describe("Maskierung", () => {
  it("xmlText maskiert Sonderzeichen und entfernt ungültige XML-Zeichen", () => {
    assert.equal(xmlText(`a & b <c> "d" 'e'`), "a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
    assert.equal(xmlText("a\u0000b\u000bc\ud800d"), "abcd");
    assert.equal(xmlText("Tab\tZeile\n"), "Tab\tZeile\n");
  });
  it("Texte der Positionen und Parteien landen nur maskiert im Dokument", () => {
    const xml = sample("masked.xml", { ...base, lines: [{ ...base.lines[0], description: `</cbc:Name><cbc:Name>X "Y" & Z` }], buyer: { ...buyer, name: "Müller <script>alert(1)</script>" } });
    assert.ok(!xml.includes("<script>"));
    assert.ok(xml.includes("&lt;script&gt;"));
    assert.ok(!xml.includes("</cbc:Name><cbc:Name>X"));
    const read = readEInvoice(new TextEncoder().encode(xml));
    assert.ok(read.ok, "der Leser akzeptiert das Dokument");
  });
});

describe("Pflichtangaben der XRechnung", () => {
  it("meldet fehlende Angaben als Codes und schreibt dann nichts", () => {
    const bad: EinvoiceInput = { ...base, buyerReference: "", seller: { ...seller, phone: null, email: null, vatId: null }, buyer: { ...buyer, email: null }, payment: { ...base.payment, iban: null } };
    const problems = einvoiceProblems(bad);
    for (const code of ["buyerReference", "sellerPhone", "sellerEmail", "sellerTaxId", "buyerEmail", "iban"]) assert.ok(problems.includes(code), code);
    assert.throws(() => buildUblXml(bad), EinvoiceError);
    assert.deepEqual(einvoiceProblems(base), []);
  });
  it("BR-DE-27/28 (Z6-6 L2): Telefon des Verkäufers mit mindestens drei Ziffern, E-Mail-Adressen mit genau einem @ – die Prüfliste meldet es vorab, es entsteht kein XML", () => {
    const phone = (value: string) => einvoiceProblems({ ...base, seller: { ...seller, phone: value } });
    assert.ok(phone("12").includes("sellerPhoneInvalid"));
    assert.ok(phone("ab-cd").includes("sellerPhoneInvalid"));
    assert.ok(!phone("12").includes("sellerPhone"), "gefüllt, aber ungültig: eigener Code");
    for (const ok of ["030 123456", "+49 (30) 12 34", "123", "0 1 2"]) assert.deepEqual(phone(ok), [], ok);
    const mail = (value: string) => einvoiceProblems({ ...base, seller: { ...seller, email: value } });
    for (const bad of ["info", "info@", "@mueller.example", "a@b@c.de", "info @mueller.example", "info@muel ler.de"]) assert.ok(mail(bad).includes("sellerEmailInvalid"), bad);
    assert.deepEqual(mail("info@mueller.example"), []);
    const buyerMail = (value: string) => einvoiceProblems({ ...base, buyer: { ...buyer, email: value } });
    assert.ok(buyerMail("kein-at").includes("buyerEmailInvalid"));
    assert.deepEqual(buyerMail("max@kunde.example"), []);
    assert.throws(() => buildUblXml({ ...base, seller: { ...seller, phone: "12" } }), EinvoiceError);
  });
  it("0 % ohne Kleinunternehmer verlangt den Grund der Steuerbefreiung", () => {
    const zero = { ...base, lines: [{ ...base.lines[0], taxBp: 0 }] };
    assert.ok(einvoiceProblems(zero).includes("taxNote"));
    assert.deepEqual(einvoiceProblems({ ...zero, taxNote: "Steuerfrei nach § 4 UStG" }), []);
  });
  it("Steuernummer genügt statt USt-IdNr.", () => {
    assert.deepEqual(einvoiceProblems({ ...base, seller: { ...seller, vatId: null, taxNumber: "12/345/67890" } }), []);
  });
});

describe("Rechnung (Rundreise)", () => {
  it("Beträge stimmen mit der Rechenregel überein und der Leser findet sie wieder", () => {
    const xml = sample("invoice-mixed-rates.xml", base);
    const totals = computeTotals(base.lines);
    const read = readEInvoice(new TextEncoder().encode(xml));
    assert.ok(read.ok);
    if (!read.ok) return;
    const p = read.proposal;
    assert.equal(p.syntax, "ubl");
    assert.equal(p.creditNote, false);
    assert.equal(p.number, "2026-0001");
    assert.equal(p.issueDate, "2026-03-10");
    assert.equal(p.dueDate, "2026-03-24");
    assert.equal(p.seller, seller.name);
    assert.equal(p.buyer, buyer.name);
    assert.equal(p.currency, "EUR");
    assert.equal(p.netCents, totals.netCents);
    assert.equal(p.vatCents, totals.taxCents);
    assert.equal(p.grossCents, totals.grossCents);
    assert.deepEqual(p.warnings, []);
    assert.ok(xml.includes('<cbc:TaxExemptionReason>') === false, "ohne Befreiung kein Grund");
  });
  it("Rabatt steht als Nachlass der Position, der Einzelpreis bleibt positiv", () => {
    const xml = buildUblXml(base);
    assert.ok(xml.includes("<cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>"));
    assert.ok(xml.includes('<cbc:PriceAmount currencyID="EUR">75.00</cbc:PriceAmount>'));
    assert.ok(!/<cbc:PriceAmount[^>]*>-/.test(xml));
  });
  it("negativer Einzelpreis wandert in die Menge (BR-27), die Summe bleibt", () => {
    const lines = [...base.lines, { description: "Kulanz", unit: "", quantityMilli: 1000, unitCents: -1000, taxBp: 1900, discountBp: 0 }];
    const xml = sample("invoice-negative-price.xml", { ...base, lines });
    assert.ok(!/<cbc:PriceAmount[^>]*>-/.test(xml));
    const read = readEInvoice(new TextEncoder().encode(xml));
    assert.ok(read.ok && read.proposal.grossCents === computeTotals(lines).grossCents);
  });
  it("Leistungszeitraum als InvoicePeriod, einzelner Tag als Lieferdatum", () => {
    assert.ok(buildUblXml({ ...base, serviceTo: "2026-03-12" }).includes("<cac:InvoicePeriod><cbc:StartDate>2026-03-09</cbc:StartDate><cbc:EndDate>2026-03-12</cbc:EndDate></cac:InvoicePeriod>"));
    assert.ok(buildUblXml(base).includes("<cbc:ActualDeliveryDate>2026-03-09</cbc:ActualDeliveryDate>"));
  });
  it("0 % mit Grund: Kategorie E und Grund an der Steuergruppe", () => {
    const xml = sample("invoice-zero-rate.xml", { ...base, lines: [{ ...base.lines[0], taxBp: 0 }, base.lines[1]], taxNote: "Steuerfreie Leistung" });
    assert.ok(xml.includes("<cbc:TaxExemptionReason>Steuerfreie Leistung</cbc:TaxExemptionReason>"));
    assert.ok(xml.includes("<cbc:ID>E</cbc:ID>"));
  });
});

describe("Kleinunternehmer § 19 UStG", () => {
  it("keine Steuer, Kategorie E mit Grund, Brutto gleich Netto", () => {
    const xml = sample("invoice-small-business.xml", { ...base, smallBusiness: true, seller: { ...seller, vatId: null, taxNumber: "12/345/67890" } });
    const totals = computeTotals(base.lines, { exempt: true });
    assert.equal(totals.taxCents, 0);
    assert.ok(xml.includes(`<cbc:TaxExemptionReason>${SMALL_BUSINESS_NOTE}</cbc:TaxExemptionReason>`));
    assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>'));
    assert.ok(!xml.includes("<cbc:ID>S</cbc:ID>"));
    assert.ok(xml.includes("<cbc:ID>FC</cbc:ID>"), "Steuernummer mit Schema FC");
    const read = readEInvoice(new TextEncoder().encode(xml));
    assert.ok(read.ok && read.proposal.grossCents === totals.netCents && read.proposal.vatCents === 0);
  });
});

describe("Verkäuferkennung (BR-CO-26)", () => {
  const ids = (xml: string) => ({
    vat: xml.includes("<cbc:CompanyID>DE123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID>"),
    fc: xml.includes("<cbc:CompanyID>12/345/67890</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID>"),
    register: xml.includes("<cbc:CompanyID>HRB 12345</cbc:CompanyID></cac:PartyLegalEntity>"),
    identification: xml.includes("<cac:PartyIdentification><cbc:ID>12/345/67890</cbc:ID></cac:PartyIdentification>"),
  });
  const withSeller = (extra: Partial<EinvoiceInput["seller"]>) => buildUblXml({ ...base, seller: { ...seller, ...extra } });

  it("nur USt-IdNr.: BT-31", () => {
    assert.deepEqual(ids(withSeller({ registerNumber: null })), { vat: true, fc: false, register: false, identification: false });
  });
  it("USt-IdNr. und Steuernummer: BT-31 und BT-32, keine zusätzliche Kennung", () => {
    assert.deepEqual(ids(withSeller({ registerNumber: null, taxNumber: "12/345/67890" })), { vat: true, fc: true, register: false, identification: false });
  });
  it("nur Steuernummer (Kleinunternehmer ohne USt-IdNr. und Register): BT-32 und – für BR-CO-26 – als Kennung BT-29", () => {
    const xml = withSeller({ vatId: null, registerNumber: null, taxNumber: "12/345/67890" });
    assert.deepEqual(ids(xml), { vat: false, fc: true, register: false, identification: true });
    // Reihenfolge im Party-Element: EndpointID, PartyIdentification, PartyName, PostalAddress, PartyTaxScheme, PartyLegalEntity, Contact
    const order = ["<cbc:EndpointID", "<cac:PartyIdentification>", "<cac:PartyName>", "<cac:PostalAddress>", "<cac:PartyTaxScheme>", "<cac:PartyLegalEntity>", "<cac:Contact>"].map((tag) => xml.indexOf(tag));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every((i) => i >= 0));
  });
  it("Steuernummer und Registernummer: BT-32 und BT-30 (BT-29 überflüssig)", () => {
    assert.deepEqual(ids(withSeller({ vatId: null, taxNumber: "12/345/67890" })), { vat: false, fc: true, register: true, identification: false });
  });
  it("ohne jede Kennung keine XRechnung", () => {
    assert.ok(einvoiceProblems({ ...base, seller: { ...seller, vatId: null, registerNumber: null } }).includes("sellerTaxId"));
  });
});

describe("Zahlungsbedingung (BR-CO-25)", () => {
  it("ein positiver Zahlbetrag braucht Fälligkeit oder Zahlungsbedingungen", () => {
    assert.deepEqual(einvoiceProblems({ ...base, dueDate: null, paymentTerms: null }), ["paymentTerms"]);
    assert.deepEqual(einvoiceProblems({ ...base, dueDate: "2026-03-24", paymentTerms: null }), []);
    assert.deepEqual(einvoiceProblems({ ...base, dueDate: null, paymentTerms: "Zahlbar sofort." }), []);
  });
  it("Zahlbetrag 0 (voll angerechnet) braucht keine", () => {
    const gross = computeTotals(base.lines).grossCents;
    assert.deepEqual(einvoiceProblems({ ...base, dueDate: null, paymentTerms: null, prepaid: { cents: gross, refs: [] } }), []);
  });
  it("die Gutschrift trägt die Zahlungsbedingung als Text in cac:PaymentTerms, nie ein erfundenes Fälligkeitsdatum", () => {
    const negated = base.lines.map((line) => ({ ...line, quantityMilli: -line.quantityMilli }));
    const input: EinvoiceInput = { ...base, type: "credit", number: "2026-0002", dueDate: null, paymentTerms: "Gutschrift: kein Zahlungsziel.", lines: negated, creditOf: { number: "2026-0001", issueDate: "2026-03-10" } };
    const xml = buildUblXml(input);
    assert.ok(xml.includes("<cac:PaymentTerms><cbc:Note>Gutschrift: kein Zahlungsziel.</cbc:Note></cac:PaymentTerms>"));
    assert.ok(!xml.includes("PaymentDueDate") && !xml.includes("<cbc:DueDate>"));
    assert.ok(xml.indexOf("<cac:PaymentMeans>") < xml.indexOf("<cac:PaymentTerms>") && xml.indexOf("<cac:PaymentTerms>") < xml.indexOf("<cac:TaxTotal>"), "Reihenfolge PaymentMeans, PaymentTerms, TaxTotal");
    assert.deepEqual(einvoiceProblems({ ...input, paymentTerms: null }), ["paymentTerms"]);
  });
});

describe("Stornorechnung (Gutschrift)", () => {
  it("UBL-CreditNote mit positiven Beträgen, Bezug auf das Original; der Leser liest negative Beträge", () => {
    const negated = base.lines.map((line) => ({ ...line, quantityMilli: -line.quantityMilli }));
    const xml = sample("credit-note.xml", { ...base, type: "credit", number: "2026-0002", lines: negated, creditOf: { number: "2026-0001", issueDate: "2026-03-10" } });
    assert.ok(xml.includes("<CreditNote "));
    assert.ok(xml.includes("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>"));
    assert.ok(xml.includes("<cac:CreditNoteLine>"));
    assert.ok(xml.includes("<cbc:ID>2026-0001</cbc:ID><cbc:IssueDate>2026-03-10</cbc:IssueDate></cac:InvoiceDocumentReference>"));
    assert.ok(!xml.includes("<cbc:DueDate>"), "UBL-Gutschriften kennen kein DueDate");
    const read = readEInvoice(new TextEncoder().encode(xml));
    assert.ok(read.ok);
    if (!read.ok) return;
    const original = computeTotals(base.lines);
    assert.equal(read.proposal.creditNote, true);
    assert.equal(read.proposal.grossCents, -original.grossCents);
    assert.equal(read.proposal.vatCents, -original.taxCents);
  });
});

describe("Korrekturposition mit negativer Menge und Rabatt", () => {
  it("der Rabatt wird zum Aufschlag mit positivem Betrag (EN 16931 kennt keine negativen Beträge)", () => {
    const lines = [...base.lines, { description: "Rückgabe", unit: "Stk", quantityMilli: -1000, unitCents: 10000, taxBp: 1900, discountBp: 1000 }];
    const xml = buildUblXml({ ...base, lines });
    assert.ok(!/<cbc:Amount[^>]*>-/.test(xml));
    assert.ok(xml.includes('<cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Rabatt (Korrekturposition)</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">10.00</cbc:Amount>'));
  });
});

describe("Abschlag und Schlussrechnung", () => {
  it("Abschlagsrechnung hat den Typ 326", () => {
    const xml = sample("partial-invoice.xml", { ...base, type: "partial", lines: [{ description: "Abschlag 30 %", unit: "", quantityMilli: 1000, unitCents: 30000, taxBp: 1900, discountBp: 0 }] });
    assert.ok(xml.includes("<cbc:InvoiceTypeCode>326</cbc:InvoiceTypeCode>"));
  });
  it("Schlussrechnung rechnet Abschläge ab: Vorauszahlung und Zahlbetrag, Verweise auf die Abschläge", () => {
    const gross = computeTotals(base.lines).grossCents;
    const prepaid = 10000;
    const xml = sample("final-invoice.xml", { ...base, number: "2026-0003", prepaid: { cents: prepaid, refs: [{ number: "2026-0001", issueDate: "2026-02-01" }] } });
    assert.ok(xml.includes(`<cbc:PrepaidAmount currencyID="EUR">${decimalCents(prepaid)}</cbc:PrepaidAmount>`));
    assert.ok(xml.includes(`<cbc:PayableAmount currencyID="EUR">${decimalCents(gross - prepaid)}</cbc:PayableAmount>`));
    assert.ok(xml.includes("<cac:BillingReference>"));
    assert.ok(einvoiceProblems({ ...base, prepaid: { cents: gross + 1, refs: [] } }).includes("prepaid"), "mehr angerechnet als berechnet ist ungültig");
  });
});

describe("Hilfsfunktionen", () => {
  it("decimalCents und unitCode", () => {
    assert.equal(decimalCents(0), "0.00");
    assert.equal(decimalCents(-1205), "-12.05");
    assert.equal(decimalCents(5), "0.05");
    assert.equal(unitCode("Std."), "HUR");
    assert.equal(unitCode("kg"), "KGM");
    assert.equal(unitCode("AW"), "C62");
    assert.equal(unitCode("irgendwas"), "C62");
  });
});
