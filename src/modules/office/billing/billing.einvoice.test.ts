import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { todayInput } from "@/lib/dates";
import { readEInvoice } from "@/lib/einvoice/extract";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { writeEinvoiceSample } from "@/test/einvoice-samples";
import type { AppSession } from "@/server/auth/session";

/**
 * XRechnung aus **echten Belegen** der Rechnungserstellung (Schnappschuss, Nummer aus dem Zähler): Rechnung mit mehreren Steuersätzen und Rabatt, Kleinunternehmer, Abschlag, Schlussrechnung mit
 * Anrechnung, Stornorechnung. Jedes Beispiel wird über `writeEinvoiceSample` nach `EINVOICE_SAMPLES_DIR` geschrieben (Pipeline-Job `xrechnung`: KoSIT-Prüfer) und hier über den Leser der Anwendung
 * wieder gelesen (Rundreise: Nummer, Datum, Parteien, Summen).
 */
let env: TestEnv;
let ops: typeof import("./operations");
let invoiceOps: typeof import("@/modules/office/invoices/operations");
let docs: typeof import("./xrechnung");
let queries: typeof import("./queries");
let sessionMod: typeof import("@/server/auth/session");
let session: AppSession;
let customerId: string;

const PROFILE = { id: "default", name: "Autohaus Müller & Söhne GmbH", street: "Hauptstraße 1", zip: "10115", city: "Berlin", phone: "030 123456", email: "info@mueller.example", taxNumber: "12/345/67890", vatId: "DE123456789", iban: "DE89370400440532013000", bic: "COBADEFFXXX", bankName: "Commerzbank", managingDirector: "Erika Müller", registerCourt: "AG Charlottenburg", registerNumber: "HRB 12345", paymentTermDays: 14, smallBusiness: false, invoiceNumberFormat: "RE-{YYYY}-{NNNN}" };

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.billing", enabled: true, updatedByName: "test" } });
  sessionMod = await import("@/server/auth/session");
  ops = await import("./operations");
  invoiceOps = await import("@/modules/office/invoices/operations");
  docs = await import("./xrechnung");
  queries = await import("./queries");
  const role = await env.role({ permissions: ["billing.view", "billing.edit", "billing.accept", "invoices.view", "invoices.edit", "invoices.finalize", "customers.view"] });
  await env.signIn(await env.user({ username: "xr", roles: [role] }));
  session = (await sessionMod.getSession())!;
  env.signOut();
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.invoiceDeduction.deleteMany();
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } });
  await env.db.invoice.deleteMany();
  await env.db.counter.deleteMany();
  await env.db.workshop.upsert({ where: { id: "default" }, update: PROFILE, create: PROFILE });
  await env.db.customer.deleteMany();
  customerId = (await env.db.customer.create({ data: { lastName: "Mustermann", firstName: "Max", company: "Mustermann Fuhrpark GmbH", street: "Nebenweg 2", zip: "50667", city: "Köln", email: "einkauf@fuhrpark.example", nameKey: "mustermann" } })).id;
});

const items = (list: Array<Record<string, unknown>>) => JSON.stringify(list.map((i) => ({ unit: "Stk", quantityMilli: 1000, discountBp: 0, taxBp: 1900, ...i })));
const fresh = (id: string) => env.db.invoice.findUniqueOrThrow({ where: { id } });

async function document(extra: Record<string, unknown>, lines: Array<Record<string, unknown>>) {
  const created = await ops.saveDraftOperation.execute(session, { docType: "invoice", customerId, serviceFrom: todayInput(), buyerReference: "04011000-1234512345-06", items: items(lines), ...extra });
  assert.ok(created.ok, JSON.stringify(!created.ok && created.failure));
  const done = await ops.finalizeDocumentOperation.execute(session, { id: created.data.id, version: versionOf(await fresh(created.data.id)) });
  assert.ok(done.ok, JSON.stringify(!done.ok && done.failure));
  return created.data.id;
}

async function check(name: string, id: string) {
  const { view } = (await queries.loadDocView(id))!;
  assert.deepEqual(docs.xrechnungProblems(view), [], `${name}: vollständig`);
  const xml = docs.buildDocumentXml(view);
  writeEinvoiceSample(`${name}.xml`, xml);
  const read = readEInvoice(new TextEncoder().encode(xml));
  assert.ok(read.ok, `${name}: lesbar`);
  if (!read.ok) throw new Error("unreachable");
  const p = read.proposal;
  assert.equal(p.number, view.number);
  assert.equal(p.issueDate, view.issueDay);
  assert.equal(p.seller, view.sender.name);
  assert.equal(p.buyer, view.recipient.name);
  assert.deepEqual(p.warnings, []);
  return { view, p, xml };
}

describe("XRechnung aus Belegen der Rechnungserstellung", () => {
  it("Rechnung mit mehreren Steuersätzen, Rabatt und 0 % mit Grund", async () => {
    const id = await document({ taxNote: "Steuerfreie Leistung nach § 4 UStG" }, [
      { description: "Inspektion & Ölwechsel „komplett“", unit: "Std", quantityMilli: 2500, unitCents: 8500, discountBp: 1000 },
      { description: "Fachbuch <Reparatur>", quantityMilli: 2000, unitCents: 1850, taxBp: 700 },
      { description: "Entsorgung (steuerfrei)", unitCents: 1500, taxBp: 0 },
    ]);
    const { view, p } = await check("billing-invoice-mixed", id);
    assert.equal(p.grossCents, view.totals.grossCents);
    assert.equal(p.vatCents, view.totals.taxCents);
    assert.equal(p.netCents, view.totals.netCents);
  });

  it("Kleinunternehmer § 19 UStG", async () => {
    await env.db.workshop.update({ where: { id: "default" }, data: { smallBusiness: true, vatId: null } });
    const id = await document({}, [{ description: "Reifenwechsel", unitCents: 4900 }]);
    const { view, p, xml } = await check("billing-invoice-small-business", id);
    assert.equal(p.vatCents, 0);
    assert.equal(p.grossCents, view.totals.netCents);
    assert.ok(xml.includes("Kleinunternehmer gemäß § 19 UStG"));
  });

  it("Abschlagsrechnung, Schlussrechnung mit Anrechnung und Stornorechnung", async () => {
    const partialId = await document({ docType: "partial" }, [{ description: "Abschlag Motorinstandsetzung", unitCents: 50000 }]);
    const partial = await check("billing-partial", partialId);
    assert.equal(partial.xml.includes("<cbc:InvoiceTypeCode>326</cbc:InvoiceTypeCode>"), true);

    const finalId = await document({ docType: "final", deductPartialIds: [partialId] }, [{ description: "Motorinstandsetzung", unitCents: 180000 }]);
    const final = await check("billing-final", finalId);
    assert.ok(final.xml.includes(`<cbc:PrepaidAmount currencyID="EUR">${(partial.view.totals.grossCents / 100).toFixed(2)}</cbc:PrepaidAmount>`));
    assert.ok(final.xml.includes(`<cbc:ID>${partial.view.number}</cbc:ID>`), "Verweis auf den Abschlag");
    const payable = final.view.totals.grossCents - partial.view.totals.grossCents;
    assert.ok(final.xml.includes(`<cbc:PayableAmount currencyID="EUR">${(payable / 100).toFixed(2)}</cbc:PayableAmount>`));

    const cancelled = await invoiceOps.cancelInvoiceOperation.execute(session, { id: finalId, version: versionOf(await fresh(finalId)), reason: "Fehler" });
    assert.ok(cancelled.ok, JSON.stringify(!cancelled.ok && cancelled.failure));
    const credit = await check("billing-credit-note", cancelled.data.counterId);
    assert.ok(credit.xml.includes("<CreditNote "));
    assert.equal(credit.p.creditNote, true);
    assert.equal(credit.p.grossCents, -final.view.totals.grossCents);
  });
});
