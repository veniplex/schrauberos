import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { currentYear, todayInput } from "@/lib/dates";
import { addDaysToKey } from "@/lib/zone";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { startFakeSmtp, type FakeSmtp } from "@/test/fake-smtp";
import { inspectPdf } from "@/test/pdf-text";
import type { AppSession } from "@/server/auth/session";

/**
 * Rechnungserstellung (F3) gegen eine echte temporäre SQLite: Entwurf → Festschreiben (Nummer aus dem Zähler, Schnappschuss, Prüfliste), Steuer (19/7/0, Rabatt, Kleinunternehmer), Abschlag und
 * Schlussrechnung, Storno, Zahlungen, Angebot (annehmen, Auftragsbestätigung, Auftrag atomar), Rechnung aus Auftrag, Versand per E-Mail, PDF und XRechnung.
 */
let env: TestEnv;
type Ops = typeof import("./operations");
let ops: Ops;
let invoiceOps: typeof import("@/modules/office/invoices/operations");
let docs: typeof import("./documents");
let xr: typeof import("./xrechnung");
let queries: typeof import("./queries");
let invoiceQueries: typeof import("@/modules/office/invoices/queries");
let sessionMod: typeof import("@/server/auth/session");

const YEAR = currentYear();
const EDIT = ["billing.view", "billing.edit", "billing.accept", "invoices.view", "invoices.edit", "customers.view", "vehicles.view"];
const FINALIZE = [...EDIT, "invoices.finalize"];
let customerId: string;

async function sessionFor(permissions: readonly string[], options: { admin?: boolean } = {}): Promise<AppSession> {
  const role = await env.role({ isAdmin: options.admin, permissions });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2)}`, roles: [role] });
  await env.signIn(user);
  const session = (await sessionMod.getSession())!;
  env.signOut();
  return session;
}

const PROFILE = { id: "default", name: "Autohaus Müller", street: "Hauptstraße 1", zip: "10115", city: "Berlin", phone: "030 123456", email: "info@mueller.example", taxNumber: "12/345/67890", vatId: "DE123456789", iban: "DE89370400440532013000", bic: "COBADEFFXXX", bankName: "Commerzbank", managingDirector: "Erika Müller", paymentTermDays: 14, smallBusiness: false, invoiceNumberFormat: "{YYYY}-{NNNN}" };

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.billing", enabled: true, updatedByName: "test" } });
  sessionMod = await import("@/server/auth/session");
  ops = await import("./operations");
  invoiceOps = await import("@/modules/office/invoices/operations");
  docs = await import("./documents");
  xr = await import("./xrechnung");
  queries = await import("./queries");
  invoiceQueries = await import("@/modules/office/invoices/queries");
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.db.mailMessage.deleteMany();
  await env.db.outboxEvent.deleteMany();
  await env.db.invoiceDeduction.deleteMany();
  await env.db.invoiceSentFile.deleteMany();
  await env.db.invoicePayment.deleteMany();
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } });
  await env.db.invoice.deleteMany({ where: { sourceDocId: { not: null } } });
  await env.db.invoice.deleteMany();
  await env.db.orderItem.deleteMany();
  await env.db.orderEvent.deleteMany();
  await env.db.order.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.counter.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.workshop.upsert({ where: { id: "default" }, update: PROFILE, create: PROFILE });
  await env.db.customer.deleteMany();
  customerId = (await env.db.customer.create({ data: { lastName: "Mustermann", firstName: "Max", street: "Nebenweg 2", zip: "50667", city: "Köln", email: "max@kunde.example", customerNumber: "K-1", nameKey: "mustermann max" } })).id;
});

const items = (list: Array<Partial<{ description: string; quantityMilli: number; unitCents: number; taxBp: number; discountBp: number; unit: string; kind: string }>> = [{}]) =>
  JSON.stringify(list.map((i) => ({ description: "Ölwechsel", unit: "Stk", quantityMilli: 1000, unitCents: 10000, taxBp: 1900, discountBp: 0, ...i })));

async function draft(session: AppSession, extra: Record<string, unknown> = {}) {
  const result = await ops.saveDraftOperation.execute(session, { docType: "invoice", customerId, items: items(), serviceFrom: todayInput(), ...extra });
  assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
  return result.data.id;
}
const fresh = (id: string) => env.db.invoice.findUniqueOrThrow({ where: { id } });
const finalize = async (session: AppSession, id: string) => ops.finalizeDocumentOperation.execute(session, { id, version: versionOf(await fresh(id)) });
async function finalized(session: AppSession, extra: Record<string, unknown> = {}) {
  const id = await draft(session, extra);
  const result = await finalize(session, id);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
  return id;
}
const failureOf = <T>(outcome: { ok: boolean } & ({ ok: true; data: T } | { ok: false; failure: { code: string; key?: string; fields?: Record<string, { key: string }>; data?: Record<string, string> } })) => {
  assert.equal(outcome.ok, false, "Fehler erwartet");
  return (outcome as { failure: { code: string; key?: string; fields?: Record<string, { key: string }>; data?: Record<string, string> } }).failure;
};

describe("Entwurf", () => {
  it("hat keine Nummer, rechnet 19/7/0 % und Rabatt mit der gemeinsamen Regel und steht nicht in der Ausgangsliste", async () => {
    const session = await sessionFor(EDIT);
    const id = await draft(session, {
      items: items([
        { description: "Arbeit", quantityMilli: 1500, unitCents: 7500, taxBp: 1900, discountBp: 1000 },
        { description: "Buch", quantityMilli: 2000, unitCents: 1850, taxBp: 700 },
        { description: "Befreit", quantityMilli: 1000, unitCents: 1000, taxBp: 0 },
      ]),
    });
    const row = await fresh(id);
    assert.equal(row.number, "");
    assert.equal(row.outgoingKey, null);
    assert.equal(row.source, "billing");
    assert.equal(row.finalizedAt, null);
    // Arbeit 1,5 × 75,00 = 112,50 − 10 % = 101,25; Buch 37,00; Befreit 10,00 → netto 148,25; Steuer 19,24 + 2,59 = 21,83 (je Satz auf der Summe gerundet)
    assert.equal(row.netCents, 14825);
    assert.equal(row.vatCents, 1924 + 259);
    assert.equal(row.grossCents, 14825 + 1924 + 259);
    assert.equal(await env.db.invoiceItem.count({ where: { invoiceId: id } }), 3);
    const ledger = await env.db.invoice.count({ where: invoiceQueries.ledgerWhere });
    assert.equal(ledger, 0, "Entwürfe stehen nicht in der Ausgangsliste");
    const sums = await invoiceQueries.invoiceSums({ direction: "outgoing" });
    assert.equal(sums.openCents, 0);
  });

  it("lehnt unzulässige Steuersätze und zu große Summen serverseitig ab (vor dem Speichern)", async () => {
    const session = await sessionFor(EDIT);
    const bad = failureOf(await ops.saveDraftOperation.execute(session, { docType: "invoice", customerId, items: items([{ taxBp: 1500 }]) }));
    assert.equal(bad.fields?.["items.0.taxBp"]?.key, "billing.errors.taxRate");
    const huge = await ops.saveDraftOperation.execute(session, { docType: "invoice", customerId, items: items([{ unitCents: 1_900_000_000, quantityMilli: 1000 }]) });
    assert.equal(huge.ok, false);
    assert.equal(await env.db.invoice.count(), 0, "nichts gespeichert");
  });

  it("braucht das Recht billing.edit; ändern nur mit der aktuellen Version; Löschen nur für Entwürfe", async () => {
    const viewer = await sessionFor(["billing.view"]);
    assert.equal(failureOf(await ops.saveDraftOperation.execute(viewer, { docType: "invoice", customerId, items: items() })).code, "forbidden");
    const session = await sessionFor(EDIT);
    const id = await draft(session);
    const stale = await ops.saveDraftOperation.execute(session, { id, version: "1", customerId, items: items() });
    assert.equal(failureOf(stale).code, "conflict");
    const ok = await ops.saveDraftOperation.execute(session, { id, version: versionOf(await fresh(id)), customerId, items: items([{ description: "Neu" }]) });
    assert.ok(ok.ok);
    assert.equal((await env.db.invoiceItem.findMany({ where: { invoiceId: id } })).map((i) => i.description).join(), "Neu");
    assert.ok((await ops.deleteDraftOperation.execute(session, { id })).ok);
    assert.equal(await env.db.invoice.count(), 0);
  });

  it("Kunde mit eingeschränkter Verarbeitung (Art. 18) lässt sich nicht verknüpfen", async () => {
    const session = await sessionFor(EDIT);
    await env.db.customer.update({ where: { id: customerId }, data: { processingRestrictedAt: new Date() } });
    const failure = failureOf(await ops.saveDraftOperation.execute(session, { docType: "invoice", customerId, items: items() }));
    assert.ok(failure.fields?.customerId);
  });

  it("übernimmt Name und Anschrift des Kunden, solange die Felder leer sind", async () => {
    const session = await sessionFor(EDIT);
    const row = await fresh(await draft(session));
    assert.deepEqual([row.partyName, row.partyStreet, row.partyZip, row.partyCity, row.buyerEmail], ["Max Mustermann", "Nebenweg 2", "50667", "Köln", "max@kunde.example"]);
  });
});

describe("Festschreiben", () => {
  it("vergibt die Nummer erst jetzt, hält den Schnappschuss fest und stellt die Rechnung in die Ausgangsliste", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await draft(session);
    const result = await finalize(session, id);
    assert.ok(result.ok);
    const row = await fresh(id);
    assert.equal(row.number, `${YEAR}-0001`);
    assert.equal(row.outgoingKey, `${YEAR}-0001`);
    assert.equal(row.issueDate.getTime(), (await fresh(id)).issueDate.getTime());
    assert.ok(row.finalizedAt);
    assert.equal(row.dueDate?.toISOString().slice(0, 10), addDaysToKey(todayInput(), 14));
    const snapshot = await env.db.invoiceSnapshot.findUniqueOrThrow({ where: { invoiceId: id } });
    assert.deepEqual([snapshot.sName, snapshot.sIban, snapshot.rName, snapshot.rStreet, snapshot.rCustomerNumber], ["Autohaus Müller", "DE89370400440532013000", "Max Mustermann", "Nebenweg 2", "K-1"]);
    assert.equal(await env.db.invoice.count({ where: invoiceQueries.ledgerWhere }), 1);
    const sums = await invoiceQueries.invoiceSums({ direction: "outgoing" });
    assert.equal(sums.openCents, 11900);
    const events = await env.db.outboxEvent.findMany({ where: { type: "billing.finalized" } });
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events[0]).includes("Mustermann"), "das Ereignis trägt nur Typ und Kennung");
  });

  it("das Audit-Log nennt Belegart und Nummer, nie den Namen des Empfängers (es überlebt die Anonymisierung); jede Operation schreibt ihren Eintrag", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    assert.ok((await ops.addPaymentOperation.execute(session, { id, amount: "10,00" })).ok);
    const offer = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items() });
    assert.ok(offer.ok);
    assert.ok((await ops.deleteDraftOperation.execute(session, { id: offer.data.id })).ok);
    const entries = await env.db.auditLog.findMany({ where: { action: { startsWith: "billing." } } });
    assert.deepEqual(
      entries.map((e) => e.action).sort(),
      ["billing.create", "billing.create", "billing.delete", "billing.finalize", "billing.payment"],
    );
    for (const entry of entries) assert.ok(!/Mustermann|Max/.test(entry.target ?? ""), `${entry.action}: ${entry.target}`);
    assert.ok(entries.some((e) => e.target === `Rechnung ${YEAR}-0001`));
  });

  it("braucht das Recht invoices.finalize und die aktuelle Version", async () => {
    const editor = await sessionFor(EDIT);
    const id = await draft(editor);
    assert.equal(failureOf(await finalize(editor, id)).code, "forbidden");
    const chef = await sessionFor(FINALIZE);
    assert.equal(failureOf(await ops.finalizeDocumentOperation.execute(chef, { id, version: "1" })).code, "conflict");
    assert.equal((await fresh(id)).number, "");
  });

  it("nennt fehlende Pflichtangaben als ruhige Liste und vergibt dann keine Nummer", async () => {
    const session = await sessionFor(FINALIZE);
    await env.db.workshop.update({ where: { id: "default" }, data: { taxNumber: null, vatId: null, street: null, iban: null } });
    const id = await draft(session, { serviceFrom: undefined, customerId: undefined, partyName: "Ohne Anschrift" });
    const failure = failureOf(await finalize(session, id));
    assert.equal(failure.key, "billing.errors.incomplete");
    const problems = (failure.data?.problems ?? "").split(",");
    for (const code of ["senderAddress", "senderTaxId", "recipientAddress", "serviceDate", "iban"]) assert.ok(problems.includes(code), code);
    assert.equal((await env.db.counter.findMany()).length, 0, "kein Zähler verbraucht");
    assert.equal((await fresh(id)).number, "");
  });

  it("lässt den Beleg danach nicht mehr ändern oder löschen – auch nicht über das Archiv", async () => {
    const session = await sessionFor([...FINALIZE, "invoices.delete"]);
    const id = await finalized(session);
    assert.equal(failureOf(await ops.saveDraftOperation.execute(session, { id, version: versionOf(await fresh(id)), customerId, items: items() })).key, "billing.errors.notDraft");
    assert.equal(failureOf(await ops.deleteDraftOperation.execute(session, { id })).key, "billing.errors.notDraft");
    assert.equal(failureOf(await invoiceOps.deleteInvoiceOperation.execute(session, { id })).code, "inUse");
    const manual = await invoiceOps.saveInvoiceOperation.execute(session, { id, version: versionOf(await fresh(id)), direction: "outgoing", number: "X-1", partyName: "x", issueDate: todayInput(), gross: "1,00", status: "open", removeFile: false });
    assert.equal(failureOf(manual).code, "inUse");
    assert.equal(failureOf(await invoiceOps.finalizeInvoiceOperation.execute(session, { id, version: versionOf(await fresh(id)) })).code, "inUse");
  });

  it("der Schnappschuss ändert sich nie rückwirkend: Profil und Kunde werden später anders, Beleg und PDF bleiben", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    await env.db.workshop.update({ where: { id: "default" }, data: { name: "Neue Firma GmbH", iban: "DE02120300000000202051" } });
    await env.db.customer.update({ where: { id: customerId }, data: { street: "Geändert 9", city: "Berlin" } });
    const loaded = await queries.loadDocView(id);
    assert.ok(loaded);
    assert.equal(loaded.view.sender.name, "Autohaus Müller");
    assert.equal(loaded.view.sender.iban, "DE89370400440532013000");
    assert.equal(loaded.view.recipient.street, "Nebenweg 2");
    const pdf = await docs.buildDocumentPdf(loaded.view);
    const text = inspectPdf(pdf).pages.join("\n");
    assert.match(text, /Autohaus Müller/);
    assert.doesNotMatch(text, /Neue Firma/);
    assert.match(text, /Nebenweg 2/);
  });
});

describe("Nummernvergabe", () => {
  it("ist lückenlos, auch bei gleichzeitigem Festschreiben", async () => {
    const session = await sessionFor(FINALIZE);
    const ids = await Promise.all([draft(session), draft(session), draft(session), draft(session)]);
    const results = await Promise.all(ids.map((id) => finalize(session, id)));
    assert.ok(results.every((r) => r.ok));
    const numbers = (await env.db.invoice.findMany({ where: { id: { in: ids } }, select: { number: true } })).map((r) => r.number).sort();
    assert.deepEqual(numbers, [1, 2, 3, 4].map((n) => `${YEAR}-${String(n).padStart(4, "0")}`));
  });

  it("scheitert das Festschreiben nach der Nummernvergabe, rollt der Zähler mit zurück (keine verlorene Nummer)", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await draft(session);
    // Der Schnappschuss ist das Letzte, was geschrieben wird: eine vorhandene Zeile lässt das Anlegen scheitern
    await env.db.invoiceSnapshot.create({ data: { invoiceId: id, sName: "x", rName: "y" } });
    const outcome = await finalize(session, id);
    assert.equal(outcome.ok, false);
    assert.equal(await env.db.counter.count(), 0, "Zähler zurückgerollt");
    assert.equal((await fresh(id)).number, "");
    await env.db.invoiceSnapshot.delete({ where: { invoiceId: id } });
    assert.ok((await finalize(session, id)).ok);
    assert.equal((await fresh(id)).number, `${YEAR}-0001`, "die erste Nummer ist noch frei");
  });

  it("eine von Hand erfasste Fremdnummer blockiert den Nummernkreis nicht, bleibt aber eindeutig", async () => {
    const session = await sessionFor(FINALIZE);
    await env.db.invoice.create({ data: { direction: "outgoing", number: `${YEAR}-0001`, outgoingKey: `${YEAR}-0001`, partyName: "Alt", partyKey: "alt", issueDate: new Date(), grossCents: 100 } });
    const id = await finalized(session);
    assert.equal((await fresh(id)).number, `${YEAR}-0002`);
    const next = await finalized(session);
    assert.equal((await fresh(next)).number, `${YEAR}-0003`);
  });

  it("richtet sich nach dem Muster des Werkstattprofils (Präfix, Stellen); Angebote haben eine eigene Reihe", async () => {
    const session = await sessionFor(FINALIZE);
    await env.db.workshop.update({ where: { id: "default" }, data: { invoiceNumberFormat: "RE-{YY}{MM}-{NNN}" } });
    const id = await finalized(session);
    const now = new Date();
    assert.match((await fresh(id)).number, /^RE-\d{4}-001$/);
    void now;
    const offer = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items() });
    assert.ok(offer.ok);
    assert.ok((await ops.issueDocumentOperation.execute(session, { id: offer.data.id, version: versionOf(await fresh(offer.data.id)) })).ok);
    assert.equal((await fresh(offer.data.id)).number, `AN-${YEAR}-0001`);
  });
});

describe("Kleinunternehmer § 19 UStG", () => {
  it("keine Steuer: Brutto gleich Netto, Hinweis im PDF, Schnappschuss merkt es sich", async () => {
    const session = await sessionFor(FINALIZE);
    await env.db.workshop.update({ where: { id: "default" }, data: { smallBusiness: true, vatId: null } });
    const id = await finalized(session, { items: items([{ taxBp: 1900 }]) });
    const row = await fresh(id);
    assert.deepEqual([row.netCents, row.vatCents, row.grossCents, row.exempt], [10000, 0, 10000, true]);
    assert.equal((await env.db.invoiceItem.findFirstOrThrow({ where: { invoiceId: id } })).taxBp, 0);
    const loaded = (await queries.loadDocView(id))!;
    assert.equal(loaded.view.exempt, true);
    const text = inspectPdf(await docs.buildDocumentPdf(loaded.view)).pages.join("\n");
    assert.match(text, /Kleinunternehmer gemäß § 19 UStG/);
    assert.doesNotMatch(text, /MwSt\./);
  });

  it("ändert sich die Einstellung nach dem Anlegen, muss der Entwurf neu gespeichert werden", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await draft(session);
    await env.db.workshop.update({ where: { id: "default" }, data: { smallBusiness: true } });
    assert.equal(failureOf(await finalize(session, id)).key, "billing.errors.exemptChanged");
  });
});

describe("Abschlag, Schlussrechnung und Storno", () => {
  async function partial(session: AppSession, unitCents = 5000) {
    const result = await ops.saveDraftOperation.execute(session, { docType: "partial", customerId, items: items([{ description: "Abschlag", unitCents }]), serviceFrom: todayInput() });
    assert.ok(result.ok);
    assert.ok((await finalize(session, result.data.id)).ok);
    return result.data.id;
  }

  it("die Schlussrechnung rechnet die Abschläge ab; ein Abschlag zählt nur einmal; Storno der Schlussrechnung gibt ihn frei", async () => {
    const session = await sessionFor(FINALIZE);
    const a = await partial(session, 5000); // brutto 59,50
    const finalId = await finalized(session, { docType: "final", deductPartialIds: [a], items: items([{ unitCents: 20000 }]) });
    const row = await fresh(finalId);
    assert.equal(row.grossCents, 23800);
    assert.equal(row.deductedCents, 5950);
    const sums = await invoiceQueries.invoiceSums({ direction: "outgoing" });
    assert.equal(sums.openCents, 5950 + 23800 - 5950, "Abschlag offen + Schlussrechnung nach Abzug");
    // zweite Schlussrechnung kann denselben Abschlag nicht anrechnen
    const second = await ops.saveDraftOperation.execute(session, { docType: "final", customerId, deductPartialIds: [a], items: items(), serviceFrom: todayInput() });
    assert.equal(failureOf(second).fields?.deductPartialIds?.key, "billing.errors.deduction");
    // der Abschlag lässt sich nicht stornieren, solange die Schlussrechnung ihn anrechnet
    const blocked = await invoiceOps.cancelInvoiceOperation.execute(session, { id: a, version: versionOf(await fresh(a)) });
    assert.equal(failureOf(blocked).key, "invoices.errors.cancelDeducted");
    // Storno der Schlussrechnung: Abschlag wird frei
    const cancelled = await invoiceOps.cancelInvoiceOperation.execute(session, { id: finalId, version: versionOf(await fresh(finalId)) });
    assert.ok(cancelled.ok);
    const retry = await ops.saveDraftOperation.execute(session, { docType: "final", customerId, deductPartialIds: [a], items: items(), serviceFrom: todayInput() });
    assert.ok(retry.ok);
  });

  it("die Abschläge dürfen die Summe nicht übersteigen und gehören demselben Kunden", async () => {
    const session = await sessionFor(FINALIZE);
    const a = await partial(session, 50000);
    const tooHigh = await ops.saveDraftOperation.execute(session, { docType: "final", customerId, deductPartialIds: [a], items: items([{ unitCents: 1000 }]), serviceFrom: todayInput() });
    assert.equal(failureOf(tooHigh).fields?.deductPartialIds?.key, "billing.errors.deductionTooHigh");
    const other = (await env.db.customer.create({ data: { lastName: "Anders", nameKey: "anders" } })).id;
    const foreign = await ops.saveDraftOperation.execute(session, { docType: "final", customerId: other, deductPartialIds: [a], items: items(), serviceFrom: todayInput() });
    assert.equal(failureOf(foreign).fields?.deductPartialIds?.key, "billing.errors.deduction");
  });

  it("Storno legt einen festgeschriebenen Gegenbeleg mit negativen Summen und eigener fortlaufender Nummer an – dieselbe Stornologik wie im Archiv", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session, { items: items([{ quantityMilli: 2000, unitCents: 5000, discountBp: 500 }]) });
    const original = await fresh(id);
    const result = await invoiceOps.cancelInvoiceOperation.execute(session, { id, version: versionOf(original), number: "IGNORIERT-1", reason: "Fehler" });
    assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
    const counter = await env.db.invoice.findUniqueOrThrow({ where: { id: result.data.counterId }, include: { items: true, snapshot: true } });
    assert.equal(counter.number, `${YEAR}-0002`, "die Nummer vergibt der Nummernkreis, eine eingegebene wird ignoriert");
    assert.equal(counter.docType, "credit");
    assert.equal(counter.grossCents, -original.grossCents);
    assert.equal(counter.netCents, -(original.netCents ?? 0));
    assert.equal(counter.items[0].quantityMilli, -2000);
    assert.equal(counter.snapshot?.sName, "Autohaus Müller");
    assert.ok(counter.finalizedAt);
    assert.equal((await fresh(id)).status, "cancelled");
    // Original und Gegenbeleg zählen nicht mehr in den offenen Summen
    assert.equal((await invoiceQueries.invoiceSums({ direction: "outgoing" })).openCents, 0);
    // die Summen der Positionen ergeben das negative Brutto (Ansichtsmodell)
    const view = (await queries.loadDocView(counter.id))!.view;
    assert.equal(view.totals.grossCents, -original.grossCents);
    assert.equal(view.cancels?.number, original.number);
    // einmal stornieren, Gegenbeleg nicht noch einmal
    assert.equal(failureOf(await invoiceOps.cancelInvoiceOperation.execute(session, { id, version: versionOf(await fresh(id)) })).code, "inUse");
    assert.equal(failureOf(await invoiceOps.cancelInvoiceOperation.execute(session, { id: counter.id, version: versionOf(await fresh(counter.id)) })).code, "inUse");
  });
});

describe("Zahlungen", () => {
  it("Teilzahlungen, Restbetrag und Zahlstatus ergeben sich automatisch; Überzahlung und falsches Datum werden abgelehnt", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session); // 119,00
    const part = await ops.addPaymentOperation.execute(session, { id, amount: "50,00", method: "cash" });
    assert.ok(part.ok);
    let row = await fresh(id);
    assert.deepEqual([row.paidCents, row.status], [5000, "open"]);
    assert.equal((await invoiceQueries.invoiceSums({ direction: "outgoing" })).openCents, 6900);
    assert.equal(failureOf(await ops.addPaymentOperation.execute(session, { id, amount: "70,00" })).fields?.amount?.key, "billing.errors.overpaid");
    assert.equal(failureOf(await ops.addPaymentOperation.execute(session, { id, amount: "1,00", paidAt: addDaysToKey(todayInput(), 3) })).fields?.paidAt?.key, "billing.errors.paymentDate");
    const rest = await ops.addPaymentOperation.execute(session, { id, amount: "69,00" });
    assert.ok(rest.ok);
    row = await fresh(id);
    assert.deepEqual([row.paidCents, row.status], [11900, "paid"]);
    assert.ok(row.paidAt);
    assert.equal((await env.db.outboxEvent.count({ where: { type: "billing.paid" } })), 1);
    // Korrektur: Zahlung entfernen
    const payments = await env.db.invoicePayment.findMany({ orderBy: { createdAt: "asc" } });
    assert.ok((await ops.removePaymentOperation.execute(session, { id: payments[1].id })).ok);
    row = await fresh(id);
    assert.deepEqual([row.paidCents, row.status, row.paidAt], [5000, "open", null]);
  });

  it("nur zu festgeschriebenen Rechnungen; nicht zu Entwürfen, Gegenbelegen, Stornierten und Angeboten; braucht invoices.edit", async () => {
    const session = await sessionFor(FINALIZE);
    const d = await draft(session);
    assert.equal(failureOf(await ops.addPaymentOperation.execute(session, { id: d, amount: "1,00" })).key, "billing.errors.notPayable");
    const id = await finalized(session);
    const viewer = await sessionFor(["billing.view"]);
    assert.equal(failureOf(await ops.addPaymentOperation.execute(viewer, { id, amount: "1,00" })).code, "forbidden");
    const cancelled = await invoiceOps.cancelInvoiceOperation.execute(session, { id, version: versionOf(await fresh(id)) });
    assert.ok(cancelled.ok);
    assert.equal(failureOf(await ops.addPaymentOperation.execute(session, { id, amount: "1,00" })).key, "billing.errors.notPayable");
    assert.equal(failureOf(await ops.addPaymentOperation.execute(session, { id: cancelled.data.counterId, amount: "1,00" })).key, "billing.errors.notPayable");
  });
});

describe("Angebot", () => {
  async function issuedOffer(session: AppSession, extra: Record<string, unknown> = {}) {
    const created = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items([{ description: "Inspektion", unitCents: 25000 }]), ...extra });
    assert.ok(created.ok);
    const result = await ops.issueDocumentOperation.execute(session, { id: created.data.id, version: versionOf(await fresh(created.data.id)) });
    assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
    return created.data.id;
  }

  it("wird ohne Festschreiben-Recht ausgestellt, bekommt eine eigene Nummer, zählt in keiner Summe und lässt sich annehmen oder ablehnen", async () => {
    const session = await sessionFor(EDIT);
    const id = await issuedOffer(session);
    const row = await fresh(id);
    assert.equal(row.number, `AN-${YEAR}-0001`);
    assert.equal(row.offerStatus, "open");
    assert.equal(row.dueDate, null);
    assert.equal(await env.db.invoice.count({ where: invoiceQueries.ledgerWhere }), 0);
    assert.equal((await invoiceQueries.invoiceSums({})).openCents, 0);
    assert.ok((await ops.acceptOfferOperation.execute(session, { id, version: versionOf(row) })).ok);
    assert.equal((await fresh(id)).offerStatus, "accepted");
    assert.equal(failureOf(await ops.rejectOfferOperation.execute(session, { id, version: versionOf(await fresh(id)) })).key, "billing.errors.offerDecided");
  });

  it("Annehmen braucht billing.accept", async () => {
    const session = await sessionFor(EDIT);
    const id = await issuedOffer(session);
    const limited = await sessionFor(["billing.view", "billing.edit"]);
    assert.equal(failureOf(await ops.acceptOfferOperation.execute(limited, { id, version: versionOf(await fresh(id)) })).code, "forbidden");
  });

  it("Auftragsbestätigung aus dem angenommenen Angebot: ein Entwurf mit Bezug, höchstens einer", async () => {
    const session = await sessionFor(EDIT);
    const id = await issuedOffer(session);
    assert.equal(failureOf(await ops.createConfirmationOperation.execute(session, { id })).key, "billing.errors.notAccepted");
    await ops.acceptOfferOperation.execute(session, { id, version: versionOf(await fresh(id)) });
    const confirmation = await ops.createConfirmationOperation.execute(session, { id });
    assert.ok(confirmation.ok);
    const row = await fresh(confirmation.data.id);
    assert.deepEqual([row.docType, row.number, row.sourceDocId], ["confirmation", "", id]);
    assert.equal(failureOf(await ops.createConfirmationOperation.execute(session, { id })).code, "duplicate");
  });

  it("ein abgelaufenes Angebot ist abgelaufen, bis es angenommen wird", async () => {
    const { offerState } = await import("./domain");
    assert.equal(offerState({ offerStatus: "open", validUntil: new Date("2020-01-01T12:00:00Z") }), "expired");
    assert.equal(offerState({ offerStatus: "accepted", validUntil: new Date("2020-01-01T12:00:00Z") }), "accepted");
  });
});

describe("Angebot → Auftrag und Rechnung aus Auftrag", () => {
  let vehicleId: string;
  let orderSession: AppSession;
  const ORDER_RIGHTS = [...FINALIZE, "orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices"];
  before(async () => {
    await env.db.featureSetting.create({ data: { key: "workshop.orders", enabled: true, updatedByName: "test" } });
  });
  beforeEach(async () => {
    vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1", customerId, mileageKm: 1000 } })).id;
    orderSession = await sessionFor(ORDER_RIGHTS);
  });

  it("legt den Auftrag atomar an: Nummer, Positionen, Verknüpfung – oder gar nichts", async () => {
    const created = await ops.saveDraftOperation.execute(orderSession, { docType: "offer", customerId, vehicleId, items: items([{ description: "Bremsen", unitCents: 30000, discountBp: 1000 }]) });
    assert.ok(created.ok);
    const id = created.data.id;
    assert.ok((await ops.issueDocumentOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) })).ok);
    assert.equal(failureOf(await ops.orderFromOfferOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) })).key, "billing.errors.notAccepted");
    await ops.acceptOfferOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) });

    // Fehlschlag mitten drin (Fahrzeug archiviert): kein Auftrag, kein Zählerstand, Angebot unverändert
    await env.db.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: new Date() } });
    const version = versionOf(await fresh(id));
    const failed = await ops.orderFromOfferOperation.execute(orderSession, { id, version });
    assert.equal(failed.ok, false);
    assert.equal(await env.db.order.count(), 0);
    assert.equal(await env.db.counter.count({ where: { key: "orders" } }), 0);
    assert.equal(versionOf(await fresh(id)), version);
    assert.equal((await fresh(id)).orderId, null);

    await env.db.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: null } });
    const ok = await ops.orderFromOfferOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) });
    assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.failure));
    const order = await env.db.order.findUniqueOrThrow({ where: { id: ok.data.orderId }, include: { items: true } });
    assert.equal(order.number, ok.data.orderNumber);
    assert.equal(order.items.length, 1);
    assert.deepEqual([order.items[0].unitCents, order.items[0].discountBp, order.items[0].refType], [30000, 1000, "offer"]);
    assert.equal((await fresh(id)).orderId, order.id);
    assert.equal(failureOf(await ops.orderFromOfferOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) })).code, "duplicate");
  });

  it("braucht ein Fahrzeug am Angebot und die Auftragsrechte", async () => {
    const created = await ops.saveDraftOperation.execute(orderSession, { docType: "offer", customerId, items: items() });
    assert.ok(created.ok);
    const id = created.data.id;
    await ops.issueDocumentOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) });
    await ops.acceptOfferOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) });
    assert.equal(failureOf(await ops.orderFromOfferOperation.execute(orderSession, { id, version: versionOf(await fresh(id)) })).key, "billing.errors.noVehicle");
    const noOrders = await sessionFor(EDIT);
    assert.equal(failureOf(await ops.orderFromOfferOperation.execute(noOrders, { id, version: versionOf(await fresh(id)) })).code, "forbidden");
  });

  async function closedOrder() {
    const order = await env.db.order.create({
      data: {
        number: `A-${YEAR}-0001`,
        status: "picked_up",
        vehicleId,
        customerId,
        closedAt: new Date(),
        items: { create: [{ position: 0, kind: "labor", description: "Arbeit", unit: "Std", quantityMilli: 2000, unitCents: 8000, taxBp: 1900 }, { position: 1, kind: "part", description: "Filter", unit: "Stk", quantityMilli: 1000, unitCents: 1500, taxBp: 1900, discountBp: 500 }] },
      },
    });
    return order.id;
  }

  it("übernimmt Positionen und Verknüpfung; kein Doppelabrechnen ohne ausdrückliche Bestätigung", async () => {
    const orderId = await closedOrder();
    const created = await ops.invoiceFromOrderOperation.execute(orderSession, { orderId });
    assert.ok(created.ok, JSON.stringify(!created.ok && created.failure));
    const row = await env.db.invoice.findUniqueOrThrow({ where: { id: created.data.id }, include: { items: { orderBy: { position: "asc" } } } });
    assert.deepEqual([row.docType, row.orderId, row.vehicleLabel, row.customerId], ["invoice", orderId, "B AB 1", customerId]);
    assert.deepEqual(row.items.map((i) => [i.description, i.quantityMilli, i.unitCents, i.discountBp]), [["Arbeit", 2000, 8000, 0], ["Filter", 1000, 1500, 500]]);
    assert.equal(row.netCents, 16000 + 1425);
    const again = await ops.invoiceFromOrderOperation.execute(orderSession, { orderId });
    assert.equal(failureOf(again).key, "billing.errors.orderBilled");
    assert.ok((await ops.invoiceFromOrderOperation.execute(orderSession, { orderId, acknowledgeDuplicate: true })).ok);
  });

  it("ein nicht abgeschlossener Auftrag braucht die ausdrückliche Bestätigung; Preise brauchen orders.prices; eingeschränkte Kunden gehen nicht", async () => {
    const orderId = await closedOrder();
    await env.db.order.update({ where: { id: orderId }, data: { status: "in_progress", closedAt: null } });
    assert.equal(failureOf(await ops.invoiceFromOrderOperation.execute(orderSession, { orderId })).key, "billing.errors.orderOpen");
    assert.ok((await ops.invoiceFromOrderOperation.execute(orderSession, { orderId, confirmOpen: true })).ok);
    const noPrices = await sessionFor([...EDIT, "orders.view"]);
    assert.equal(failureOf(await ops.invoiceFromOrderOperation.execute(noPrices, { orderId, confirmOpen: true })).code, "forbidden");
    await env.db.customer.update({ where: { id: customerId }, data: { processingRestrictedAt: new Date() } });
    assert.equal(failureOf(await ops.invoiceFromOrderOperation.execute(orderSession, { orderId, confirmOpen: true, acknowledgeDuplicate: true })).key, "billing.errors.restricted");
  });
});

describe("PDF und XRechnung", () => {
  it("das PDF zeigt Nummer, Positionen, Summen, Bankverbindung und – bei Überweisung – den Girocode (UTF-8)", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session, { items: items([{ description: "Zündkerzen & Öl <Set>", quantityMilli: 4000, unitCents: 1250 }]), introText: "Vielen Dank für Ihren Auftrag." });
    const view = (await queries.loadDocView(id))!.view;
    const pdf = await docs.buildDocumentPdf(view);
    const info = inspectPdf(pdf);
    const text = info.pages.join("\n");
    assert.match(text, new RegExp(`Rechnung Nr\\. ${YEAR}-0001`));
    assert.match(text, /Zündkerzen & Öl <Set>/);
    assert.match(text, /59,50/);
    assert.match(text, /IBAN DE89 3704 0044 0532 0130 00/);
    assert.match(text, /Girocode/);
    assert.match(text, /Vielen Dank/);
    // Girocode: UTF-8, Betrag und Verwendungszweck
    const { epcPayload } = await import("@/lib/girocode");
    const payload = epcPayload({ name: "Autohaus Müller", iban: "DE89370400440532013000", bic: "COBADEFFXXX", amountCents: 7_140, reference: `Rechnung ${YEAR}-0001` });
    assert.ok(payload?.includes("EUR71.40"));
  });

  it("ein Entwurf trägt den Hinweis und keine Nummer", async () => {
    const session = await sessionFor(EDIT);
    const id = await draft(session);
    const view = (await queries.loadDocView(id))!.view;
    const text = inspectPdf(await docs.buildDocumentPdf(view)).pages.join("\n");
    assert.match(text, /Entwurf/);
    assert.match(text.replace(/\s+/g, " "), /wird beim Festschreiben vergeben/);
  });

  it("die XRechnung entsteht aus dem Schnappschuss, braucht Käuferreferenz und Kontaktdaten und wird vom Leser der Anwendung wieder gelesen", async () => {
    const session = await sessionFor(FINALIZE);
    const withoutRef = await finalized(session);
    const missing = xr.xrechnungProblems((await queries.loadDocView(withoutRef))!.view);
    assert.deepEqual(missing, ["buyerReference"]);
    const id = await finalized(session, { buyerReference: "KD-1001", items: items([{ description: "Arbeit & <Material>", unitCents: 12345, quantityMilli: 1500 }]) });
    const view = (await queries.loadDocView(id))!.view;
    assert.deepEqual(xr.xrechnungProblems(view), []);
    const xml = xr.buildDocumentXml(view);
    const { readEInvoice } = await import("@/lib/einvoice/extract");
    const read = readEInvoice(new TextEncoder().encode(xml));
    assert.ok(read.ok);
    if (!read.ok) return;
    assert.equal(read.proposal.number, `${YEAR}-0002`);
    assert.equal(read.proposal.grossCents, view.totals.grossCents);
    assert.equal(read.proposal.seller, "Autohaus Müller");
    assert.deepEqual(read.proposal.warnings, []);
    // Entwürfe haben keine XRechnung
    const d = await draft(session);
    assert.deepEqual(xr.xrechnungProblems((await queries.loadDocView(d))!.view), ["draft"]);
  });
});

describe("Versand per E-Mail", () => {
  let fake: FakeSmtp | null = null;
  let deliver: typeof import("@/server/mail/deliver");
  let settings: typeof import("@/server/mail/settings");
  let hostPolicy: typeof import("@/lib/offsite/host-policy");
  before(async () => {
    deliver = await import("@/server/mail/deliver");
    settings = await import("@/server/mail/settings");
    hostPolicy = await import("@/lib/offsite/host-policy");
  });
  beforeEach(async () => {
    await env.db.appSetting.deleteMany({ where: { key: { startsWith: "mail." } } });
  });
  const SEND = [...FINALIZE, "billing.send", "mail.send"];
  async function configure() {
    fake = await startFakeSmtp();
    hostPolicy.allowLoopbackForTests();
    await settings.saveMailSettings({ ...settings.DEFAULT_MAIL_SETTINGS, enabled: true, host: fake.host, port: fake.port, security: "none", allowPrivate: true, plainConfirmed: true, fromAddress: "werkstatt@example.org", fromName: "Autohaus Müller" }, env.db);
  }
  const closeFake = async () => {
    await fake?.close();
    fake = null;
  };

  it("sendet PDF und auf Wunsch die XRechnung an die Adresse des Kunden; wiederholter Versand braucht die Bestätigung", async () => {
    await configure();
    try {
      const session = await sessionFor(SEND);
      const id = await finalized(session, { buyerReference: "KD-1" });
      const sent = await ops.sendDocumentOperation.execute(session, { id, includeXml: true });
      assert.ok(sent.ok, JSON.stringify(!sent.ok && sent.failure));
      const row = await fresh(id);
      assert.ok(row.sentAt);
      assert.equal(row.sentCount, 1);
      const message = await env.db.mailMessage.findFirstOrThrow();
      assert.equal(message.toAddresses, "max@kunde.example");
      assert.equal(message.purpose, "billing");
      assert.equal(message.entityId, id);
      assert.match(message.subject, new RegExp(`Rechnung ${YEAR}-0001`));
      await deliver.deliverQueuedMail(message.id, { attempt: 1 });
      assert.equal(fake!.messages.length, 1);
      const data = fake!.messages[0].data;
      assert.match(data, new RegExp(`filename="?Rechnung_${YEAR}-0001\\.pdf`));
      assert.match(data, new RegExp(`filename="?Rechnung_${YEAR}-0001_xrechnung\\.xml`));
      assert.ok(fake!.messages[0].to.includes("max@kunde.example"));
      // noch einmal: Warnung, erst mit Bestätigung
      const again = await ops.sendDocumentOperation.execute(session, { id });
      assert.equal(failureOf(again).key, "billing.errors.alreadySent");
      assert.ok((await ops.sendDocumentOperation.execute(session, { id, resend: true })).ok);
      assert.equal((await fresh(id)).sentCount, 2);
    } finally {
      await closeFake();
    }
  });

  it("braucht billing.send und mail.send; ohne Adresse des Kunden, bei eingeschränktem Kunden oder ohne eingerichteten Versand wird nichts gesendet", async () => {
    const session = await sessionFor(SEND);
    const id = await finalized(session);
    // Versand nicht eingerichtet
    assert.equal(failureOf(await ops.sendDocumentOperation.execute(session, { id })).key, "mail.errors.notConfigured");
    await configure();
    try {
      const noBillingSend = await sessionFor([...FINALIZE, "mail.send"]);
      assert.equal(failureOf(await ops.sendDocumentOperation.execute(noBillingSend, { id })).code, "forbidden");
      const noMailSend = await sessionFor([...FINALIZE, "billing.send"]);
      assert.equal(failureOf(await ops.sendDocumentOperation.execute(noMailSend, { id })).code, "forbidden");
      assert.equal(await env.db.mailMessage.count(), 0);
      // Kunde ohne E-Mail (Schnappschuss ohne Adresse)
      await env.db.customer.update({ where: { id: customerId }, data: { email: null } });
      await env.db.invoiceSnapshot.update({ where: { invoiceId: id }, data: { rEmail: null } });
      assert.equal(failureOf(await ops.sendDocumentOperation.execute(session, { id })).key, "billing.errors.noEmail");
      // eingeschränkter Kunde
      await env.db.customer.update({ where: { id: customerId }, data: { email: "max@kunde.example", processingRestrictedAt: new Date() } });
      assert.equal(failureOf(await ops.sendDocumentOperation.execute(session, { id })).key, "billing.errors.restricted");
      assert.equal(await env.db.mailMessage.count(), 0);
      assert.equal((await fresh(id)).sentAt, null);
    } finally {
      await closeFake();
    }
  });

  it("schlägt die XRechnung wegen fehlender Angaben fehl, bleibt nichts im Dateispeicher liegen und nichts vorgemerkt", async () => {
    await configure();
    try {
      const session = await sessionFor(SEND);
      const id = await finalized(session);
      const failure = failureOf(await ops.sendDocumentOperation.execute(session, { id, includeXml: true }));
      assert.equal(failure.key, "billing.errors.xrechnungIncomplete");
      assert.ok(failure.data?.problems?.includes("buyerReference"));
      assert.equal(await env.db.mailMessage.count(), 0);
      const { readdirSync, existsSync } = await import("node:fs");
      const dir = `${env.dir}/files/rechnungen/versand`;
      const listing = () => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);
      const before = listing();
      assert.equal(failureOf(await ops.sendDocumentOperation.execute(session, { id, includeXml: true })).key, "billing.errors.xrechnungIncomplete");
      assert.deepEqual(listing(), before, "abgelegte Anhänge werden wieder entfernt");
    } finally {
      await closeFake();
    }
  });
});

describe("Rechte und Sichtbarkeit", () => {
  it("ohne Sitzungsrecht gibt es keine Operation; ein reiner Betrachter ändert nichts", async () => {
    const viewer = await sessionFor(["billing.view", "invoices.view"]);
    const session = await sessionFor(EDIT);
    const id = await draft(session);
    for (const attempt of [
      ops.deleteDraftOperation.execute(viewer, { id }),
      ops.issueDocumentOperation.execute(viewer, { id, version: "1" }),
      ops.createConfirmationOperation.execute(viewer, { id }),
    ]) assert.equal(failureOf(await attempt).code, "forbidden");
    assert.equal(await env.db.invoice.count(), 1);
  });

  it("andere Belege lassen sich nicht über fremde IDs bearbeiten (kein Beleg aus dem Archiv)", async () => {
    const session = await sessionFor(FINALIZE);
    const manual = await env.db.invoice.create({ data: { direction: "outgoing", number: "M-1", outgoingKey: "M-1", partyName: "Alt", partyKey: "alt", issueDate: new Date(), grossCents: 100 } });
    assert.equal(failureOf(await ops.deleteDraftOperation.execute(session, { id: manual.id })).code, "notFound");
    assert.equal(failureOf(await ops.addPaymentOperation.execute(session, { id: manual.id, amount: "1,00" })).code, "notFound");
  });
});

describe("Datenschutz (Art. 15, Anonymisierung, Sendeprotokoll)", () => {
  it("die Auskunft nennt Belege, Positionen und das Sendeprotokoll; Angebote zählen zur Aufbewahrung, Entwürfe nicht", async () => {
    const { privacyProviders } = await import("./privacy");
    const session = await sessionFor(FINALIZE);
    const invoice = await finalized(session);
    await draft(session);
    const offer = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items() });
    assert.ok(offer.ok);
    assert.ok((await ops.issueDocumentOperation.execute(session, { id: offer.data.id, version: versionOf(await fresh(offer.data.id)) })).ok);
    await env.db.mailMessage.create({ data: { userName: "Test", toAddresses: "max@kunde.example", subject: `Rechnung ${YEAR}-0001`, status: "sent", purpose: "billing", entityId: invoice } });

    const provider = privacyProviders[0];
    const sections = await provider.collect({ id: customerId, terms: [] });
    const docs = sections.find((s) => s.id === "billing")!;
    assert.equal(docs.records.length, 3, "Rechnung, Entwurf und Angebot");
    const text = JSON.stringify(sections);
    assert.ok(text.includes("max@kunde.example"), "Empfängeradresse im Sendeprotokoll");
    assert.ok(text.includes("Ölwechsel"), "Positionen");
    const retention = await provider.retention!({ id: customerId, terms: [] });
    assert.equal(retention.length, 1, "nur das ausgestellte Angebot (die Rechnung meldet das Archiv)");
    assert.equal(retention[0].kind, "invoice");
  });

  it("die Anonymisierung löscht Entwürfe, entfernt E-Mail-Adressen aus Beleg, Schnappschuss und Sendeprotokoll – Name und Anschrift der Rechnung bleiben", async () => {
    const { hooks } = await import("./hooks");
    const session = await sessionFor(FINALIZE);
    const invoice = await finalized(session);
    const dr = await draft(session);
    await env.db.mailMessage.create({ data: { userName: "Test", toAddresses: "max@kunde.example", deliveredTo: "max@kunde.example", subject: `Rechnung ${YEAR}-0001`, body: "Guten Tag Max", attachments: "a|b|c", status: "sent", purpose: "billing", entityId: invoice } });
    const other = await env.db.mailMessage.create({ data: { userName: "Test", toAddresses: "andere@example.com", subject: "Anderes", status: "sent", purpose: "other", entityId: invoice } });

    await env.db.$transaction(async (tx) => {
      for (const hook of hooks) await hook.run({ tx, input: { id: customerId } } as never);
    });

    assert.equal(await env.db.invoice.findUnique({ where: { id: dr } }), null, "Entwurf gelöscht");
    const row = await fresh(invoice);
    assert.equal(row.buyerEmail, null);
    assert.equal(row.partyName, "Max Mustermann", "der Empfänger bleibt auf der Rechnung");
    assert.equal(row.number, `${YEAR}-0001`);
    const snap = await env.db.invoiceSnapshot.findUniqueOrThrow({ where: { invoiceId: invoice } });
    assert.deepEqual([snap.rEmail, snap.rName, snap.rStreet], [null, "Max Mustermann", "Nebenweg 2"]);
    const mail = await env.db.mailMessage.findFirstOrThrow({ where: { purpose: "billing" } });
    assert.deepEqual([mail.toAddresses, mail.deliveredTo, mail.subject, mail.body, mail.attachments], ["(anonymisiert)", null, "(anonymisiert)", null, null]);
    assert.equal((await env.db.mailMessage.findUniqueOrThrow({ where: { id: other.id } })).toAddresses, "andere@example.com", "fremde Protokollzeilen bleiben");
  });
});

describe("Fix-Runde 12d: Storno nur für Rechnungen", () => {
  const cancel = (session: AppSession, id: string, extra: Record<string, unknown> = {}) => invoiceOps.cancelInvoiceOperation.execute(session, { id, ...extra });

  it("Angebot, Auftragsbestätigung und Entwurf lassen sich nicht stornieren – es entsteht kein Gegenbeleg und keine Rechnungsnummer wird verbraucht", async () => {
    const session = await sessionFor(FINALIZE);
    const offer = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items() });
    assert.ok(offer.ok);
    assert.ok((await ops.issueDocumentOperation.execute(session, { id: offer.data.id, version: versionOf(await fresh(offer.data.id)) })).ok);
    assert.ok((await ops.acceptOfferOperation.execute(session, { id: offer.data.id, version: versionOf(await fresh(offer.data.id)) })).ok);
    const confirmation = await ops.createConfirmationOperation.execute(session, { id: offer.data.id });
    assert.ok(confirmation.ok);
    assert.ok((await ops.issueDocumentOperation.execute(session, { id: confirmation.data.id, version: versionOf(await fresh(confirmation.data.id)) })).ok);
    const dr = await draft(session);
    const before = await env.db.counter.findMany({ orderBy: { key: "asc" } });
    for (const id of [offer.data.id, confirmation.data.id, dr]) {
      const outcome = await cancel(session, id, { version: versionOf(await fresh(id)) });
      assert.equal(failureOf(outcome).code, "notFound", id);
    }
    assert.equal(await env.db.invoice.count({ where: { cancelsInvoiceId: { not: null } } }), 0);
    assert.deepEqual(await env.db.counter.findMany({ orderBy: { key: "asc" } }), before, "kein Zähler weitergestellt");
    assert.equal((await fresh(offer.data.id)).status, "open", "das Angebot bleibt unverändert");
    // die erste Rechnung bekommt weiterhin die erste Nummer
    const invoice = await finalized(session);
    assert.equal((await fresh(invoice)).number, `${YEAR}-0001`);
  });

  it("das Datum der Stornorechnung eines Buchungsbelegs ist immer heute (Eingabe wird ignoriert); manuell erfasste Rechnungen: nie in der Zukunft", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    const done = await cancel(session, id, { version: versionOf(await fresh(id)), issueDate: addDaysToKey(todayInput(), 30) });
    assert.ok(done.ok, JSON.stringify(!done.ok && done.failure));
    const counter = await fresh(done.data.counterId);
    assert.equal(counter.issueDate.toISOString().slice(0, 10), todayInput(), "Datum = heute, nicht das eingegebene");

    const manual = await env.db.invoice.create({ data: { direction: "outgoing", number: "M-7", outgoingKey: "M-7", partyName: "Alt", partyKey: "alt", issueDate: new Date("2026-01-10T12:00:00Z"), grossCents: 100, finalizedAt: new Date(), finalizedByName: "t" } });
    const future = await cancel(session, manual.id, { version: versionOf(manual), number: "M-S-1", issueDate: addDaysToKey(todayInput(), 5) });
    assert.equal(failureOf(future).fields?.issueDate?.key, "invoices.errors.cancelFuture");
    assert.ok((await cancel(session, manual.id, { version: versionOf(await fresh(manual.id)), number: "M-S-1", issueDate: todayInput() })).ok);
  });
});

describe("Fix-Runde 12d: 0-€-Belege", () => {
  it("eine Rechnung über 0 € oder einen negativen Betrag lässt sich nicht festschreiben, es wird keine Nummer verbraucht", async () => {
    const session = await sessionFor(FINALIZE);
    for (const unitCents of [0, -5000]) {
      const id = await draft(session, { items: items([{ unitCents }]) });
      const failure = failureOf(await finalize(session, id));
      assert.equal(failure.key, "billing.errors.incomplete");
      assert.ok(failure.data?.problems?.includes("amount"), String(unitCents));
    }
    assert.equal(await env.db.counter.count(), 0);
  });

  it("eine Schlussrechnung, die die Abschläge voll anrechnet (Zahlbetrag 0), gilt von Anfang an als bezahlt – nicht offen und nicht überfällig", async () => {
    const session = await sessionFor(FINALIZE);
    const partialDraft = await ops.saveDraftOperation.execute(session, { docType: "partial", customerId, items: items([{ unitCents: 10000 }]), serviceFrom: todayInput() });
    assert.ok(partialDraft.ok);
    assert.ok((await finalize(session, partialDraft.data.id)).ok);
    const finalId = await finalized(session, { docType: "final", deductPartialIds: [partialDraft.data.id], items: items([{ unitCents: 10000 }]) });
    const row = await fresh(finalId);
    assert.deepEqual([row.grossCents, row.deductedCents, row.status], [11900, 11900, "paid"]);
    assert.ok(row.paidAt);
    const sums = await invoiceQueries.invoiceSums({ direction: "outgoing" });
    assert.equal(sums.overdueCount, 0);
    assert.equal(sums.openCount, 1, "nur der Abschlag ist noch offen");
    assert.equal((await queries.billingStats()).outstandingCount, 1);
    // der Beleg lässt sich weiter stornieren (gibt den Abschlag frei)
    assert.ok((await invoiceOps.cancelInvoiceOperation.execute(session, { id: finalId, version: versionOf(await fresh(finalId)) })).ok);
  });
});

describe("Fix-Runde 12d: Kunde im Entwurf und Art. 18", () => {
  it("beim Kundenwechsel eines Entwurfs werden Name, Anschrift und E-Mail neu aus dem neuen Kunden gefüllt – nie bleiben die Angaben des alten stehen", async () => {
    const session = await sessionFor(EDIT);
    const id = await draft(session);
    const before = await fresh(id);
    const other = await env.db.customer.create({ data: { lastName: "Beispiel", firstName: "Berta", street: "Ring 5", zip: "80331", city: "München", email: "berta@kunde.example", customerNumber: "K-2", nameKey: "beispiel berta" } });
    // das Formular schickt die vorbelegten Werte des alten Kunden unverändert mit
    const result = await ops.saveDraftOperation.execute(session, {
      id, version: versionOf(before), customerId: other.id, partyName: before.partyName, partyStreet: before.partyStreet ?? undefined, partyZip: before.partyZip ?? undefined, partyCity: before.partyCity ?? undefined, buyerEmail: before.buyerEmail ?? undefined, items: items(),
    });
    assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
    const row = await fresh(id);
    assert.deepEqual([row.customerId, row.partyName, row.partyStreet, row.partyZip, row.partyCity, row.buyerEmail], [other.id, "Berta Beispiel", "Ring 5", "80331", "München", "berta@kunde.example"]);
    // ohne Wechsel bleiben bewusst geänderte Angaben stehen
    const kept = await ops.saveDraftOperation.execute(session, { id, version: versionOf(row), customerId: other.id, partyName: "Beispiel GmbH", items: items() });
    assert.ok(kept.ok);
    assert.equal((await fresh(id)).partyName, "Beispiel GmbH");
  });

  it("Auftragsbestätigung und Auftrag aus dem Angebot entstehen nicht für Kunden mit eingeschränkter Verarbeitung; ein Fahrzeug eines solchen Kunden lässt sich nicht neu verknüpfen", async () => {
    await env.db.featureSetting.upsert({ where: { key: "workshop.orders" }, update: { enabled: true }, create: { key: "workshop.orders", enabled: true, updatedByName: "test" } });
    const session = await sessionFor([...EDIT, "orders.view", "orders.create", "orders.edit", "orders.prices"]);
    const vehicle = await env.db.vehicle.create({ data: { plate: "B-XY 1", plateNorm: "BXY1", make: "VW", model: "Golf", customerId } });
    const created = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, vehicleId: vehicle.id, items: items() });
    assert.ok(created.ok, JSON.stringify(!created.ok && created.failure));
    const id = created.data.id;
    assert.ok((await ops.issueDocumentOperation.execute(session, { id, version: versionOf(await fresh(id)) })).ok);
    assert.ok((await ops.acceptOfferOperation.execute(session, { id, version: versionOf(await fresh(id)) })).ok);
    await env.db.customer.update({ where: { id: customerId }, data: { processingRestrictedAt: new Date() } });
    assert.equal(failureOf(await ops.createConfirmationOperation.execute(session, { id })).key, "billing.errors.restricted");
    assert.equal(failureOf(await ops.orderFromOfferOperation.execute(session, { id, version: versionOf(await fresh(id)) })).key, "billing.errors.restricted");
    assert.equal(await env.db.order.count(), 0);
    assert.equal(await env.db.invoice.count({ where: { docType: "confirmation" } }), 0);
    // Fahrzeug eines eingeschränkten Kunden: nicht neu verknüpfbar
    const again = await ops.saveDraftOperation.execute(session, { docType: "invoice", vehicleId: vehicle.id, partyName: "Barkunde", items: items() });
    assert.equal(failureOf(again).fields?.vehicleId?.key, "billing.errors.restricted");
  });
});

describe("Fix-Runde 12d: Zahlungen bei ausgeschalteter Funktion", () => {
  it("ist die Rechnungserstellung aus, lässt sich der Zahlstatus ihrer Rechnungen über das Archiv erfassen; ist sie an, bleibt die Sperre", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    assert.ok((await ops.addPaymentOperation.execute(session, { id, amount: "19,00" })).ok);
    // Funktion an: das Archiv sperrt (Zahlungen werden in der Rechnungserstellung erfasst)
    assert.equal(failureOf(await invoiceOps.markInvoicePaidOperation.execute(session, { id })).key, "invoices.errors.billingPayments");
    // Funktion aus (Daten bleiben)
    await env.db.featureSetting.update({ where: { key: "office.billing" }, data: { enabled: false } });
    try {
      const off = await sessionFor(FINALIZE);
      assert.ok(!off.features.has("office.billing"));
      const paid = await invoiceOps.markInvoicePaidOperation.execute(off, { id });
      assert.ok(paid.ok, JSON.stringify(!paid.ok && paid.failure));
      const row = await fresh(id);
      assert.deepEqual([row.status, row.paidCents], ["paid", 11900]);
      const payments = await env.db.invoicePayment.findMany({ where: { invoiceId: id }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(payments.map((p) => p.amountCents), [1900, 10000], "der Rest ist als Zahlung gebucht, Summe = Zahlstand");
      assert.ok((await invoiceOps.reopenInvoiceOperation.execute(off, { id })).ok);
      assert.equal((await fresh(id)).status, "open");
      // die Belegfelder bleiben gesperrt
      const edit = await invoiceOps.saveInvoiceOperation.execute(off, { id, version: versionOf(await fresh(id)), direction: "outgoing", number: "X-1", partyName: "X", issueDate: todayInput(), gross: "1,00", status: "open", removeFile: false });
      assert.equal(failureOf(edit).key, "invoices.errors.billingDoc");
    } finally {
      await env.db.featureSetting.update({ where: { key: "office.billing" }, data: { enabled: true } });
    }
  });

  it("Entwürfe haben im Archiv keinen Zahlstatus (nicht gefunden)", async () => {
    const session = await sessionFor(FINALIZE);
    const dr = await draft(session);
    assert.equal(failureOf(await invoiceOps.markInvoicePaidOperation.execute(session, { id: dr })).code, "notFound");
    assert.equal(failureOf(await invoiceOps.reopenInvoiceOperation.execute(session, { id: dr })).code, "notFound");
  });
});

describe("Fix-Runde 12d: versendete Anhänge", () => {
  let fake: FakeSmtp | null = null;
  let settings: typeof import("@/server/mail/settings");
  let hostPolicy: typeof import("@/lib/offsite/host-policy");
  before(async () => {
    settings = await import("@/server/mail/settings");
    hostPolicy = await import("@/lib/offsite/host-policy");
  });
  beforeEach(async () => {
    await env.db.appSetting.deleteMany({ where: { key: { startsWith: "mail." } } });
    fake = await startFakeSmtp();
    hostPolicy.allowLoopbackForTests();
    await settings.saveMailSettings({ ...settings.DEFAULT_MAIL_SETTINGS, enabled: true, host: fake.host, port: fake.port, security: "none", allowPrivate: true, plainConfirmed: true, fromAddress: "werkstatt@example.org", fromName: "Autohaus Müller" }, env.db);
  });
  const SEND = [...FINALIZE, "billing.send", "mail.send"];
  const exists = async (rel: string) => (await import("node:fs")).existsSync(`${env.dir}/files/${rel}`);

  it("der Versand merkt die Anhänge am Beleg; Angebote räumt der Aufräumlauf nach 30 Tagen weg, Rechnungen behalten ihre Kopie bis zur Anonymisierung", async () => {
    try {
      const { purgeSentFiles } = await import("./sent-files");
      const { hooks } = await import("./hooks");
      const session = await sessionFor(SEND);
      const invoice = await finalized(session);
      const offer = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items() });
      assert.ok(offer.ok);
      assert.ok((await ops.issueDocumentOperation.execute(session, { id: offer.data.id, version: versionOf(await fresh(offer.data.id)) })).ok);
      assert.ok((await ops.sendDocumentOperation.execute(session, { id: invoice })).ok);
      assert.ok((await ops.sendDocumentOperation.execute(session, { id: offer.data.id })).ok);
      const invoiceFile = await env.db.invoiceSentFile.findFirstOrThrow({ where: { invoiceId: invoice } });
      const offerFile = await env.db.invoiceSentFile.findFirstOrThrow({ where: { invoiceId: offer.data.id } });
      assert.equal(invoiceFile.purgeAfter, null);
      assert.ok(offerFile.purgeAfter && offerFile.purgeAfter.getTime() > Date.now() + 29 * 86_400_000);
      assert.ok((await exists(invoiceFile.path)) && (await exists(offerFile.path)));

      // vor der Frist passiert nichts, danach verschwindet nur die Angebotskopie
      assert.equal(await purgeSentFiles(new Date()), 0);
      assert.equal(await purgeSentFiles(new Date(Date.now() + 31 * 86_400_000)), 1);
      assert.ok(!(await exists(offerFile.path)));
      assert.ok(await exists(invoiceFile.path), "die Kopie der Rechnung bleibt");
      assert.equal(await env.db.invoiceSentFile.count({ where: { invoiceId: offer.data.id } }), 0);
      assert.equal(await purgeSentFiles(new Date(Date.now() + 31 * 86_400_000)), 0, "wiederholbar");

      // Anonymisierung: die Kopie der Rechnung wird fällig und verschwindet mit dem nächsten Lauf
      await env.db.$transaction(async (tx) => {
        for (const hook of hooks) await hook.run({ tx, input: { id: customerId } } as never);
      });
      assert.equal(await purgeSentFiles(new Date(Date.now() + 1000)), 1);
      assert.ok(!(await exists(invoiceFile.path)));
    } finally {
      await fake?.close();
      fake = null;
    }
  });

  it("ein stornierter Beleg wird nicht mehr versendet (die Stornorechnung schon); der Versand geht an die Adresse des Belegs", async () => {
    try {
      const session = await sessionFor(SEND);
      const id = await finalized(session);
      // Kunde bekommt später eine andere Adresse: der Beleg nennt weiter die alte, der Versand geht an die des Belegs
      await env.db.customer.update({ where: { id: customerId }, data: { email: "neu@kunde.example" } });
      assert.ok((await ops.sendDocumentOperation.execute(session, { id })).ok);
      assert.equal((await env.db.mailMessage.findFirstOrThrow()).toAddresses, "max@kunde.example");
      const cancelled = await invoiceOps.cancelInvoiceOperation.execute(session, { id, version: versionOf(await fresh(id)) });
      assert.ok(cancelled.ok);
      assert.equal(failureOf(await ops.sendDocumentOperation.execute(session, { id, resend: true })).key, "billing.errors.cancelledSend");
      assert.ok((await ops.sendDocumentOperation.execute(session, { id: cancelled.data.counterId })).ok);
    } finally {
      await fake?.close();
      fake = null;
    }
  });
});
