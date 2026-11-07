import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anonymizeBlock, disclosureRows, field, retentionEnd, retentionEndKey, type PrivacySection } from "./privacy";

const rules = { invoiceYears: 8, booksYears: 10 };
const confirmed = { confirmed: true, anonymizedAt: null, rules };

describe("Aufbewahrungsfrist", () => {
  it("beginnt mit dem Ablauf des Kalenderjahres der Rechnung: 8 Jahre ab 14.03.2026 enden am 31.12.2034", () => {
    assert.equal(retentionEndKey(new Date("2026-03-14T12:00:00Z"), 8, "Europe/Berlin"), "2034-12-31");
    assert.equal(retentionEndKey(new Date("2026-01-01T12:00:00Z"), 8, "Europe/Berlin"), "2034-12-31", "auch der erste Tag des Jahres");
    assert.equal(retentionEndKey(new Date("2026-12-31T12:00:00Z"), 10, "Europe/Berlin"), "2036-12-31", "auch der letzte Tag");
  });

  it("das Jahr zählt in der Zeitzone der Werkstatt (Jahreswechsel)", () => {
    const newYearsEve = new Date("2026-12-31T23:30:00Z"); // Berlin: 01.01.2027, Los Angeles: 31.12.2026
    assert.equal(retentionEndKey(newYearsEve, 8, "Europe/Berlin"), "2035-12-31");
    assert.equal(retentionEndKey(newYearsEve, 8, "America/Los_Angeles"), "2034-12-31");
    assert.equal(retentionEndKey(newYearsEve, 8, "UTC"), "2034-12-31");
  });

  it("das späteste Ende gewinnt; festgeschriebene Rechnungen nutzen die längere Frist", () => {
    const items = [
      { date: new Date("2020-06-01T12:00:00Z"), kind: "invoice" as const },
      { date: new Date("2018-06-01T12:00:00Z"), kind: "finalizedInvoice" as const },
      { date: new Date("2021-06-01T12:00:00Z"), kind: "invoice" as const },
    ];
    assert.equal(retentionEnd(items, rules, "UTC"), "2029-12-31", "2021 + 8");
    assert.equal(retentionEnd(items.slice(0, 2), rules, "UTC"), "2028-12-31", "2018 + 10 gegen 2020 + 8");
    assert.equal(retentionEnd([], rules, "UTC"), null);
  });
});

describe("Anonymisierung: Sperre", () => {
  const items = [{ date: new Date("2026-03-14T12:00:00Z"), kind: "invoice" as const }];

  it("ohne Bestätigung der Fristen gesperrt – auch ohne jede Rechnung", () => {
    assert.deepEqual(anonymizeBlock({ ...confirmed, confirmed: false, items: [], now: new Date("2040-01-01T12:00:00Z"), timeZone: "UTC" }), { reason: "unconfirmed" });
  });

  it("vor Ablauf gesperrt, am Fristende noch gesperrt, am Tag danach frei", () => {
    const at = (iso: string) => anonymizeBlock({ ...confirmed, items, now: new Date(iso), timeZone: "UTC" });
    assert.deepEqual(at("2027-05-01T12:00:00Z"), { reason: "running", until: "2034-12-31" });
    assert.deepEqual(at("2034-12-31T23:59:00Z"), { reason: "running", until: "2034-12-31" });
    assert.equal(at("2035-01-01T00:00:00Z"), null);
    assert.equal(at("2050-01-01T12:00:00Z"), null);
  });

  it("die Zeitzone entscheidet am Jahreswechsel über „heute“", () => {
    const lastNight = new Date("2034-12-31T23:30:00Z"); // Berlin schon 2035
    assert.equal(anonymizeBlock({ ...confirmed, items, now: lastNight, timeZone: "Europe/Berlin" }), null);
    assert.deepEqual(anonymizeBlock({ ...confirmed, items, now: lastNight, timeZone: "UTC" }), { reason: "running", until: "2034-12-31" });
  });

  it("ohne Rechnungen und bestätigt sofort frei; schon anonymisiert gesperrt", () => {
    assert.equal(anonymizeBlock({ ...confirmed, items: [], now: new Date("2026-01-01T12:00:00Z"), timeZone: "UTC" }), null);
    assert.deepEqual(anonymizeBlock({ ...confirmed, anonymizedAt: new Date(), items: [], timeZone: "UTC" }), { reason: "already" });
  });

  it("längere Frist bei Änderung der Einstellung", () => {
    const longer = { ...confirmed, items, rules: { invoiceYears: 10, booksYears: 10 }, now: new Date("2035-06-01T12:00:00Z"), timeZone: "UTC" };
    assert.deepEqual(anonymizeBlock(longer), { reason: "running", until: "2036-12-31" });
  });
});

describe("Auskunft als Tabelle", () => {
  it("je Wert eine Zeile; leere Werte bleiben leer; Freitexte mit Sonderzeichen bleiben Text", () => {
    const sections: PrivacySection[] = [
      { id: "a", title: "customers.title", records: [[field("lastName", "customers.fields.lastName", "Muster"), field("notes", "common.notes", "=HYPERLINK(\"x\")\nzweite Zeile")], [field("lastName", "customers.fields.lastName", null)]] },
    ];
    const rows = disclosureRows(sections, (key) => `[${key}]`);
    assert.deepEqual(rows, [
      ["[customers.title]", "1", "[customers.fields.lastName]", "Muster"],
      ["[customers.title]", "1", "[common.notes]", '=HYPERLINK("x")\nzweite Zeile'],
      ["[customers.title]", "2", "[customers.fields.lastName]", ""],
    ]);
  });
});
