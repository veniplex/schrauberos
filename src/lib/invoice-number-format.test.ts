import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_INVOICE_NUMBER_FORMAT, counterKey, formatInvoiceNumber, parseInvoiceNumberFormat, previewInvoiceNumbers } from "./invoice-number-format";

const when = { year: 2026, month: 3 };

describe("Rechnungsnummer-Muster", () => {
  it("der Standard ist gültig und ergibt 2026-0001", () => {
    assert.equal(formatInvoiceNumber(DEFAULT_INVOICE_NUMBER_FORMAT, when, 1), "2026-0001");
    assert.deepEqual(previewInvoiceNumbers(DEFAULT_INVOICE_NUMBER_FORMAT, when), ["2026-0001", "2026-0002", "2026-0123"]);
  });

  it("Platzhalter für Jahr, Monat und Zähler in beliebiger Reihenfolge, mit Text", () => {
    assert.equal(formatInvoiceNumber("RE-{YY}{MM}-{NNN}", when, 7), "RE-2603-007");
    assert.equal(formatInvoiceNumber("{NNNNNN}/{YYYY}", when, 42), "000042/2026");
    assert.equal(formatInvoiceNumber("R{N}", when, 12345), "R12345", "der Zähler darf wachsen");
    assert.equal(formatInvoiceNumber("{YY}-{NN}", { year: 2105, month: 1 }, 3), "05-03");
  });

  it("lehnt ungültige Muster mit einem Grund ab", () => {
    const error = (format: string) => {
      const parsed = parseInvoiceNumberFormat(format);
      return parsed.ok ? null : parsed.error;
    };
    assert.equal(error(""), "empty");
    assert.equal(error("   "), "empty");
    assert.equal(error("{YYYY}"), "noCounter");
    assert.equal(error("{NNNN}{NN}"), "manyCounters");
    assert.equal(error("{MM}-{NNNN}"), "monthWithoutYear");
    assert.equal(error("{YYYY}-{XXXX}"), "unknown");
    assert.equal(error("{NNNNNNNNN}"), "unknown", "höchstens acht Stellen");
    assert.equal(error("{YYYY-{NNNN}"), "unknown");
    assert.equal(error("{YYYY"), "brace");
    assert.equal(error("Re}{NNNN}"), "brace");
    assert.equal(error("RE äöü {NNNN}"), "characters");
    assert.equal(error("<script>{NNNN}"), "characters");
    assert.equal(error(`${"A".repeat(40)}{NNNN}`), "tooLong");
  });

  it("der Zähler beginnt neu nach Zeitplatzhalter", () => {
    const scope = (format: string) => {
      const parsed = parseInvoiceNumberFormat(format);
      return parsed.ok ? parsed.scope : null;
    };
    assert.equal(scope("{NNNN}"), "never");
    assert.equal(scope("{YYYY}-{NNNN}"), "year");
    assert.equal(scope("{YY}{MM}{NNN}"), "month");
    assert.equal(counterKey("never", when), "");
    assert.equal(counterKey("year", when), "2026");
    assert.equal(counterKey("month", when), "2026-03");
    assert.equal(counterKey("month", { year: 2026, month: 12 }), "2026-12");
  });

  it("ungültiges Muster oder Zähler ergibt keine Nummer", () => {
    assert.equal(formatInvoiceNumber("{YYYY}", when, 1), null);
    assert.equal(formatInvoiceNumber("{NNNN}", when, 0), null);
    assert.equal(formatInvoiceNumber("{NNNN}", when, 1.5), null);
    assert.deepEqual(previewInvoiceNumbers("kaputt", when), []);
  });
});
