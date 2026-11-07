import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";
import { cancelBlock, counterAmounts, finalizeBlock } from "./domain";

/** Festschreiben und Storno per Gegenbeleg (P4b-3): Sperren, Zahlstatus, Audit, Eindeutigkeit der Nummern, Rechte. */
let env: TestEnv;
let actions: typeof import("./actions");
let decodeFlash: typeof import("@/server/operations/flash").decodeFlash;

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  ({ decodeFlash } = await import("@/server/operations/flash"));
});
after(() => env.cleanup());

const ALL = ["invoices.view", "invoices.edit", "invoices.delete", "invoices.finalize"];
beforeEach(async () => {
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } }); // Gegenbelege zuerst (Verweis auf das Original ist Restrict)
  await env.db.invoice.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  await env.signIn(await env.user({ username: "chef", name: "Erika Chef", roles: [await env.role({ key: `r-${Math.random()}`, permissions: ALL })] }));
});

const make = (extra: Record<string, unknown> = {}) =>
  env.db.invoice.create({
    data: { direction: "outgoing", number: "2026-0001", outgoingKey: "2026-0001", partyName: "Kunde", partyKey: "kunde", issueDate: new Date("2026-03-10T12:00:00Z"), netCents: 10000, vatCents: 1900, grossCents: 11900, ...extra },
  });
const fresh = (id: string) => env.db.invoice.findUniqueOrThrow({ where: { id } });
const finalize = async (id: string) => {
  await actions.finalizeInvoice(form({ id, version: versionOf(await fresh(id)) }));
  return fresh(id);
};
const cancel = async (id: string, extra: Record<string, string> = {}) =>
  actions.cancelInvoice({}, form({ id, version: versionOf(await fresh(id)), number: "2026-S-1", ...extra }));
const flashKey = () => {
  const write = env.browser.writes.filter((w) => w.name === "so_flash").at(-1);
  return write ? decodeFlash(write.value)?.key : null;
};

describe("Domain: Sperren und Gegenbeleg-Beträge", () => {
  const base = { direction: "outgoing", finalizedAt: null, cancelsInvoiceId: null, status: "open", docType: "invoice" };
  it("finalizeBlock: nur offene, nicht festgeschriebene Ausgangsrechnungen", () => {
    assert.equal(finalizeBlock(base), null);
    assert.equal(finalizeBlock({ ...base, direction: "incoming" }), "incoming");
    assert.equal(finalizeBlock({ ...base, finalizedAt: new Date() }), "already");
    assert.equal(finalizeBlock({ ...base, status: "cancelled" }), "cancelled");
  });
  it("cancelBlock: nur festgeschriebene Ausgangsrechnungen, einmal, nie ein Gegenbeleg", () => {
    const final = { ...base, finalizedAt: new Date(), hasCounterDocument: false };
    assert.equal(cancelBlock(final), null);
    assert.equal(cancelBlock({ ...final, finalizedAt: null }), "notFinalized");
    assert.equal(cancelBlock({ ...final, direction: "incoming" }), "incoming");
    assert.equal(cancelBlock({ ...final, hasCounterDocument: true }), "already");
    assert.equal(cancelBlock({ ...final, cancelsInvoiceId: "x" }), "counterDocument");
    // Angebote, Auftragsbestätigungen und Gegenbelege sind keine stornierbaren Rechnungen
    for (const docType of ["offer", "confirmation", "credit"]) assert.equal(cancelBlock({ ...final, docType }), "notInvoice", docType);
    for (const docType of ["invoice", "partial", "final"]) assert.equal(cancelBlock({ ...final, docType }), null, docType);
  });
  it("counterAmounts kehrt das Vorzeichen um, lässt Fehlendes fehlen und macht aus 0 keine -0", () => {
    assert.deepEqual(counterAmounts({ netCents: 10000, vatCents: 1900, grossCents: 11900 }), { netCents: -10000, vatCents: -1900, grossCents: -11900 });
    assert.deepEqual(counterAmounts({ netCents: null, vatCents: null, grossCents: -500 }), { netCents: null, vatCents: null, grossCents: 500 });
    assert.ok(Object.is(counterAmounts({ netCents: 0, vatCents: 0, grossCents: 1 }).netCents, 0));
  });
});

describe("Festschreiben", () => {
  it("schreibt fest, hält Person und Zeitpunkt fest, protokolliert und meldet es", async () => {
    const inv = await make();
    const done = await finalize(inv.id);
    assert.ok(done.finalizedAt);
    assert.equal(done.finalizedByName, "Erika Chef");
    assert.equal(flashKey(), "invoices.flash.finalized");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "invoice.finalize" } });
    assert.deepEqual([entry.target, entry.entityId], ["2026-0001", inv.id]);
  });

  it("braucht das eigene Recht, die aktuelle Version – und gilt nur für Ausgangsrechnungen", async () => {
    const inv = await make();
    await env.signIn(await env.user({ username: "buero", roles: [await env.role({ permissions: ["invoices.view", "invoices.edit", "invoices.delete"] })] }));
    assert.equal(await redirectOf(() => actions.finalizeInvoice(form({ id: inv.id, version: versionOf(inv) }))), "/forbidden");
    assert.equal((await fresh(inv.id)).finalizedAt, null);

    await env.signIn(await env.user({ username: "leitung", roles: [await env.role({ permissions: ALL })] }));
    await actions.finalizeInvoice(form({ id: inv.id, version: "123" }));
    assert.equal(flashKey(), "common.conflict", "veraltete Version");
    assert.equal((await fresh(inv.id)).finalizedAt, null);

    const incoming = await make({ direction: "incoming", number: "E-1", outgoingKey: null });
    await actions.finalizeInvoice(form({ id: incoming.id, version: versionOf(incoming) }));
    assert.equal(flashKey(), "invoices.errors.finalizeIncoming");
    assert.equal((await fresh(incoming.id)).finalizedAt, null);

    const done = await finalize(inv.id);
    await actions.finalizeInvoice(form({ id: inv.id, version: versionOf(done) }));
    assert.equal(flashKey(), "invoices.errors.finalizeAlready");
    assert.equal(await env.db.auditLog.count({ where: { action: "invoice.finalize" } }), 1);
  });

  it("danach: ändern und löschen werden abgelehnt, der Zahlstatus bleibt änderbar (mit Audit)", async () => {
    const inv = await finalize((await make()).id);
    const edit = await actions.saveInvoice({}, form({ id: inv.id, version: versionOf(inv), direction: "outgoing", number: "2026-0001", partyName: "Kunde", issueDate: "2026-03-10", gross: "200,00" }));
    assert.match(edit.error ?? "", /festgeschrieben/);
    assert.equal((await fresh(inv.id)).grossCents, 11900);

    await actions.deleteInvoice(form({ id: inv.id }));
    assert.equal(flashKey(), "invoices.errors.finalizedDelete");
    assert.equal(await env.db.invoice.count(), 1);

    await actions.markInvoicePaid(form({ id: inv.id, paidAt: "2026-04-01" }));
    assert.equal((await fresh(inv.id)).status, "paid");
    await actions.reopenInvoice(form({ id: inv.id }));
    assert.equal((await fresh(inv.id)).status, "open");
    assert.equal(await env.db.auditLog.count({ where: { action: { in: ["invoice.pay", "invoice.reopen"] } } }), 2);
  });

  it("nicht festgeschriebene Ausgangsrechnungen bleiben änderbar und löschbar – mit Audit", async () => {
    const inv = await make();
    await redirectOf(() => actions.saveInvoice({}, form({ id: inv.id, version: versionOf(inv), direction: "outgoing", number: "2026-0001", partyName: "Kunde", issueDate: "2026-03-10", gross: "200,00" })));
    assert.equal((await fresh(inv.id)).grossCents, 20000);
    await redirectOf(() => actions.deleteInvoice(form({ id: inv.id })));
    assert.equal(await env.db.invoice.count(), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: { in: ["invoice.update", "invoice.delete"] } } }), 2);
  });

  it("Eingangsrechnungen bleiben frei änderbar und löschbar (D4)", async () => {
    const inv = await make({ direction: "incoming", number: "E-1", outgoingKey: null });
    await redirectOf(() => actions.saveInvoice({}, form({ id: inv.id, version: versionOf(inv), direction: "incoming", number: "E-1", partyName: "Lieferant", issueDate: "2026-03-10", gross: "50,00" })));
    await redirectOf(() => actions.deleteInvoice(form({ id: inv.id })));
    assert.equal(await env.db.invoice.count(), 0);
  });
});

describe("Storno per Gegenbeleg", () => {
  it("legt eine festgeschriebene Stornorechnung mit umgekehrten Beträgen und Bezug an; das Original gilt als storniert", async () => {
    const original = await finalize((await make({ customerId: null, category: "Reparatur", reference: "A-7" })).id);
    const target = await redirectOf(() => cancel(original.id, { issueDate: "2026-03-20", reason: "Falscher Betrag" }));
    const counter = await env.db.invoice.findFirstOrThrow({ where: { cancelsInvoiceId: original.id } });
    assert.equal(target, `/invoices/${counter.id}`);
    assert.deepEqual([counter.number, counter.outgoingKey, counter.direction, counter.partyName], ["2026-S-1", "2026-S-1", "outgoing", "Kunde"]);
    assert.deepEqual([counter.netCents, counter.vatCents, counter.grossCents], [-10000, -1900, -11900]);
    assert.deepEqual([counter.status, counter.notes, counter.category, counter.reference, counter.dueDate], ["cancelled", "Falscher Betrag", "Reparatur", "A-7", null]);
    assert.ok(counter.finalizedAt, "der Gegenbeleg ist selbst festgeschrieben");
    assert.equal(counter.issueDate.toISOString().slice(0, 10), "2026-03-20");
    const after = await fresh(original.id);
    assert.equal(after.status, "cancelled");
    assert.equal(after.grossCents, 11900, "das Original bleibt inhaltlich unverändert");
    assert.equal(after.number, "2026-0001");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "invoice.cancel" } });
    assert.equal(entry.target, "2026-S-1 → 2026-0001");
    assert.equal(flashKey(), "invoices.flash.cancelled");
  });

  it("nur für festgeschriebene Ausgangsrechnungen, nur einmal, nie für einen Gegenbeleg", async () => {
    const open = await make();
    assert.match((await cancel(open.id)).error ?? "", /nicht festgeschrieben|Nicht festgeschriebene/i);
    const incoming = await make({ direction: "incoming", number: "E-1", outgoingKey: null });
    assert.ok((await cancel(incoming.id)).error);
    assert.equal(await env.db.invoice.count({ where: { cancelsInvoiceId: { not: null } } }), 0);

    const original = await finalize(open.id);
    await redirectOf(() => cancel(original.id));
    assert.match((await cancel(original.id, { number: "2026-S-2" })).error ?? "", /schon storniert/);
    const counter = await env.db.invoice.findFirstOrThrow({ where: { cancelsInvoiceId: original.id } });
    assert.match((await cancel(counter.id, { number: "2026-S-3" })).error ?? "", /nicht noch einmal/);
    assert.equal(await env.db.invoice.count({ where: { cancelsInvoiceId: { not: null } } }), 1);
  });

  it("die Nummer wird nie wiederverwendet: weder die des Originals noch eine andere vergebene (auch in anderer Schreibweise)", async () => {
    const original = await finalize((await make()).id);
    await make({ number: "2026-0002", outgoingKey: "2026-0002" });
    assert.ok((await cancel(original.id, { number: "2026-0001" })).fieldErrors?.number);
    assert.ok((await cancel(original.id, { number: " 2026-0002 " })).fieldErrors?.number);
    assert.equal(await env.db.invoice.count({ where: { cancelsInvoiceId: { not: null } } }), 0);
    assert.equal((await fresh(original.id)).status, "open", "ein gescheiterter Storno ändert nichts");
  });

  it("das Datum liegt nicht vor dem Rechnungsdatum; veraltete Version meldet Konflikt", async () => {
    const original = await finalize((await make()).id);
    assert.ok((await cancel(original.id, { issueDate: "2026-03-09" })).fieldErrors?.issueDate);
    const stale = await actions.cancelInvoice({}, form({ id: original.id, version: "1", number: "X-1" }));
    assert.ok(stale.error);
    assert.equal(await env.db.invoice.count({ where: { cancelsInvoiceId: { not: null } } }), 0);
  });

  it("Original und Gegenbeleg sind nicht löschbar und ihr Zahlstatus ist gesperrt; die offenen Summen enthalten beide nicht", async () => {
    const original = await finalize((await make()).id);
    await redirectOf(() => cancel(original.id));
    const counter = await env.db.invoice.findFirstOrThrow({ where: { cancelsInvoiceId: original.id } });
    for (const id of [original.id, counter.id]) {
      await actions.deleteInvoice(form({ id }));
      assert.equal(flashKey(), "invoices.errors.finalizedDelete");
      await actions.markInvoicePaid(form({ id }));
      assert.equal(flashKey(), "invoices.errors.cancelledLocked");
      await actions.reopenInvoice(form({ id }));
      assert.equal(flashKey(), "invoices.errors.cancelledLocked");
    }
    assert.equal(await env.db.invoice.count(), 2);
    const { invoiceSums } = await import("./queries");
    assert.deepEqual(await invoiceSums({ direction: "outgoing" }), { openCents: 0, openCount: 0, overdueCents: 0, overdueCount: 0, paidCents: 0 });
  });

  it("ein bezahltes Original lässt sich stornieren; der Gegenbeleg braucht invoices.edit (nicht finalize)", async () => {
    const original = await finalize((await make({ status: "paid", paidAt: new Date("2026-03-12T12:00:00Z") })).id);
    await env.signIn(await env.user({ username: "nurbuero", roles: [await env.role({ permissions: ["invoices.view", "invoices.edit"] })] }));
    await redirectOf(() => cancel(original.id));
    assert.equal((await fresh(original.id)).status, "cancelled");
    await env.signIn(await env.user({ username: "lesen", roles: [await env.role({ permissions: ["invoices.view"] })] }));
    assert.equal(await redirectOf(() => cancel(original.id, { number: "X-9" })), "/forbidden");
  });

  it("zwei gleichzeitige Stornos desselben Originals: genau einer gewinnt", async () => {
    const original = await finalize((await make()).id);
    const version = versionOf(await fresh(original.id));
    const results = await Promise.all([
      actions.cancelInvoice({}, form({ id: original.id, version, number: "S-A" })).catch((e) => e),
      actions.cancelInvoice({}, form({ id: original.id, version, number: "S-B" })).catch((e) => e),
    ]);
    void results;
    assert.equal(await env.db.invoice.count({ where: { cancelsInvoiceId: original.id } }), 1);
  });
});

describe("API: finalize und cancel mit If-Match", () => {
  it("finalize/cancel über die API: 428 ohne If-Match, 412 bei veralteter Version, Elemente tragen den Zustand; Löschen 409", async () => {
    const { apiRequest, makeToken } = await import("@/test/api-helpers");
    const { grantablePermissions } = await import("@/lib/api/scope");
    const router = await import("@/server/api/router");
    const { token } = await makeToken(env, { admin: true, scope: grantablePermissions(), rateLimitPerMinute: 6000 });
    const call = async (method: string, path: string, init: { body?: unknown; ifMatch?: string } = {}) => {
      const response = await router.handleApiRequest(apiRequest(method, path, { token, body: init.body, headers: init.ifMatch ? { "if-match": init.ifMatch } : undefined }));
      const text = await response.text();
      return { status: response.status, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const inv = await make();
    assert.equal((await call("POST", `/invoices/${inv.id}/finalize`)).status, 428);
    assert.equal((await call("POST", `/invoices/${inv.id}/finalize`, { ifMatch: '"1"' })).status, 412);
    const done = await call("POST", `/invoices/${inv.id}/finalize`, { ifMatch: `"${versionOf(inv)}"` });
    assert.equal(done.status, 200);
    assert.ok(done.json.data.finalizedAt);
    assert.equal((await call("DELETE", `/invoices/${inv.id}`)).status, 409);
    assert.equal((await call("PATCH", `/invoices/${inv.id}`, { body: { notes: "x" }, ifMatch: `"${done.json.data.version}"` })).status, 409);
    const cancelled = await call("POST", `/invoices/${inv.id}/cancel`, { body: { number: "API-S-1" }, ifMatch: `"${done.json.data.version}"` });
    assert.equal(cancelled.status, 200);
    assert.ok(cancelled.json.data.cancelledByInvoiceId);
    const counter = await call("GET", `/invoices/${cancelled.json.data.cancelledByInvoiceId}`);
    assert.deepEqual([counter.json.data.grossCents, counter.json.data.cancelsInvoiceId, counter.json.data.number], [-11900, inv.id, "API-S-1"]);
  });
});
