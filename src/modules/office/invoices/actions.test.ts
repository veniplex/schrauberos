import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Rechnungen im Aktions-Rahmen: Audit, Eindeutigkeit der Ausgangsnummer, Belege, Rückmeldung der Schnellaktionen. */
let env: TestEnv;
let actions: typeof import("./actions");
let decodeFlash: typeof import("@/server/operations/flash").decodeFlash;

before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
  ({ decodeFlash } = await import("@/server/operations/flash"));
});
after(() => env.cleanup());

const lastFlash = () => {
  const write = env.browser.writes.filter((w) => w.name === "so_flash").at(-1);
  return write ? decodeFlash(write.value) : null;
};
const filesIn = (dir: string): string[] => {
  const base = path.join(env.dir, "files", dir);
  return existsSync(base) ? readdirSync(base, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : [];
};

beforeEach(async () => {
  rmSync(path.join(env.dir, "files"), { recursive: true, force: true });
  await env.db.invoice.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.user.deleteMany();
  env.browser.reset();
  const chef = await env.user({ username: "buero", roles: [await env.role({ key: `r-${Math.random()}`, permissions: ["invoices.view", "invoices.edit", "invoices.delete"] })] });
  await env.signIn(chef);
});

const base = { direction: "incoming", number: "RE-1", partyName: "Lieferant GmbH", issueDate: "2026-03-14", gross: "119,00", net: "100,00", vat: "19,00" };
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "beleg.pdf", { type: "application/pdf" });

describe("saveInvoice", () => {
  it("legt eine Rechnung an (Beträge als Text), protokolliert und leitet zur Rechnung", async () => {
    const target = await redirectOf(() => actions.saveInvoice({}, form(base)));
    const inv = await env.db.invoice.findFirstOrThrow();
    assert.equal(target, `/invoices/${inv.id}`);
    assert.equal(inv.grossCents, 11900);
    assert.equal(inv.outgoingKey, null, "Eingangsrechnungen haben keinen Eindeutigkeits-Schlüssel");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "invoice.create" } });
    assert.equal(entry.target, "RE-1");
    assert.equal(entry.entityId, inv.id);
  });

  it("meldet ungültige Beträge, Summenfehler und Fälligkeit vor Rechnungsdatum als Feldfehler", async () => {
    assert.ok((await actions.saveInvoice({}, form({ ...base, gross: "abc" }))).fieldErrors?.gross);
    assert.ok((await actions.saveInvoice({}, form({ ...base, gross: "0" }))).fieldErrors?.gross);
    assert.ok((await actions.saveInvoice({}, form({ ...base, gross: "200,00" }))).fieldErrors?.gross);
    assert.ok((await actions.saveInvoice({}, form({ ...base, dueDate: "2026-03-01" }))).fieldErrors?.dueDate);
    assert.equal(await env.db.invoice.count(), 0);
  });

  it("Ausgangsrechnungsnummern sind eindeutig – unabhängig von Schreibweise und Empfänger", async () => {
    const out = { ...base, direction: "outgoing", number: "2026-0001" };
    await redirectOf(() => actions.saveInvoice({}, form(out)));
    assert.equal((await env.db.invoice.findFirstOrThrow()).outgoingKey, "2026-0001");
    const again = await actions.saveInvoice({}, form({ ...out, number: " 2026-0001 ", partyName: "Anderer Kunde" }));
    assert.ok(again.fieldErrors?.number);
    const letters = await redirectOf(() => actions.saveInvoice({}, form({ ...out, number: "re-7", partyName: "A" })));
    assert.ok(letters);
    assert.ok((await actions.saveInvoice({}, form({ ...out, number: "RE-7", partyName: "B" }))).fieldErrors?.number);
    // Eingangsrechnungen dürfen dieselbe Nummer bei anderen Lieferanten haben
    await redirectOf(() => actions.saveInvoice({}, form({ ...base, number: "X-1", partyName: "A" })));
    await redirectOf(() => actions.saveInvoice({}, form({ ...base, number: "X-1", partyName: "B" })));
    assert.equal(await env.db.invoice.count(), 4);
  });

  it("die Datenbank hält die Eindeutigkeit auch ohne Code-Prüfung (Unique-Schlüssel)", async () => {
    await env.db.invoice.create({ data: { direction: "outgoing", number: "1", outgoingKey: "1", partyName: "A", issueDate: new Date(), grossCents: 100 } });
    await assert.rejects(() => env.db.invoice.create({ data: { direction: "outgoing", number: "1 ", outgoingKey: "1", partyName: "B", issueDate: new Date(), grossCents: 100 } }));
  });

  it("ändern: eigene Nummer bleibt erlaubt, die Richtung wechselt den Schlüssel, veraltete Version meldet Konflikt", async () => {
    await redirectOf(() => actions.saveInvoice({}, form({ ...base, direction: "outgoing", number: "A-1" })));
    const inv = await env.db.invoice.findFirstOrThrow();
    const { versionOf } = await import("@/lib/concurrency");
    const edit = (extra: Record<string, string>) => actions.saveInvoice({}, form({ ...base, id: inv.id, version: versionOf(inv), direction: "outgoing", number: "A-1", ...extra }));
    assert.ok(await redirectOf(() => edit({ notes: "geändert" })));
    const second = await edit({ notes: "zweiter Versuch mit alter Version" });
    assert.ok(second.error, "alte Version -> Konflikt");
    assert.equal((await env.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).notes, "geändert");
    const fresh = await env.db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    await redirectOf(() => actions.saveInvoice({}, form({ ...base, id: inv.id, version: versionOf(fresh), direction: "incoming", number: "A-1" })));
    assert.equal((await env.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).outgoingKey, null);
    assert.equal(await env.db.auditLog.count({ where: { action: "invoice.update" } }), 2);
  });

  it("speichert den Beleg als Datei und räumt ihn weg, wenn nichts gespeichert wird", async () => {
    await redirectOf(() => actions.saveInvoice({}, form({ ...base, file: pdf() })));
    assert.equal((await env.db.invoiceFile.count()), 1);
    assert.equal(filesIn("rechnungen").length, 1);
    // zweite Rechnung mit derselben Nummer beim selben Partner scheitert -> die vorab abgelegte Datei darf nicht liegen bleiben
    const failed = await actions.saveInvoice({}, form({ ...base, file: pdf() }));
    assert.ok(failed.fieldErrors?.number);
    assert.equal(filesIn("rechnungen").length, 1);
    assert.equal(await env.db.invoice.count(), 1);
  });

  it("lehnt falsche Dateitypen ab, ohne etwas zu speichern", async () => {
    const state = await actions.saveInvoice({}, form({ ...base, file: new File(["<html>"], "x.html", { type: "text/html" }) }));
    assert.ok(state.fieldErrors?.file);
    assert.equal(await env.db.invoice.count(), 0);
  });

  it("ohne Recht invoices.edit wird nichts gespeichert", async () => {
    const view = await env.user({ username: "nur-lesen", roles: [await env.role({ permissions: ["invoices.view"] })] });
    await env.signIn(view);
    assert.equal(await redirectOf(() => actions.saveInvoice({}, form(base))), "/forbidden");
    assert.equal(await env.db.invoice.count(), 0);
  });
});

describe("Schnellaktionen und Löschen (ohne Formularzustand)", () => {
  const make = (extra: Record<string, unknown> = {}) => env.db.invoice.create({ data: { direction: "incoming", number: "Q-1", partyName: "P", issueDate: new Date(), grossCents: 500, ...extra } });

  it("bezahlt markieren und wieder öffnen: Änderung, Audit und Rückmeldung", async () => {
    const inv = await make();
    assert.equal(await redirectOf(() => actions.markInvoicePaid(form({ id: inv.id, paidAt: "2026-04-01" }))), null);
    const paid = await env.db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(paid.status, "paid");
    assert.equal(paid.paidAt?.toISOString().slice(0, 10), "2026-04-01");
    assert.equal(lastFlash()?.key, "invoices.flash.paid");
    assert.equal(await env.db.auditLog.count({ where: { action: "invoice.pay", entityId: inv.id } }), 1);

    await actions.reopenInvoice(form({ id: inv.id }));
    const open = await env.db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.deepEqual([open.status, open.paidAt], ["open", null]);
    assert.equal(lastFlash()?.key, "invoices.flash.reopened");
    assert.equal(await env.db.auditLog.count({ where: { action: "invoice.reopen" } }), 1);
  });

  it("meldet eine unbekannte Rechnung statt still zu scheitern", async () => {
    await actions.markInvoicePaid(form({ id: "gibt-es-nicht" }));
    assert.equal(lastFlash()?.tone, "error");
    assert.equal(lastFlash()?.key, "common.errors.notFound");
    assert.equal(await env.db.auditLog.count(), 0);
  });

  it("löscht Rechnung samt Beleg, protokolliert und leitet zur Liste ihrer Richtung", async () => {
    await redirectOf(() => actions.saveInvoice({}, form({ ...base, file: pdf() })));
    const inv = await env.db.invoice.findFirstOrThrow();
    assert.equal(await redirectOf(() => actions.deleteInvoice(form({ id: inv.id }))), "/invoices?dir=incoming");
    assert.equal(await env.db.invoice.count(), 0);
    assert.equal(filesIn("rechnungen").length, 0);
    assert.equal((await env.db.auditLog.findFirstOrThrow({ where: { action: "invoice.delete" } })).target, "RE-1");
    assert.equal(lastFlash()?.key, "common.deleted");
  });
});
