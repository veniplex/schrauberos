import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { installFakes } from "@/test/harness";

/** „Wörterbuch pro Berechtigung“: durchsucht wird nur, was der Aufrufer auch sehen darf. */
let searchWhere: typeof import("./search").searchWhere;
before(async () => {
  installFakes();
  ({ searchWhere } = await import("./search"));
});

const fields: Array<import("./search").SearchField<Record<string, string>>> = [
  { where: (t: string) => ({ name: t }) },
  { permission: "vehicles.view", where: (t: string) => ({ plate: t }) },
  { permission: "customers.edit", where: (t: string) => ({ phone: t }) },
];

describe("searchWhere", () => {
  it("leerer Suchbegriff: kein Filter", () => {
    assert.equal(searchWhere("", () => true, fields), null);
  });
  it("mit allen Rechten werden alle Felder durchsucht", () => {
    assert.deepEqual(searchWhere("x", () => true, fields), { OR: [{ name: "x" }, { plate: "x" }, { phone: "x" }] });
  });
  it("Felder ohne das Recht fallen weg – ein Treffer wäre sonst eine Auskunft über verborgene Daten", () => {
    assert.deepEqual(searchWhere("x", (p) => p === "vehicles.view", fields), { OR: [{ name: "x" }, { plate: "x" }] });
    assert.deepEqual(searchWhere("x", () => false, fields), { OR: [{ name: "x" }] });
  });
  it("ohne erlaubtes Feld ist die Bedingung unerfüllbar (nicht „alles“)", () => {
    assert.deepEqual(searchWhere("x", () => false, [fields[1]]), { OR: [] });
  });
});
