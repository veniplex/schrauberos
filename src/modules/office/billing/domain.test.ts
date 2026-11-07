import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { numberSlot, renderNumber } from "@/lib/invoice-numbering";
import { billingPaymentState, dueDayKey, documentFileName, finalizeProblems, isDraft, isSmallAmount, mailContent, offerState, payableCents, remainingCents, statusAfterPayments, type FinalizeCheckInput } from "./domain";

const d = (s: string) => new Date(`${s}T12:00:00+01:00`);
const now = new Date("2026-11-05T12:00:00+01:00");

describe("Nummernkreise", () => {
  it("Rechnungen aller Arten teilen eine Reihe nach dem Muster des Profils; der Zähler beginnt neu, wenn sich ein Zeitplatzhalter ändert", () => {
    assert.deepEqual(numberSlot("invoice", "{YYYY}-{NNNN}", { year: 2026, month: 3 }), { key: "invoices", year: 2026, format: "{YYYY}-{NNNN}" });
    assert.equal(numberSlot("credit", "{YYYY}-{NNNN}", { year: 2026, month: 3 }).key, numberSlot("final", "{YYYY}-{NNNN}", { year: 2026, month: 3 }).key);
    assert.equal(numberSlot("invoice", "RE-{YY}{MM}-{NNN}", { year: 2026, month: 3 }).year, 202603, "monatlich");
    assert.equal(numberSlot("invoice", "RE-{NNNNNN}", { year: 2026, month: 3 }).year, 0, "ohne Jahreswechsel");
    assert.deepEqual(numberSlot("invoice", "kaputt", { year: 2026, month: 3 }), { key: "invoices", year: 2026, format: "{YYYY}-{NNNN}" }, "ungültiges Muster: Standard");
  });
  it("Angebote und Auftragsbestätigungen haben eigene, jährliche Reihen mit Präfix", () => {
    const offer = numberSlot("offer", "{YYYY}-{NNNN}", { year: 2026, month: 3 });
    assert.deepEqual([offer.key, offer.year], ["offers", 2026]);
    assert.equal(renderNumber(offer, { year: 2026, month: 3 }, 7), "AN-2026-0007");
    assert.equal(renderNumber(numberSlot("confirmation", null, { year: 2027, month: 1 }), { year: 2027, month: 1 }, 12), "AB-2027-0012");
  });
});

const base: FinalizeCheckInput = {
  docType: "invoice",
  sender: { name: "Werkstatt", street: "Weg 1", zip: "10115", city: "Berlin", taxNumber: "12/345/67890", vatId: null, iban: "DE89370400440532013000", smallBusiness: false },
  recipient: { name: "Kunde", street: "Straße 2", zip: "50667", city: "Köln" },
  serviceFrom: "2026-03-01",
  serviceTo: null,
  validUntil: null,
  paymentDays: 14,
  paymentMethod: "transfer",
  itemCount: 1,
  taxRates: [1900],
  taxNote: null,
  exceedsLimit: false,
  grossCents: 11900,
};

describe("Pflichtangaben vor dem Festschreiben (§ 14 UStG als Prüfliste)", () => {
  it("vollständig: keine Befunde", () => assert.deepEqual(finalizeProblems(base), []));

  it("jede fehlende Pflichtangabe wird einzeln genannt", () => {
    const bare = finalizeProblems({
      ...base,
      sender: { name: "", street: null, zip: null, city: null, taxNumber: null, vatId: null, iban: null, smallBusiness: false },
      recipient: { name: " ", street: "x", zip: null, city: "y" },
      serviceFrom: null,
      paymentDays: null,
      itemCount: 0,
    });
    for (const code of ["senderName", "senderAddress", "senderTaxId", "recipientName", "recipientAddress", "serviceDate", "paymentDays", "iban", "noItems"]) assert.ok(bare.includes(code), code);
  });

  it("Steuernummer ODER USt-IdNr. genügt; die IBAN braucht nur die Überweisung; der Leistungszeitraum darf nicht rückwärts laufen", () => {
    assert.deepEqual(finalizeProblems({ ...base, sender: { ...base.sender, taxNumber: null, vatId: "DE123456789" } }), []);
    assert.deepEqual(finalizeProblems({ ...base, paymentMethod: "cash", sender: { ...base.sender, iban: null } }), []);
    assert.ok(finalizeProblems({ ...base, serviceFrom: "2026-03-10", serviceTo: "2026-03-01" }).includes("serviceRange"));
  });

  it("Steuersätze: nur 19/7/0 %; 0 % verlangt den Grund der Steuerbefreiung; beim Kleinunternehmer entfällt beides", () => {
    assert.ok(finalizeProblems({ ...base, taxRates: [1900, 1500] }).includes("taxRate"));
    assert.ok(finalizeProblems({ ...base, taxRates: [0] }).includes("taxNote"));
    assert.deepEqual(finalizeProblems({ ...base, taxRates: [0], taxNote: "steuerfrei" }), []);
    assert.deepEqual(finalizeProblems({ ...base, sender: { ...base.sender, smallBusiness: true }, taxRates: [0, 1500] }), []);
  });

  it("Angebote und Auftragsbestätigungen: kürzere Liste (keine Steuer-, Zahlungs- und Leistungsangaben), Angebote brauchen die Gültigkeit", () => {
    const offer = { ...base, docType: "offer", serviceFrom: null, paymentDays: null, paymentMethod: "transfer", sender: { ...base.sender, taxNumber: null, iban: null }, validUntil: null };
    assert.deepEqual(finalizeProblems(offer), ["validUntil"]);
    assert.deepEqual(finalizeProblems({ ...offer, validUntil: "2026-12-01" }), []);
    assert.deepEqual(finalizeProblems({ ...offer, docType: "confirmation" }), []);
    assert.ok(finalizeProblems({ ...offer, validUntil: "2026-12-01", itemCount: 0 }).includes("noItems"));
  });

  it("zu große Summen verhindern das Festschreiben", () => assert.ok(finalizeProblems({ ...base, exceedsLimit: true }).includes("tooLarge")));

  it("eine Rechnung über 0 € oder einen negativen Betrag lässt sich nicht festschreiben (korrigiert wird mit der Stornorechnung); Angebote bleiben möglich", () => {
    assert.ok(finalizeProblems({ ...base, grossCents: 0 }).includes("amount"));
    assert.ok(finalizeProblems({ ...base, grossCents: -5950 }).includes("amount"));
    assert.ok(finalizeProblems({ ...base, docType: "final", grossCents: 0 }).includes("amount"));
    assert.deepEqual(finalizeProblems({ ...base, docType: "offer", validUntil: "2026-12-01", grossCents: 0 }), []);
  });
});

describe("Zahlstatus", () => {
  const inv = { status: "open", dueDate: d("2026-12-01"), grossCents: 10000, deductedCents: 0, paidCents: 0 };
  it("offen, teilweise bezahlt, überfällig, bezahlt, storniert", () => {
    assert.equal(billingPaymentState(inv, now), "open");
    assert.equal(billingPaymentState({ ...inv, paidCents: 4000 }, now), "partial");
    assert.equal(billingPaymentState({ ...inv, dueDate: d("2026-10-01") }, now), "overdue");
    assert.equal(billingPaymentState({ ...inv, dueDate: d("2026-10-01"), paidCents: 4000 }, now), "overdue", "überfällig gewinnt vor teilweise");
    assert.equal(billingPaymentState({ ...inv, status: "paid", paidCents: 10000 }, now), "paid");
    assert.equal(billingPaymentState({ ...inv, status: "cancelled" }, now), "cancelled");
  });
  it("zu zahlen und offen: Abschläge und Zahlungen werden abgezogen, nie negativ", () => {
    assert.equal(payableCents({ grossCents: 23800, deductedCents: 5950 }), 17850);
    assert.equal(remainingCents({ grossCents: 23800, deductedCents: 5950, paidCents: 10000 }), 7850);
    assert.equal(remainingCents({ grossCents: 1000, deductedCents: 0, paidCents: 5000 }), 0);
  });
  it("bezahlt, sobald nichts mehr zu zahlen ist", () => {
    assert.equal(statusAfterPayments({ grossCents: 10000, deductedCents: 0 }, 0), "open");
    assert.equal(statusAfterPayments({ grossCents: 10000, deductedCents: 0 }, 9999), "open");
    assert.equal(statusAfterPayments({ grossCents: 10000, deductedCents: 0 }, 10000), "paid");
    assert.equal(statusAfterPayments({ grossCents: 10000, deductedCents: 10000 }, 0), "paid", "ein Zahlbetrag von 0 (Abschläge voll angerechnet) gilt als bezahlt");
  });
});

describe("Angebot und Entwurf", () => {
  it("abgelaufen = offen und Gültigkeit vor heute; angenommen und abgelehnt bleiben", () => {
    assert.equal(offerState({ offerStatus: "open", validUntil: d("2026-11-04") }, now), "expired");
    assert.equal(offerState({ offerStatus: "open", validUntil: d("2026-11-05") }, now), "open");
    assert.equal(offerState({ offerStatus: "accepted", validUntil: d("2026-01-01") }, now), "accepted");
    assert.equal(offerState({ offerStatus: "rejected", validUntil: null }, now), "rejected");
  });
  it("ein Entwurf ist ein Beleg der Rechnungserstellung ohne Festschreibung; von Hand erfasste Rechnungen sind nie Entwürfe", () => {
    assert.equal(isDraft({ source: "billing", finalizedAt: null }), true);
    assert.equal(isDraft({ source: "billing", finalizedAt: new Date() }), false);
    assert.equal(isDraft({ source: "manual", finalizedAt: null }), false);
  });
  it("Kleinbetrag nur als Hinweis: bis 250 € brutto, auch negativ", () => {
    assert.equal(isSmallAmount(25000), true);
    assert.equal(isSmallAmount(25001), false);
    assert.equal(isSmallAmount(-25000), true);
  });
  it("Fälligkeit: Rechnungsdatum plus Zahlungsziel", () => assert.equal(dueDayKey("2026-02-20", 14), "2026-03-06"));
});

describe("Mailtext und Dateinamen", () => {
  const input = { docType: "invoice", number: "2026-0001", recipientName: "Max Mustermann", amountCents: 11900, dueDate: "2026-03-24", validUntil: null, workshopName: "Autohaus Müller", hasXml: false };
  it("feste Vorlage mit Nummer, Name, Betrag und Datum", () => {
    const { subject, text } = mailContent(input);
    assert.equal(subject, "Rechnung 2026-0001 – Autohaus Müller");
    assert.match(text, /^Guten Tag Max Mustermann,/);
    assert.match(text, /unsere Rechnung Nr\. 2026-0001 über 119,00 €\./);
    assert.match(text, /bis zum 24\.03\.2026/);
    assert.ok(!text.includes("XRechnung"));
    assert.match(mailContent({ ...input, hasXml: true }).text, /XRechnung/);
    assert.match(mailContent({ ...input, docType: "offer", dueDate: null, validUntil: "2026-12-01" }).text, /gültig bis 01\.12\.2026/);
  });
  it("Namen sind einzeilig: Zeilenumbrüche, Steuerzeichen und Umkehrzeichen werden entfernt (keine Einschleusung in Betreff und Text)", () => {
    const evil = mailContent({ ...input, recipientName: "Max\r\nBcc: boese@example.com‮\u0000", workshopName: "Werkstatt\nX-Header: 1" });
    assert.ok(!evil.subject.includes("\n") && !evil.subject.includes("\r"));
    assert.ok(!evil.text.split("\n").some((line) => line.startsWith("Bcc:")), "Bcc steht nicht am Zeilenanfang");
    assert.ok(!evil.text.includes("‮") && !evil.text.includes("\u0000"));
    assert.equal(evil.text.split("\n")[0], "Guten Tag Max Bcc: boese@example.com,");
  });
  it("Dateinamen sind sicher: Rechnung_2026-0001.pdf, …_xrechnung.xml, Entwurf ohne Nummer", () => {
    assert.equal(documentFileName("invoice", "2026-0001", "pdf"), "Rechnung_2026-0001.pdf");
    assert.equal(documentFileName("credit", "2026/0002", "xml"), "Stornorechnung_2026-0002_xrechnung.xml");
    assert.equal(documentFileName("offer", "", "pdf"), "Angebot_Entwurf.pdf");
    assert.equal(documentFileName("invoice", "../../etc/passwd", "pdf"), "Rechnung_etc-passwd.pdf");
  });
});
