import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { paymentState, invoiceTotals } from "./domain";

/** Summen über die Datenbank (aggregate) – gleiche Ergebnisse wie die Regeln in `paymentState`, unabhängig davon, wie viele Rechnungen eine Seite zeigt. */
let env: TestEnv;
let queries: typeof import("./queries");

before(async () => {
  env = await createTestEnv();
  queries = await import("./queries");
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.db.invoice.deleteMany();
});

const NOW = new Date("2026-06-15T10:00:00");
const day = (iso: string) => new Date(`${iso}T00:00:00`);
let n = 0;
const add = (data: { direction?: string; status?: string; gross: number; due?: string | null; issue?: string }) =>
  env.db.invoice.create({
    data: {
      direction: data.direction ?? "incoming",
      number: `R-${++n}`,
      partyName: "X",
      issueDate: day(data.issue ?? "2026-05-01"),
      dueDate: data.due ? day(data.due) : null,
      grossCents: data.gross,
      status: data.status ?? "open",
    },
  });

describe("invoiceSums", () => {
  it("offen, überfällig, bezahlt – stornierte zählen nicht; fällig heute ist noch nicht überfällig", async () => {
    await add({ gross: 100, due: "2026-07-01" }); // offen
    await add({ gross: 200 }); // offen ohne Fälligkeit
    await add({ gross: 400, due: "2026-06-15" }); // heute fällig = offen
    await add({ gross: 800, due: "2026-06-14" }); // überfällig
    await add({ gross: 1600, status: "paid", due: "2026-01-01" });
    await add({ gross: 3200, status: "cancelled", due: "2026-01-01" });
    const sums = await queries.invoiceSums({}, NOW);
    assert.deepEqual(sums, { openCents: 100 + 200 + 400 + 800, openCount: 4, overdueCents: 800, overdueCount: 1, paidCents: 1600 });
  });

  it("stimmt mit der Rechenregel der Anzeige überein (invoiceTotals über dieselben Zeilen)", async () => {
    await add({ gross: 119, due: "2026-06-01" });
    await add({ gross: 250 });
    await add({ gross: 999, status: "paid" });
    await add({ gross: 5, status: "cancelled" });
    const rows = await env.db.invoice.findMany({ select: { status: true, dueDate: true, grossCents: true } });
    assert.deepEqual(await queries.invoiceSums({}, NOW), invoiceTotals(rows, NOW));
    assert.equal(paymentState({ status: "open", dueDate: day("2026-06-01") }, NOW), "overdue");
  });

  it("filtert nach Richtung und Zeitraum, nicht nach der geladenen Seite", async () => {
    await add({ direction: "outgoing", gross: 10, issue: "2026-02-01" });
    await add({ direction: "outgoing", gross: 20, issue: "2025-12-31" });
    await add({ direction: "incoming", gross: 40, issue: "2026-02-01" });
    const sums = await queries.invoiceSums({ direction: "outgoing", issueDate: { gte: day("2026-01-01"), lt: day("2027-01-01") } }, NOW);
    assert.equal(sums.openCents, 10);
    assert.equal(sums.openCount, 1);
  });

  it("leer: Nullen", async () => {
    assert.deepEqual(await queries.invoiceSums({}, NOW), { openCents: 0, openCount: 0, overdueCents: 0, overdueCount: 0, paidCents: 0 });
  });
});

describe("invoiceYears", () => {
  it("von der ältesten bis zur neuesten Rechnung, das laufende Jahr immer dabei, absteigend", async () => {
    assert.deepEqual(await queries.invoiceYears(2026), [2026]);
    await add({ gross: 1, issue: "2024-03-01" });
    await add({ gross: 1, issue: "2027-01-02" });
    assert.deepEqual(await queries.invoiceYears(2026), [2027, 2026, 2025, 2024]);
  });
});
