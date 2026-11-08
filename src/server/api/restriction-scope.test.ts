import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resetWorkshopZone, setWorkshopZone } from "@/lib/zone";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Art. 18 DSGVO an der Schnittstelle, **eine** Auslegung: Eine Sache gilt als eingeschränkt, wenn ihr Kunde **oder der Halter ihres Fahrzeugs** eingeschränkt verarbeitet wird
 * (`unrestrictedByCustomer` & Co. in `customers/public.ts`). Geprüft werden alle Ressourcen, die an Kunde/Fahrzeug hängen, jeweils mit dem Fall „Auftrag/Beleg ohne Kunden oder mit unbeschränktem
 * Kunden an einem Fahrzeug des eingeschränkten Kunden“ – und die Webhook-Prüfung (`isRestrictedEntity`) für **jede** Ressource des Ereigniskatalogs.
 */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let token: string;
const ids: Record<string, string> = {};

const call = async (method: string, path: string) => {
  const r = await router.handleApiRequest(apiRequest(method, path, { token }));
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as { data?: unknown } };
};
const listIds = async (path: string): Promise<string[]> => ((await call("GET", path)).json.data as Array<{ id: string }>).map((row) => row.id);

before(async () => {
  // Termine werden um 09:15 „Ortszeit der Werkstatt“ gebucht (Doppelbelegung gegen 08:00 UTC): Zone ausdrücklich Europe/Berlin, nicht die des Prozesses (CI läuft in UTC)
  setWorkshopZone("Europe/Berlin");
  env = await createTestEnv();
  const { FEATURES } = await import("@/modules/catalog");
  for (const f of FEATURES) await env.db.featureSetting.upsert({ where: { key: `${f.module}.${f.id}` }, update: { enabled: true }, create: { key: `${f.module}.${f.id}`, enabled: true, updatedByName: "Test" } });
  router = await import("@/server/api/router");
  token = (await makeToken(env, { admin: true, scope: ALL_PERMISSIONS.filter((p) => !/\.(export|import)$/.test(p)) as string[] })).token;
  const C = await env.db.customer.create({ data: { lastName: "Eingeschränkt", processingRestrictedAt: new Date() } });
  const N = await env.db.customer.create({ data: { lastName: "Normal" } });
  const V = await env.db.vehicle.create({ data: { plate: "B-RS 1", plateNorm: "BRS1", customerId: C.id } });
  const VN = await env.db.vehicle.create({ data: { plate: "B-NO 1", plateNorm: "BNO1", customerId: N.id } });
  Object.assign(ids, { C: C.id, N: N.id, V: V.id, VN: VN.id });
  const order = (key: string, number: string, vehicleId: string, customerId: string | null) => env.db.order.create({ data: { number, status: "accepted", vehicleId, customerId } }).then((o) => void (ids[key] = o.id));
  // OA: ohne Kunden am Fahrzeug von C; OB: unbeschränkter Kunde am Fahrzeug von C; OC: Kunde C am unbeschränkten Fahrzeug; OK: Kontrolle
  await order("OA", "A-2026-9101", V.id, null);
  await order("OB", "A-2026-9102", V.id, N.id);
  await order("OC", "A-2026-9103", VN.id, C.id);
  await order("OK", "A-2026-9104", VN.id, N.id);
  for (const key of ["OA", "OB", "OK"]) {
    await env.db.orderItem.create({ data: { orderId: ids[key], position: 1, kind: "labor", description: `Position ${key}`, quantityMilli: 1000, unitCents: 1000, taxBp: 1900 } });
    await env.db.orderApproval.create({ data: { orderId: ids[key], reason: "Mehraufwand", amountCents: 500, method: "phone", approverName: "Kunde", recordedByName: "Test" } as never });
  }
  const doc = (key: string, number: string, customerId: string | null, vehicleId: string | null) =>
    env.db.invoice.create({ data: { source: "billing", direction: "outgoing", docType: "invoice", number, partyName: "X", customerId, vehicleId, issueDate: new Date(), grossCents: 1000 } as never }).then((d) => void (ids[key] = d.id));
  await doc("DA", "BR-9101", null, V.id);
  await doc("DB", "BR-9102", N.id, V.id);
  await doc("DC", "BR-9103", C.id, null);
  await doc("DK", "BR-9104", N.id, VN.id);
  for (const key of ["DB", "DK"]) await env.db.invoicePayment.create({ data: { invoiceId: ids[key], paidAt: new Date(), amountCents: 100, method: "cash", recordedByName: "Test" } });
  // Datei und Checkliste
  const file = (key: string, owner: { vehicleId?: string; orderId?: string }) =>
    env.db.fileAttachment.create({ data: { ...owner, name: `${key}.jpg`, mime: "image/jpeg", size: 1, path: `test/${key}.jpg`, sha256: key, uploadedById: "x", uploadedByName: "Test" } }).then((f) => void (ids[key] = f.id));
  await file("FV", { vehicleId: V.id });
  await file("FO", { orderId: ids.OB });
  await file("FK", { vehicleId: VN.id });
  const { installDefaultTemplates } = await import("@/modules/workshop/checklists/install");
  await installDefaultTemplates(env.db, "System");
  const template = await env.db.checklistTemplate.findFirstOrThrow({ select: { id: true, versions: { take: 1, orderBy: { version: "desc" }, select: { id: true, version: true, name: true } } } });
  const checklist = (key: string, vehicleId: string, orderId: string | null) =>
    env.db.checklist.create({ data: { templateId: template.id, versionId: template.versions[0].id, templateName: template.versions[0].name, templateVersion: template.versions[0].version, vehicleId, orderId, createdByName: "Test" } }).then((c) => void (ids[key] = c.id));
  await checklist("KV", V.id, null);
  await checklist("KO", V.id, ids.OB);
  await checklist("KK", VN.id, ids.OK);
  // Lagerbuchungen: eine ohne Auftrag, eine zu OA (eingeschränkt), eine zu OK
  const article = await env.db.article.create({ data: { number: "ART-1", name: "Teil", searchKey: "art-1 teil" } as never });
  const move = (key: string, orderId: string | null, note: string) =>
    env.db.stockMovement.create({ data: { articleId: article.id, kind: "order", quantityMilli: -1000, stockAfterMilli: 0, orderId, orderNumber: orderId ? `Nr-${key}` : null, note, byName: "Test" } }).then((m) => void (ids[key] = m.id));
  await move("MX", null, "ohne Auftrag");
  await move("MA", ids.OA, "geheime Notiz zum Auftrag");
  await move("MK", ids.OK, "Kontrolle");
});
after(async () => {
  resetWorkshopZone();
  await env.cleanup();
});

describe("Aufträge: Kunde und Fahrzeughalter zählen", () => {
  it("Aufträge am Fahrzeug von C (ohne Kunden oder mit unbeschränktem Kunden) und Aufträge von C: nicht in der Liste, einzeln 404; die Kontrolle bleibt", async () => {
    const list = await listIds("/orders?limit=100");
    for (const key of ["OA", "OB", "OC"]) {
      assert.ok(!list.includes(ids[key]), `${key} nicht in der Liste`);
      assert.equal((await call("GET", `/orders/${ids[key]}`)).status, 404, `${key} einzeln`);
    }
    assert.ok(list.includes(ids.OK));
    assert.equal((await call("GET", `/orders/${ids.OK}`)).status, 200);
  });

  it("Positionen und Freigaben der eingeschränkten Aufträge: nicht lesbar (Liste und Einzeln), die der Kontrolle schon", async () => {
    const items = await call("GET", "/order-items?limit=100");
    const texts = (items.json.data as Array<{ description: string }>).map((i) => i.description);
    assert.deepEqual(texts.sort(), ["Position OK"], "nur die Position des Kontrollauftrags");
    const approvals = (await call("GET", "/order-approvals?limit=100")).json.data as Array<{ orderId: string }>;
    assert.deepEqual([...new Set(approvals.map((a) => a.orderId))], [ids.OK]);
    const itemOfOb = await env.db.orderItem.findFirstOrThrow({ where: { orderId: ids.OB } });
    assert.equal((await call("GET", `/order-items/${itemOfOb.id}`)).status, 404);
  });
});

describe("Belege: Kunde und Fahrzeughalter zählen", () => {
  it("Belege ohne Kunden am Fahrzeug von C, mit unbeschränktem Kunden am Fahrzeug von C und Belege von C: 404; Kontrollbeleg sichtbar", async () => {
    const list = await listIds("/billing-documents?limit=100");
    for (const key of ["DA", "DB", "DC"]) {
      assert.ok(!list.includes(ids[key]), `${key} nicht in der Liste`);
      assert.equal((await call("GET", `/billing-documents/${ids[key]}`)).status, 404, `${key} einzeln`);
    }
    assert.ok(list.includes(ids.DK));
    assert.equal((await call("GET", `/billing-documents/${ids.DK}`)).status, 200);
  });

  it("Zahlungen zu Belegen eingeschränkter Kunden/Fahrzeughalter sind nicht lesbar", async () => {
    const payments = (await call("GET", "/billing-payments?limit=100")).json.data as Array<{ documentId?: string; invoiceId?: string }>;
    const docs = payments.map((p) => p.documentId ?? p.invoiceId);
    assert.deepEqual([...new Set(docs)], [ids.DK]);
  });

  it("Rechnungsentwurf aus Auftrag am Fahrzeug von C: 404, nichts entsteht", async () => {
    const before = await env.db.invoice.count();
    const r = await router.handleApiRequest(apiRequest("POST", "/billing-documents/from-order", { token, body: { orderId: ids.OB }, headers: { "idempotency-key": "k-from-order-1" } }));
    assert.equal(r.status, 404);
    assert.equal(await env.db.invoice.count(), before);
  });
});

describe("Lagerbuchungen zu Aufträgen eingeschränkter Kunden", () => {
  it("Buchungen mit dem Auftrag von C/Fahrzeug von C (Nummer, Notiz) sind nicht lesbar; die ohne Auftrag und die der Kontrolle schon", async () => {
    const list = (await call("GET", "/stock-movements?limit=100")).json.data as Array<{ id: string; note: string | null }>;
    assert.deepEqual(list.map((m) => m.id).sort(), [ids.MX, ids.MK].sort());
    assert.ok(!JSON.stringify(list).includes("geheime Notiz"));
    assert.equal((await call("GET", `/stock-movements/${ids.MA}`)).status, 404);
    assert.equal((await call("GET", `/stock-movements/${ids.MK}`)).status, 200);
    assert.deepEqual((await call("GET", `/stock-movements?orderId=${ids.OA}`)).json.data, []);
  });
});

describe("Webhooks: Art.-18-Prüfung jeder Ressource des Ereigniskatalogs (fail-closed)", () => {
  it("jede Ressource des Katalogs hat eine Prüfung der Funktion – und dieser Test deckt jede ab", async () => {
    const { WEBHOOK_EVENTS } = await import("@/modules/catalog");
    const { featureWebhookRestrictions } = await import("@/modules/webhooks");
    const resources = [...new Set(WEBHOOK_EVENTS.map((e) => e.resource))].sort();
    assert.deepEqual(featureWebhookRestrictions.map((d) => d.resource).sort(), resources, "jede Ressource genau eine Prüfung der Funktion");
    assert.deepEqual(Object.keys(CASES).sort(), resources, "der Fälle-Katalog dieses Tests kennt jede Ressource (neues Ereignis: Fälle ergänzen)");
  });

  const CASES: Record<string, { restricted: string[]; free: string[] }> = {
    orders: { restricted: ["OA", "OB", "OC"], free: ["OK"] },
    "billing-documents": { restricted: ["DA", "DB", "DC"], free: ["DK"] },
    checklists: { restricted: ["KV", "KO"], free: ["KK"] },
    files: { restricted: ["FV", "FO"], free: ["FK"] },
  };

  for (const [resource, cases] of Object.entries(CASES)) {
    it(`${resource}: eingeschränkt (Kunde oder Fahrzeughalter) = true, sonst false`, async () => {
      const { isRestrictedEntity } = await import("@/modules/admin/api/restriction");
      for (const key of cases.restricted) assert.equal(await isRestrictedEntity(resource, ids[key]), true, `${key} eingeschränkt`);
      for (const key of cases.free) assert.equal(await isRestrictedEntity(resource, ids[key]), false, `${key} frei`);
    });
  }

  it("unbekannte Ressource: eingeschränkt (das Ereignis geht nie hinaus)", async () => {
    const { isRestrictedEntity } = await import("@/modules/admin/api/restriction");
    assert.equal(await isRestrictedEntity("appointments", ids.OK), true);
    assert.equal(await isRestrictedEntity("", ids.OK), true);
  });

  it("Fan-out: Ereignisse zu Aufträgen/Belegen am Fahrzeug von C werden nicht zugestellt, die der Kontrolle schon", async () => {
    const { fanOutEvent } = await import("@/server/webhooks/deliver");
    const { isRestrictedEntity } = await import("@/modules/admin/api/restriction");
    await env.db.webhook.create({ data: { name: "Z", url: "https://hook.example.invalid/x", events: "order.closed,billing.paid", enabled: true } });
    const when = new Date();
    const send = (id: string, type: string, entityId: string) => fanOutEvent({ id, type, entityId, createdAt: when }, { isRestricted: isRestrictedEntity });
    assert.equal(await send("e-oa", "order.closed", ids.OA), 0);
    assert.equal(await send("e-ob", "order.closed", ids.OB), 0);
    assert.equal(await send("e-da", "billing.paid", ids.DA), 0);
    assert.equal(await send("e-ok", "order.closed", ids.OK), 1);
    assert.equal(await send("e-dk", "billing.paid", ids.DK), 1);
  });
});

describe("Randoperationen: keine Namen und keine Wirkung auf Eingeschränktes (Dubletten, Doppelbelegung)", () => {
  /** Token ohne jedes `*.view`-Recht: nur Schreibrechte */
  let blind: string;
  const blindCall = async (method: string, path: string, body?: unknown) => {
    const r = await router.handleApiRequest(apiRequest(method, path, { token: blind, body, headers: { "idempotency-key": Math.random().toString(36).slice(2) } }));
    const text = await r.text();
    return { status: r.status, text, json: (text ? JSON.parse(text) : {}) as { fields?: Record<string, { code: string; params?: Record<string, unknown> }> } };
  };
  before(async () => {
    blind = (await makeToken(env, { admin: true, scope: ["vehicles.edit", "customers.edit", "appointments.create"] })).token;
  });

  it("Fahrzeug: Kennzeichen eines Fahrzeugs von C: nur „vorhanden“ (ohne Halter, Kennung); archiveDuplicate archiviert es nie", async () => {
    const plain = await blindCall("POST", "/vehicles", { plate: "B-RS 1" });
    assert.equal(plain.status, 422);
    assert.equal(plain.json.fields?.plate?.code, "vehicles.errors.plateExistsHidden");
    assert.ok(!plain.text.includes("Eingeschränkt") && !plain.text.includes(ids.V), "weder Name noch Kennung");
    const archive = await blindCall("POST", "/vehicles", { plate: "B-RS 1", archiveDuplicate: true });
    assert.equal(archive.status, 422);
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: ids.V } })).archivedAt, null, "das Fahrzeug von C bleibt unberührt");
    assert.equal(await env.db.vehicle.count({ where: { plateNorm: "BRS1" } }), 1, "und es entsteht keine Dublette");
  });

  it("Fahrzeug: auch das Fahrzeug eines unbeschränkten Kunden nennt ohne `vehicles.view` keine Kennung und ohne `customers.view` keinen Halter; archiveDuplicate ohne `vehicles.view` archiviert nicht", async () => {
    const plain = await blindCall("POST", "/vehicles", { plate: "B-NO 1" });
    assert.equal(plain.status, 422);
    assert.equal(plain.json.fields?.plate?.code, "vehicles.errors.plateExistsHidden");
    assert.ok(!plain.text.includes("Normal") && !plain.text.includes(ids.VN));
    assert.equal((await blindCall("POST", "/vehicles", { plate: "B-NO 1", archiveDuplicate: true })).status, 422);
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: ids.VN } })).archivedAt, null);
  });

  it("Fahrzeug: mit `vehicles.view` und `customers.view` bleibt die Warnung für unbeschränkte Fahrzeuge ausführlich, und archiveDuplicate archiviert nur dieses (nicht das von C)", async () => {
    const full = (await makeToken(env, { admin: true, scope: ["vehicles.edit", "vehicles.view", "customers.view", "customers.edit"] })).token;
    const send = async (body: unknown) => {
      const r = await router.handleApiRequest(apiRequest("POST", "/vehicles", { token: full, body, headers: { "idempotency-key": Math.random().toString(36).slice(2) } }));
      return { status: r.status, json: (await r.json()) as { fields?: Record<string, { code: string; params?: { customer?: string } }> } };
    };
    const warn = await send({ plate: "B-NO 1" });
    assert.equal(warn.status, 422);
    assert.equal(warn.json.fields?.plate?.code, "vehicles.errors.plateExists");
    assert.match(String(warn.json.fields?.plate?.params?.customer), /Normal/);
    // Fahrzeug von C ist auch für diesen Token verborgen
    const hiddenOwner = await send({ plate: "B-RS 1", archiveDuplicate: true });
    assert.equal(hiddenOwner.status, 422);
    assert.equal(hiddenOwner.json.fields?.plate?.code, "vehicles.errors.plateExistsHidden");
    const archived = await send({ plate: "B-NO 1", archiveDuplicate: true });
    assert.equal(archived.status, 201);
    assert.notEqual((await env.db.vehicle.findUniqueOrThrow({ where: { id: ids.VN } })).archivedAt, null);
  });

  it("Kunde: eine vergebene Kundennummer nennt weder Namen noch Kennung (auch nicht von unbeschränkten Kunden ohne `customers.view`); gleiche Antwort für eingeschränkt und normal", async () => {
    await env.db.customer.update({ where: { id: ids.C }, data: { customerNumber: "K-9001" } });
    await env.db.customer.update({ where: { id: ids.N }, data: { customerNumber: "K-9002" } });
    const restricted = await blindCall("POST", "/customers", { lastName: "Neu", customerNumber: "k-9001" });
    const normal = await blindCall("POST", "/customers", { lastName: "Neu", customerNumber: "k-9002" });
    assert.equal(restricted.status, 422);
    assert.deepEqual(restricted.json, normal.json, "kein Unterschied zwischen eingeschränktem und normalem Kunden");
    assert.equal(restricted.json.fields?.customerNumber?.code, "customers.errors.numberExistsHidden");
    assert.ok(!restricted.text.includes("Eingeschränkt") && !normal.text.includes("Normal") && !normal.text.includes(ids.N));
  });

  it("Termin: Doppelbelegung eines Arbeitsplatzes nennt ohne `appointments.view` nur den Zeitraum; mit Recht das Kennzeichen – nie das eines eingeschränkten Kunden", async () => {
    const bay = await env.db.bay.create({ data: { name: "Platz 9" } as never });
    const when = new Date("2031-03-03T08:00:00Z");
    await env.db.appointment.create({ data: { title: "Normaltermin", startsAt: when, endsAt: new Date(when.getTime() + 3_600_000), bayId: bay.id, vehicleId: ids.VN, customerId: ids.N } });
    const when2 = new Date("2031-03-04T08:00:00Z");
    await env.db.appointment.create({ data: { title: "Termin C", startsAt: when2, endsAt: new Date(when2.getTime() + 3_600_000), bayId: bay.id, vehicleId: ids.V, customerId: ids.C } });
    const book = (token: string, date: string) =>
      router.handleApiRequest(apiRequest("POST", "/appointments", { token, body: { title: "Neu", date, time: "09:15", durationMinutes: 30, bayId: bay.id }, headers: { "idempotency-key": Math.random().toString(36).slice(2) } })).then(async (r) => ({ status: r.status, text: await r.text() }));
    const noView = await book(blind, "2031-03-03");
    assert.equal(noView.status, 422);
    assert.match(noView.text, /bayBusyUnnamed/);
    assert.ok(!noView.text.includes("B-NO 1") && !noView.text.includes("Normaltermin"));
    const withView = await book(token, "2031-03-03");
    assert.match(withView.text, /bayBusy"/);
    assert.ok(withView.text.includes("B-NO 1"), "mit Recht: Kennzeichen des unbeschränkten Kunden");
    const restrictedClash = await book(token, "2031-03-04");
    assert.equal(restrictedClash.status, 422);
    assert.match(restrictedClash.text, /bayBusyUnnamed/);
    assert.ok(!restrictedClash.text.includes("B-RS 1"), "nie das Kennzeichen eines eingeschränkten Kunden");
  });
});
