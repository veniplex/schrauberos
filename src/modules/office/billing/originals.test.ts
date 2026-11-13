import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { todayInput } from "@/lib/dates";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { inspectPdf } from "@/test/pdf-text";
import type { AppSession } from "@/server/auth/session";

/**
 * Originale festgeschriebener Rechnungen (H2): PDF und XRechnung entstehen beim Festschreiben in derselben Transaktion, liegen als unveränderliche Dateien unter `files/rechnungen/original/`, werden mit
 * Prüfsumme ausgeliefert und von „neu erzeugten Ansichten“ unterschieden; der Storno-Gegenbeleg bekommt sein eigenes Original; ein Fehler beim Ablegen verhindert das Festschreiben.
 */
let env: TestEnv;
let ops: typeof import("./operations");
let invoiceOps: typeof import("@/modules/office/invoices/operations");
let originals: typeof import("./original-files");
let sessionMod: typeof import("@/server/auth/session");
let filesMod: typeof import("@/server/files");
let customerId: string;

const FINALIZE = ["billing.view", "billing.edit", "invoices.view", "invoices.edit", "invoices.finalize", "customers.view", "vehicles.view", "billing.send", "mail.send"];
const PROFILE = { id: "default", name: "Autohaus Müller", street: "Hauptstraße 1", zip: "10115", city: "Berlin", phone: "030 123456", email: "info@mueller.example", taxNumber: "12/345/67890", vatId: "DE123456789", iban: "DE89370400440532013000", bic: "COBADEFFXXX", bankName: "Commerzbank", managingDirector: "Erika Müller", paymentTermDays: 14, smallBusiness: false, invoiceNumberFormat: "{YYYY}-{NNNN}" };

async function sessionFor(permissions: readonly string[]): Promise<AppSession> {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2)}`, roles: [role] });
  await env.signIn(user);
  const session = (await sessionMod.getSession())!;
  return session;
}

const items = () => JSON.stringify([{ description: "Ölwechsel", unit: "Stk", quantityMilli: 1000, unitCents: 10000, taxBp: 1900, discountBp: 0 }]);
const fresh = (id: string) => env.db.invoice.findUniqueOrThrow({ where: { id } });

async function draft(session: AppSession, extra: Record<string, unknown> = {}) {
  const result = await ops.saveDraftOperation.execute(session, { docType: "invoice", customerId, items: items(), serviceFrom: todayInput(), ...extra });
  assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
  return result.data.id;
}
async function finalized(session: AppSession, extra: Record<string, unknown> = {}) {
  const id = await draft(session, extra);
  const result = await ops.finalizeDocumentOperation.execute(session, { id, version: versionOf(await fresh(id)) });
  assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
  return id;
}
const call = async (route: "pdf" | "xml", id: string, query = "") => {
  const mod = route === "pdf" ? await import("@/app/api/billing/[id]/pdf/route") : await import("@/app/api/billing/[id]/xml/route");
  return mod.GET({ nextUrl: new URL(`http://localhost/api/billing/${id}/${route}${query}`) } as never, { params: Promise.resolve({ id }) });
};
const LOGO = "data:image/png;base64," + Buffer.from(pngBytes()).toString("base64");
function pngBytes(): Uint8Array {
  // 8×8 Bildpunkte, ein weißes Bild (selbst erzeugt, kein Fremdbild)
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(8 * (1 + 8 * 3), 0xff);
  for (let y = 0; y < 8; y++) raw[y * 25] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

before(async () => {
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.billing", enabled: true, updatedByName: "test" } });
  sessionMod = await import("@/server/auth/session");
  ops = await import("./operations");
  invoiceOps = await import("@/modules/office/invoices/operations");
  originals = await import("./original-files");
  filesMod = await import("@/server/files");
});
after(() => env.cleanup());

beforeEach(async () => {
  env.signOut();
  await env.db.invoiceOriginal.deleteMany();
  await env.db.mailMessage.deleteMany();
  await env.db.outboxEvent.deleteMany();
  await env.db.invoiceSentFile.deleteMany();
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } });
  await env.db.invoice.deleteMany();
  await env.db.counter.deleteMany();
  await env.db.workshop.upsert({ where: { id: "default" }, update: PROFILE, create: PROFILE });
  await env.db.customer.deleteMany();
  customerId = (await env.db.customer.create({ data: { lastName: "Mustermann", firstName: "Max", street: "Nebenweg 2", zip: "50667", city: "Köln", email: "max@kunde.example", customerNumber: "K-1", nameKey: "mustermann max" } })).id;
});

describe("Original beim Festschreiben", () => {
  it("legt PDF und XRechnung als Dateien ab, in der Datenbank stehen nur Pfad, Größe und Prüfsumme", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session, { buyerReference: "KD-1001" });
    const rows = await env.db.invoiceOriginal.findMany({ where: { invoiceId: id }, orderBy: { kind: "asc" } });
    assert.deepEqual(rows.map((r) => r.kind), ["pdf", "xml"]);
    for (const row of rows) {
      assert.match(row.path, /^rechnungen\/original\/\d{4}\/[A-Za-z0-9._-]+\.(pdf|xml)$/, "lesbarer ASCII-Pfad");
      const bytes = readFileSync(filesMod.resolveRel(row.path));
      assert.equal(bytes.byteLength, row.size);
      assert.equal(sha(bytes), row.sha256);
      assert.equal(row.purgeAfter, null);
    }
    const pdf = readFileSync(filesMod.resolveRel(rows[0].path));
    assert.match(new TextDecoder().decode(pdf.subarray(0, 5)), /^%PDF-/);
    assert.ok(inspectPdf(pdf).pages.join(" ").includes((await fresh(id)).number));
    assert.match(readFileSync(filesMod.resolveRel(rows[1].path), "utf8"), /<Invoice[\s>]|<ubl:Invoice/);
  });

  it("ohne vollständige Pflichtangaben der XRechnung gibt es nur das PDF – das Festschreiben gelingt trotzdem", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    assert.deepEqual((await env.db.invoiceOriginal.findMany({ where: { invoiceId: id } })).map((r) => r.kind), ["pdf"]);
    await sessionFor(["billing.view"]);
    assert.equal((await call("xml", id)).status, 422, "ohne Käuferreferenz gibt es keine XRechnung");
  });

  it("Angebote und Entwürfe bekommen kein Original", async () => {
    const session = await sessionFor([...FINALIZE]);
    await draft(session);
    const offer = await ops.saveDraftOperation.execute(session, { docType: "offer", customerId, items: items(), validUntil: undefined });
    assert.ok(offer.ok);
    assert.equal(await env.db.invoiceOriginal.count(), 0);
  });

  it("das Original bleibt unverändert, auch wenn sich Werkstattprofil ändert – die neu erzeugte Ansicht ist davon verschieden und als solche gekennzeichnet", async () => {
    env.signOut();
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    const before = await call("pdf", id);
    assert.equal(before.status, 200);
    assert.equal(before.headers.get("x-document-version"), "original");
    const originalBytes = new Uint8Array(await before.arrayBuffer());
    // Logo und Layout sind nicht Teil des Schnappschusses: ein neues Logo ändert nur die neu erzeugte Ansicht
    await env.db.workshop.update({ where: { id: "default" }, data: { logoDataUrl: LOGO } });
    const again = await call("pdf", id);
    assert.equal(again.headers.get("x-document-version"), "original");
    assert.deepEqual(new Uint8Array(await again.arrayBuffer()), originalBytes, "dieselben Bytes wie beim Festschreiben");
    const view = await call("pdf", id, "?fresh=1");
    assert.equal(view.headers.get("x-document-version"), "regenerated");
    assert.match(view.headers.get("content-disposition") ?? "", /neu-erzeugt/);
    const regenerated = new Uint8Array(await view.arrayBuffer());
    assert.equal(sha(regenerated) === sha(originalBytes), false, "die neu erzeugte Ansicht ist nicht das Original");
  });

  it("die Auslieferung braucht Sitzung und Recht billing.view; ein veränderter Dateiinhalt wird nie als Original ausgeliefert", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session, { buyerReference: "KD-1" });
    env.signOut();
    assert.equal((await call("pdf", id)).status, 401);
    await sessionFor(["invoices.view"]);
    assert.equal((await call("pdf", id)).status, 403);
    assert.equal((await call("xml", id)).status, 403);
    await sessionFor(["billing.view"]);
    assert.equal((await call("pdf", id)).status, 200);
    const row = await env.db.invoiceOriginal.findUniqueOrThrow({ where: { invoiceId_kind: { invoiceId: id, kind: "pdf" } } });
    const full = filesMod.resolveRel(row.path);
    const good = readFileSync(full);
    writeFileSync(full, Buffer.concat([good, Buffer.from("x")]));
    assert.equal((await call("pdf", id)).status, 500, "beschädigt: keine stille Ersatzfassung");
    assert.equal((await call("pdf", id, "?fresh=1")).status, 200, "die neu erzeugte Ansicht bleibt abrufbar");
    assert.equal((await originals.originalStates(id)).pdf, "damaged");
    writeFileSync(full, good);
    assert.equal((await originals.originalStates(id)).pdf, "ok");
  });

  it("der Versand hängt das Original an (nicht eine neu erzeugte Fassung) und lehnt ein beschädigtes Original ab", async () => {
    const hostPolicy = await import("@/lib/offsite/host-policy");
    const settings = await import("@/server/mail/settings");
    const { startFakeSmtp } = await import("@/test/fake-smtp");
    const fake = await startFakeSmtp();
    hostPolicy.allowLoopbackForTests();
    await settings.saveMailSettings({ ...settings.DEFAULT_MAIL_SETTINGS, enabled: true, host: fake.host, port: fake.port, security: "none", allowPrivate: true, plainConfirmed: true, fromAddress: "werkstatt@example.org", fromName: "Autohaus Müller" }, env.db);
    try {
      const session = await sessionFor(FINALIZE);
      const id = await finalized(session);
      const row = await env.db.invoiceOriginal.findUniqueOrThrow({ where: { invoiceId_kind: { invoiceId: id, kind: "pdf" } } });
      const full = filesMod.resolveRel(row.path);
      const originalBytes = readFileSync(full);
      await env.db.workshop.update({ where: { id: "default" }, data: { name: "Autohaus Neu GmbH" } });
      writeFileSync(full, Buffer.concat([originalBytes, Buffer.from("x")]));
      const refused = await ops.sendDocumentOperation.execute(session, { id });
      assert.equal(refused.ok, false);
      assert.equal((refused as { failure: { key?: string } }).failure.key, "billing.errors.originalDamaged");
      writeFileSync(full, originalBytes);
      const sent = await ops.sendDocumentOperation.execute(session, { id });
      assert.ok(sent.ok, JSON.stringify(!sent.ok && sent.failure));
      const attached = await env.db.invoiceSentFile.findFirstOrThrow({ where: { invoiceId: id } });
      assert.deepEqual(readFileSync(filesMod.resolveRel(attached.path)), originalBytes, "das Original ging hinaus");
      await env.db.invoiceSentFile.deleteMany();
    } finally {
      await fake.close();
    }
  });
});

describe("Original beim Storno", () => {
  it("der gespeicherte Gegenbeleg bekommt ein eigenes Original, das Original der Rechnung bleibt", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session, { buyerReference: "KD-1" });
    const before = await env.db.invoiceOriginal.findMany({ where: { invoiceId: id }, orderBy: { kind: "asc" } });
    const result = await invoiceOps.cancelInvoiceOperation.execute(session, { id, version: versionOf(await fresh(id)), reason: "Fehler" });
    assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
    const counter = await env.db.invoiceOriginal.findMany({ where: { invoiceId: result.data.counterId }, orderBy: { kind: "asc" } });
    assert.deepEqual(counter.map((r) => r.kind), ["pdf", "xml"]);
    assert.equal(counter.some((r) => before.some((b) => b.path === r.path)), false);
    const counterNumber = (await fresh(result.data.counterId)).number;
    assert.ok(inspectPdf(readFileSync(filesMod.resolveRel(counter[0].path))).pages.join(" ").includes(counterNumber));
    assert.deepEqual(await env.db.invoiceOriginal.findMany({ where: { invoiceId: id }, orderBy: { kind: "asc" } }), before, "das Original der stornierten Rechnung bleibt unangetastet");
  });

  it("auch bei ausgeschalteter Rechnungserstellung bekommt der Gegenbeleg sein Original (always-Hook)", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    await env.db.featureSetting.update({ where: { key: "office.billing" }, data: { enabled: false } });
    const off = await sessionFor(FINALIZE);
    const result = await invoiceOps.cancelInvoiceOperation.execute(off, { id, version: versionOf(await fresh(id)) });
    assert.ok(result.ok, JSON.stringify(!result.ok && result.failure));
    assert.equal(await env.db.invoiceOriginal.count({ where: { invoiceId: result.data.counterId } }), 1);
    await env.db.featureSetting.update({ where: { key: "office.billing" }, data: { enabled: true } });
  });
});

describe("Fehler beim Ablegen", () => {
  it("scheitert das Ablegen, wird nichts festgeschrieben: kein Original, keine Nummer, der Entwurf bleibt (Transaktion)", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await draft(session);
    // ein Hindernis: unter files/rechnungen liegt eine *Datei* namens „original“ – der Ordner lässt sich nicht anlegen
    const blocker = filesMod.resolveRel("rechnungen/original");
    rmSync(blocker, { recursive: true, force: true });
    mkdirSync(path.dirname(blocker), { recursive: true });
    writeFileSync(blocker, "kein Ordner");
    try {
      const outcome = await ops.finalizeDocumentOperation.execute(session, { id, version: versionOf(await fresh(id)) }).catch((e: unknown) => e);
      assert.ok(outcome instanceof Error || (outcome as { ok: boolean }).ok === false, "das Festschreiben scheitert");
      const row = await fresh(id);
      assert.equal(row.finalizedAt, null, "bleibt Entwurf");
      assert.equal(row.number, "");
      assert.equal(await env.db.invoiceOriginal.count(), 0);
      assert.equal(await env.db.counter.count(), 0, "der Zähler rollt mit zurück – keine Nummer geht verloren");
    } finally {
      rmSync(blocker, { force: true });
    }
    const ok = await ops.finalizeDocumentOperation.execute(session, { id, version: versionOf(await fresh(id)) });
    assert.ok(ok.ok, "nach dem Beheben gelingt das Festschreiben mit derselben Nummer");
    assert.ok((await fresh(id)).number.endsWith("0001"));
  });
});

describe("Aufbewahrung, Anonymisierung und Aufräumen", () => {
  it("die Anonymisierung gibt das Original frei; der Lauf löst Datei und Zeile", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    const row = await env.db.invoiceOriginal.findFirstOrThrow({ where: { invoiceId: id } });
    const hooks = (await import("./hooks")).hooks.find((h) => h.operation === "customers.anonymize")!;
    await env.db.$transaction(async (tx) => hooks.run({ operation: "customers.anonymize", input: { id: customerId }, result: {}, principal: session, tx }));
    const marked = await env.db.invoiceOriginal.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(marked.purgeAfter);
    assert.ok(existsSync(filesMod.resolveRel(row.path)), "noch da bis zum Lauf");
    assert.equal(await originals.purgeOriginals(new Date(Date.now() + 1000)), 1);
    assert.equal(existsSync(filesMod.resolveRel(row.path)), false);
    assert.equal(await env.db.invoiceOriginal.count({ where: { id: row.id } }), 0);
    assert.equal((await originals.originalStates(id)).pdf, "none");
  });

  it("der Aufräumlauf löst nur verwaiste Dateien (ohne Zeile, älter als eine Stunde) – nie eine Datei mit Zeile", async () => {
    const session = await sessionFor(FINALIZE);
    const id = await finalized(session);
    const kept = await env.db.invoiceOriginal.findFirstOrThrow({ where: { invoiceId: id } });
    const orphan = await filesMod.storeFile("rechnungen/original/2020", "Waise.pdf", new TextEncoder().encode("%PDF-1.4 waise"));
    const young = await filesMod.storeFile("rechnungen/original/2020", "Jung.pdf", new TextEncoder().encode("%PDF-1.4 jung"));
    const old = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(filesMod.resolveRel(orphan), old, old);
    utimesSync(filesMod.resolveRel(kept.path), old, old);
    assert.equal(await originals.purgeOrphanOriginals(), 1);
    assert.equal(existsSync(filesMod.resolveRel(orphan)), false);
    assert.ok(existsSync(filesMod.resolveRel(young)), "zu jung: vielleicht legt eine laufende Transaktion die Zeile noch an");
    assert.ok(existsSync(filesMod.resolveRel(kept.path)), "mit Zeile: nie angefasst");
  });
});
