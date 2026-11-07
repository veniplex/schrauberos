import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EPC_MAX_AMOUNT_CENTS, EPC_MAX_BYTES, epcPayload } from "./girocode";
import { qrMatrix } from "./qr";

const base = { name: "Autohaus Müller GmbH", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX", amountCents: 12345, reference: "Rechnung 2026-0001" };

describe("Girocode (EPC069-12, Version 002, UTF-8)", () => {
  it("Aufbau: Kennung, Version, Zeichensatz 1 = UTF-8, SCT, BIC, Name, IBAN, Betrag, Verwendungszweck", () => {
    const lines = epcPayload(base)!.split("\n");
    assert.deepEqual(lines, ["BCD", "002", "1", "SCT", "COBADEFFXXX", "Autohaus Müller GmbH", "DE89370400440532013000", "EUR123.45", "", "", "Rechnung 2026-0001"]);
  });

  it("Umlaute und Euro-Zeichen bleiben erhalten (UTF-8, nicht Latin-1) und der QR-Code lässt sich daraus bauen", () => {
    const payload = epcPayload({ ...base, name: "Müller & Söhne – Größe €", reference: "Rechnung für Öl (5 €)" })!;
    assert.ok(payload.includes("Müller & Söhne – Größe €"));
    assert.ok(payload.includes("Rechnung für Öl (5 €)"));
    const matrix = qrMatrix(payload);
    assert.ok(matrix.size >= 21);
    assert.ok(new TextEncoder().encode(payload).length <= EPC_MAX_BYTES);
  });

  it("Betrag: ganze Euro, Cent mit führender Null, Grenzen; ungültig → kein Code", () => {
    assert.ok(epcPayload({ ...base, amountCents: 5 })!.includes("EUR0.05"));
    assert.ok(epcPayload({ ...base, amountCents: 100000 })!.includes("EUR1000.00"));
    assert.equal(epcPayload({ ...base, amountCents: 0 }), null);
    assert.equal(epcPayload({ ...base, amountCents: -100 }), null);
    assert.equal(epcPayload({ ...base, amountCents: 1.5 }), null);
    assert.equal(epcPayload({ ...base, amountCents: EPC_MAX_AMOUNT_CENTS + 1 }), null);
    assert.ok(epcPayload({ ...base, amountCents: EPC_MAX_AMOUNT_CENTS })!.includes("EUR999999999.99"));
  });

  it("IBAN und BIC werden geprüft; die BIC ist optional", () => {
    assert.equal(epcPayload({ ...base, iban: "DE00 0000 0000 0000 0000 00" }), null);
    assert.equal(epcPayload({ ...base, bic: "kaputt" }), null);
    assert.equal(epcPayload({ ...base, bic: null })!.split("\n")[4], "");
  });

  it("Name höchstens 70, Verwendungszweck höchstens 140 Zeichen; Zeilenumbrüche würden die Struktur zerstören und entfallen", () => {
    const payload = epcPayload({ ...base, name: "A".repeat(100), reference: `Zeile 1\nZeile 2\r\nZeile 3 ${"x".repeat(200)}` })!;
    const lines = payload.split("\n");
    assert.equal(lines.length, 11, "keine zusätzlichen Zeilen");
    assert.equal(lines[5].length, 70);
    assert.ok(Array.from(lines[10]).length <= 140);
    assert.ok(lines[10].startsWith("Zeile 1 Zeile 2 Zeile 3"));
    assert.equal(epcPayload({ ...base, name: "  \n " }), null, "ohne Namen kein Code");
  });

  it("insgesamt höchstens 331 Bytes", () => {
    assert.equal(epcPayload({ ...base, name: "Ö".repeat(70), reference: "Ö".repeat(140) }), null);
    assert.ok(epcPayload({ ...base, name: "Ö".repeat(70), reference: "Ö".repeat(60) }));
  });
});
