import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { amountsConsistent, invoiceFileLocation, invoiceTotals, paymentState } from "./domain";

const now = new Date("2026-11-05T12:00:00");
const d = (s: string) => new Date(`${s}T12:00:00`);

describe("paymentState", () => {
  test("bezahlt und storniert gewinnen immer", () => {
    assert.equal(paymentState({ status: "paid", dueDate: d("2026-01-01") }, now), "paid");
    assert.equal(paymentState({ status: "cancelled", dueDate: d("2026-01-01") }, now), "cancelled");
  });
  test("offen: überfällig erst ab dem Tag nach der Fälligkeit", () => {
    assert.equal(paymentState({ status: "open", dueDate: d("2026-11-05") }, now), "open");
    assert.equal(paymentState({ status: "open", dueDate: d("2026-11-04") }, now), "overdue");
    assert.equal(paymentState({ status: "open", dueDate: null }, now), "open");
  });
});

describe("invoiceTotals", () => {
  test("Summen: offen enthält überfällig, bezahlt separat, storniert zählt nicht", () => {
    const t = invoiceTotals(
      [
        { status: "open", dueDate: d("2026-12-01"), grossCents: 10000 },
        { status: "open", dueDate: d("2026-10-01"), grossCents: 5000 },
        { status: "paid", dueDate: d("2026-09-01"), grossCents: 7000 },
        { status: "cancelled", dueDate: null, grossCents: 99999 },
      ],
      now,
    );
    assert.deepEqual(t, { openCents: 15000, overdueCents: 5000, paidCents: 7000, openCount: 2, overdueCount: 1 });
  });
});

describe("amountsConsistent", () => {
  test("Netto + MwSt = Brutto (1 Cent Toleranz)", () => {
    assert.equal(amountsConsistent(10000, 1900, 11900), true);
    assert.equal(amountsConsistent(10000, 1900, 11901), true);
    assert.equal(amountsConsistent(10000, 1900, 12000), false);
    assert.equal(amountsConsistent(null, 1900, 12000), true);
  });
});

describe("Beleg-Ablage", () => {
  const inv = { direction: "incoming", issueDate: new Date("2026-03-14T12:00:00Z"), number: "RE 2026/0042", partyName: "Müller & Söhne GmbH" };

  test("legt Belege lesbar nach Jahr und Richtung ab", () => {
    assert.deepEqual(invoiceFileLocation(inv, "application/pdf"), { dir: "rechnungen/2026/eingang", name: "2026-03-14_Mueller-Soehne-GmbH_RE-2026-0042.pdf" });
    assert.equal(invoiceFileLocation({ ...inv, direction: "outgoing" }, "image/jpeg").dir, "rechnungen/2026/ausgang");
    assert.equal(invoiceFileLocation(inv, "image/jpeg").name.endsWith(".jpg"), true);
  });

  test("macht aus Nummer und Partner nie einen Pfad", () => {
    const loc = invoiceFileLocation({ ...inv, number: "../../etc/passwd", partyName: "a/b\c" }, "application/pdf");
    assert.ok(!loc.name.includes("/") && !loc.name.includes("\\") && !loc.name.includes(".."));
  });
});
