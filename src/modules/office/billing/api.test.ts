import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { currentYear, todayInput } from "@/lib/dates";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { inspectPdf } from "@/test/pdf-text";

/**
 * API der Rechnungserstellung (`/api/v1/billing-documents`, `/billing-payments`): dieselben Operationen wie die Oberfläche; Rechte je Aktion (Festschreiben nur mit `invoices.finalize`,
 * Versand nur mit `billing.send` ausdrücklich im Token); festgeschriebene Belege sind unveränderlich (409); Elternteile eingeschränkter Kunden gibt es nicht (404, Art. 18); PDF und XML als Downloads;
 * wirksam ist Scope ∩ Rechte des Besitzers.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let router: typeof import("@/server/api/router");
let state: typeof import("@/server/api/state");
let full: string;
let customerId: string;
const YEAR = currentYear();

const EDIT = ["billing.view", "billing.edit", "billing.accept", "invoices.view", "invoices.edit", "invoices.finalize"];
const PROFILE = { id: "default", name: "Autohaus Müller", street: "Hauptstraße 1", zip: "10115", city: "Berlin", phone: "030 123456", email: "info@mueller.example", taxNumber: "12/345/67890", iban: "DE89370400440532013000", paymentTermDays: 14, smallBusiness: false, invoiceNumberFormat: "{YYYY}-{NNNN}" };

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.billing", enabled: true, updatedByName: "test" } });
  router = await import("@/server/api/router");
  state = await import("@/server/api/state");
  state.apiLimits.failuresGlobal = 1_000_000;
});
after(() => env.cleanup());

beforeEach(async () => {
  state.resetApiLimiters();
  await env.db.apiIdempotencyKey.deleteMany();
  await env.db.invoiceDeduction.deleteMany();
  await env.db.invoiceSentFile.deleteMany();
  await env.db.invoicePayment.deleteMany();
  await env.db.invoiceOriginal.deleteMany();
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } });
  await env.db.invoice.deleteMany({ where: { sourceDocId: { not: null } } });
  await env.db.invoice.deleteMany();
  await env.db.counter.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.customer.deleteMany();
  await env.db.workshop.upsert({ where: { id: "default" }, update: PROFILE, create: PROFILE });
  full = (await makeToken(env, { ownerPermissions: [...EDIT, "billing.send", "mail.send"], scope: EDIT, rateLimitPerMinute: 6000 })).token;
  customerId = (await env.db.customer.create({ data: { lastName: "Mustermann", firstName: "Max", street: "Nebenweg 2", zip: "50667", city: "Köln", email: "max@kunde.example", nameKey: "mustermann max" } })).id;
});

const call = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await router.handleApiRequest(apiRequest(method, path, { token, body, headers }));
  const text = await response.text();
  return { status: response.status, json: (text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Json, text, response };
};
const ifMatch = (item: Json) => ({ "if-match": `"${item.version}"` });
const line = (extra: Record<string, unknown> = {}) => ({ description: "Ölwechsel", unit: "Stk", quantityMilli: 1000, unitCents: 10000, taxBp: 1900, ...extra });
async function draft(token = full, extra: Record<string, unknown> = {}) {
  const created = await call(token, "POST", "/billing-documents", { docType: "invoice", customerId, serviceFrom: todayInput(), items: [line()], ...extra });
  assert.equal(created.status, 201, created.text);
  return created.json.data as Json;
}
const get = async (token: string, id: string) => (await call(token, "GET", `/billing-documents/${id}`)).json.data as Json;

describe("Belege über die API", () => {
  it("Entwurf anlegen, lesen (mit Positionen und Summen), ändern mit If-Match, Positionen ersetzen, löschen", async () => {
    const created = await draft();
    assert.equal(created.state, "draft");
    assert.equal(created.number, "");
    assert.deepEqual([created.netCents, created.vatCents, created.grossCents], [10000, 1900, 11900]);
    assert.equal(created.items.length, 1);
    assert.equal((await call(full, "PATCH", `/billing-documents/${created.id}`, { introText: "Danke" })).status, 428);
    const patched = await call(full, "PATCH", `/billing-documents/${created.id}`, { introText: "Danke", items: [line(), line({ description: "Filter", unitCents: 2000, taxBp: 700 })] }, ifMatch(created));
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.data.items.length, 2);
    assert.equal(patched.json.data.introText, "Danke");
    assert.equal(patched.json.data.grossCents, 11900 + 2140);
    assert.equal((await call(full, "PATCH", `/billing-documents/${created.id}`, { introText: "x" }, ifMatch(created))).status, 412);
    assert.equal((await call(full, "DELETE", `/billing-documents/${created.id}`)).status, 204);
    assert.equal(await env.db.invoice.count(), 0);
  });

  it("ungültige Steuersätze und zu große Summen sind 422 – es wird nichts gespeichert", async () => {
    const bad = await call(full, "POST", "/billing-documents", { docType: "invoice", customerId, items: [line({ taxBp: 1500 })] });
    assert.equal(bad.status, 422);
    assert.ok(bad.json.fields?.["items.0.taxBp"]);
    const huge = await call(full, "POST", "/billing-documents", { docType: "invoice", customerId, items: [line({ unitCents: 1_900_000_000 })] });
    assert.equal(huge.status, 422);
    assert.equal(await env.db.invoice.count(), 0);
  });

  it("Festschreiben: Nummer aus dem Zähler, danach unveränderlich (409) und nicht löschbar; ohne invoices.finalize nicht erreichbar", async () => {
    const created = await draft();
    const noFinalize = (await makeToken(env, { ownerPermissions: [...EDIT, "billing.send"], scope: ["billing.view", "billing.edit"], rateLimitPerMinute: 6000 })).token;
    assert.equal((await call(noFinalize, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created))).status, 403);
    assert.equal((await call(full, "POST", `/billing-documents/${created.id}/finalize`)).status, 428);
    const done = await call(full, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created));
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.data.number, `${YEAR}-0001`);
    assert.equal(done.json.data.state, "issued");
    const patch = await call(full, "PATCH", `/billing-documents/${created.id}`, { introText: "x" }, ifMatch(done.json.data));
    assert.equal(patch.status, 409);
    assert.equal((await call(full, "DELETE", `/billing-documents/${created.id}`)).status, 409);
    // steht in der Ausgangsliste des Archivs
    const ledger = await call(full, "GET", "/invoices?direction=outgoing");
    assert.equal(ledger.json.data.length, 1);
    assert.equal(ledger.json.data[0].docType, "invoice");
  });

  it("Entwürfe und Angebote stehen nie in /invoices", async () => {
    await draft();
    await draft(full, { docType: "offer", items: [line()] });
    assert.equal((await call(full, "GET", "/invoices")).json.data.length, 0);
    assert.equal((await call(full, "GET", "/billing-documents")).json.data.length, 2);
  });

  it("Zahlungen: anlegen, Teilzahlung, Überzahlung 422, lesen, entfernen", async () => {
    const created = await draft();
    const done = await call(full, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created));
    const id = done.json.data.id as string;
    const partial = await call(full, "POST", "/billing-payments", { documentId: id, amountCents: 5000, method: "cash" });
    assert.equal(partial.status, 201, partial.text);
    assert.equal((await get(full, id)).paidCents, 5000);
    assert.equal((await call(full, "POST", "/billing-payments", { documentId: id, amountCents: 9000 })).status, 422);
    const list = await call(full, "GET", `/billing-payments?documentId=${id}`);
    assert.equal(list.json.data.length, 1);
    assert.equal((await call(full, "DELETE", `/billing-payments/${partial.json.data.id}`)).status, 204);
    assert.equal((await get(full, id)).paidCents, 0);
  });

  it("Angebot: ausstellen, annehmen, Auftragsbestätigung als Entwurf; ohne billing.accept im Token geht Annehmen nicht", async () => {
    const created = await draft(full, { docType: "offer", items: [line()], customerId });
    const issued = await call(full, "POST", `/billing-documents/${created.id}/issue`, undefined, ifMatch(created));
    assert.equal(issued.status, 200, issued.text);
    assert.equal(issued.json.data.number, `AN-${YEAR}-0001`);
    const noAccept = (await makeToken(env, { ownerPermissions: EDIT, scope: ["billing.view", "billing.edit"], rateLimitPerMinute: 6000 })).token;
    assert.equal((await call(noAccept, "POST", `/billing-documents/${created.id}/accept`, {}, ifMatch(issued.json.data))).status, 403);
    const accepted = await call(full, "POST", `/billing-documents/${created.id}/accept`, {}, ifMatch(issued.json.data));
    assert.equal(accepted.status, 200, accepted.text);
    assert.equal(accepted.json.data.offerStatus, "accepted");
    const confirmation = await call(full, "POST", `/billing-documents/${created.id}/confirmation`);
    assert.equal(confirmation.status, 201, confirmation.text);
    assert.equal(confirmation.json.data.docType, "confirmation");
    assert.equal(confirmation.json.data.sourceDocId, created.id);
    assert.equal((await call(full, "POST", `/billing-documents/${created.id}/confirmation`)).status, 409);
  });

  it("Versand per Token ist nicht möglich (Z6-1 L3): mail.send ist ein Plattformrecht und nie in einem Token – genau 403, auch mit billing.send im Scope und mail.send beim Besitzer; es wird nichts gesendet", async () => {
    const created = await draft();
    const done = await call(full, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created));
    const noSendInScope = (await makeToken(env, { ownerPermissions: [...EDIT, "billing.send", "mail.send"], scope: EDIT, rateLimitPerMinute: 6000 })).token;
    // `billing.send` ist gekennzeichnet (Versand): ein Token trägt es nur, wenn es ausdrücklich im Scope steht
    const resNoScope = await call(noSendInScope, "POST", `/billing-documents/${done.json.data.id}/send`, {});
    assert.equal(resNoScope.status, 403);
    const withSend = (await makeToken(env, { ownerPermissions: [...EDIT, "billing.send", "mail.send"], scope: [...EDIT, "billing.send"], rateLimitPerMinute: 6000 })).token;
    const res = await call(withSend, "POST", `/billing-documents/${done.json.data.id}/send`, {});
    assert.equal(res.status, 403, res.text);
    assert.equal(await env.db.mailMessage.count(), 0);
  });

  it("Art. 18: Belege und Elternteile eingeschränkter Kunden gibt es nicht (404)", async () => {
    const created = await draft();
    const done = await call(full, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created));
    await env.db.customer.update({ where: { id: customerId }, data: { processingRestrictedAt: new Date() } });
    assert.equal((await call(full, "GET", `/billing-documents/${done.json.data.id}`)).status, 404);
    assert.equal((await call(full, "GET", "/billing-documents")).json.data.length, 0);
    assert.equal((await call(full, "POST", "/billing-documents", { docType: "invoice", customerId, items: [line()] })).status, 404);
    assert.equal((await call(full, "POST", "/billing-payments", { documentId: done.json.data.id, amountCents: 100 })).status, 404);
    assert.equal((await call(full, "GET", `/billing-documents/${done.json.data.id}/pdf`)).status, 404);
  });

  it("PDF und XML als Download: Rechte, Kopfzeilen, Inhalt; die XRechnung nennt fehlende Angaben (422)", async () => {
    const created = await draft(full, { buyerReference: "KD-1" });
    const done = await call(full, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created));
    const id = done.json.data.id as string;
    const pdf = await router.handleApiRequest(apiRequest("GET", `/billing-documents/${id}/pdf`, { token: full }));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition") ?? "", new RegExp(`Rechnung_${YEAR}-0001\\.pdf`));
    assert.equal(pdf.headers.get("x-content-type-options"), "nosniff");
    assert.match(inspectPdf(new Uint8Array(await pdf.arrayBuffer())).pages.join("\n"), new RegExp(`Rechnung Nr\\. ${YEAR}-0001`));
    const xml = await router.handleApiRequest(apiRequest("GET", `/billing-documents/${id}/xml`, { token: full }));
    assert.equal(xml.status, 200, await xml.clone().text());
    assert.match(xml.headers.get("content-type") ?? "", /xml/);
    assert.match(await xml.text(), /<cbc:BuyerReference>KD-1<\/cbc:BuyerReference>/);
    const other = await draft(full, { buyerReference: undefined });
    const done2 = await call(full, "POST", `/billing-documents/${other.id}/finalize`, undefined, ifMatch(other));
    assert.equal((await call(full, "GET", `/billing-documents/${done2.json.data.id}/xml`)).status, 422);
    const viewer = (await makeToken(env, { ownerPermissions: ["invoices.view"], scope: ["invoices.view"], rateLimitPerMinute: 6000 })).token;
    assert.equal((await call(viewer, "GET", `/billing-documents/${id}/pdf`)).status, 403);
  });

  it("Rechnung aus Auftrag über die API braucht den Auftrag (404 für Unbekanntes)", async () => {
    const res = await call(full, "POST", "/billing-documents/from-order", { orderId: "gibtsnicht" });
    assert.equal(res.status, 404);
  });

  it("Storno über /invoices/{id}/cancel: Gegenbeleg mit automatischer Nummer", async () => {
    const created = await draft();
    const done = await call(full, "POST", `/billing-documents/${created.id}/finalize`, undefined, ifMatch(created));
    const inv = await call(full, "GET", `/invoices/${done.json.data.id}`);
    const cancelled = await call(full, "POST", `/invoices/${done.json.data.id}/cancel`, { reason: "Irrtum" }, ifMatch(inv.json.data));
    assert.equal(cancelled.status, 200, cancelled.text);
    const credit = await call(full, "GET", `/invoices/${cancelled.json.data.cancelledByInvoiceId}`);
    assert.equal(credit.json.data.number, `${YEAR}-0002`);
    assert.equal(credit.json.data.grossCents, -11900);
    assert.equal(credit.json.data.docType, "credit");
  });
});
