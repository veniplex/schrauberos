import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { jpeg } from "@/test/images";

/**
 * Art. 18 DSGVO an der Schnittstelle: Ressourcen, die ein Elternobjekt aus dem Körper verknüpfen (Kunde, Fahrzeug, Auftrag), lehnen eines ab, dessen Kunde eingeschränkt ist (404/422, nichts entsteht);
 * eingeschränkte Kunden samt ihren Fahrzeugen, Terminen, Reifensätzen und Aufträgen sind für die API nicht lesbar. Bestehende Verknüpfungen bleiben bearbeitbar (Oberfläche). Webhooks melden nichts
 * zu solchen Sachen. Die Kontrollaufrufe mit unbeschränktem Kunden zeigen, dass die Körper sonst gültig sind.
 */
let env: TestEnv;
let router: typeof import("@/server/api/router");
let token: string;
let C: { id: string }; // eingeschränkter Kunde
let N: { id: string };
let V: { id: string }; // Fahrzeug von C
let VN: { id: string };
let O: { id: string }; // Auftrag von C
let TS: { id: string };
let AP: { id: string; updatedAt: Date };

type Body = { data?: unknown; fields?: Record<string, unknown> };
const call = async (method: string, path: string, body?: unknown) => {
  const r = await router.handleApiRequest(apiRequest(method, path, { token, body, headers: { "idempotency-key": Math.random().toString(36).slice(2) } }));
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Body };
};
const upload = async (ownerType: string, ownerId: string) => {
  const form = new FormData();
  form.set("ownerType", ownerType);
  form.set("ownerId", ownerId);
  form.set("file", new File([new Uint8Array(jpeg())], "f.jpg", { type: "image/jpeg" }));
  const r = await router.handleApiRequest(new Request("http://localhost/api/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": Math.random().toString(36).slice(2) }, body: form }));
  return r.status;
};

before(async () => {
  env = await createTestEnv();
  const { FEATURES } = await import("@/modules/catalog");
  for (const f of FEATURES) await env.db.featureSetting.upsert({ where: { key: `${f.module}.${f.id}` }, update: { enabled: true }, create: { key: `${f.module}.${f.id}`, enabled: true, updatedByName: "Test" } });
  router = await import("@/server/api/router");
  const made = await makeToken(env, { admin: true, scope: ALL_PERMISSIONS.filter((p) => !/\.(export|import)$/.test(p)) as string[] });
  token = made.token;
  // die Zeiterfassung braucht einen Mitarbeiter am Konto des Besitzers
  await env.db.employee.create({ data: { firstName: "Tom", lastName: "Zeit", userId: made.userId } });
  C = await env.db.customer.create({ data: { lastName: "Eingeschränkt", firstName: "Erika", processingRestrictedAt: new Date() } });
  N = await env.db.customer.create({ data: { lastName: "Normal", firstName: "Nora" } });
  V = await env.db.vehicle.create({ data: { plate: "B-RS 1", plateNorm: "BRS1", customerId: C.id } });
  VN = await env.db.vehicle.create({ data: { plate: "B-NO 1", plateNorm: "BNO1", customerId: N.id } });
  O = await env.db.order.create({ data: { number: "A-2026-9001", status: "accepted", vehicleId: V.id, customerId: C.id } });
  TS = await env.db.tireSet.create({ data: { vehicleId: V.id, season: "summer" } });
  AP = await env.db.appointment.create({ data: { title: "Alt", startsAt: new Date("2030-05-06T08:00:00Z"), endsAt: new Date("2030-05-06T08:30:00Z"), vehicleId: V.id, customerId: C.id } });
});
after(() => env.cleanup());
beforeEach(() => void 0);

const appt = { title: "T", date: "2030-05-07", time: "10:00", durationMinutes: 30 };

describe("Neue Verknüpfungen mit eingeschränkten Kunden", () => {
  it("Fahrzeug: Halter C (anlegen) und Halterwechsel auf C werden abgelehnt, ein unbeschränkter Kunde geht", async () => {
    assert.equal((await call("POST", "/vehicles", { plate: "B-AA 11", customerId: C.id })).status, 422);
    assert.equal((await call("POST", "/vehicles", { plate: "B-AA 12", customerId: N.id })).status, 201);
    const patch = await router.handleApiRequest(apiRequest("PATCH", `/vehicles/${VN.id}`, { token, body: { customerId: C.id }, headers: { "if-match": `"${(await env.db.vehicle.findUniqueOrThrow({ where: { id: VN.id } })).updatedAt.getTime()}"` } }));
    assert.ok([404, 422].includes(patch.status), `PATCH ${patch.status}`);
    assert.equal((await env.db.vehicle.findUniqueOrThrow({ where: { id: VN.id } })).customerId, N.id);
  });

  it("Termin: Kunde C und Fahrzeug von C werden abgelehnt (422, nichts entsteht), Fahrzeug eines unbeschränkten Kunden geht", async () => {
    const before = await env.db.appointment.count();
    const byCustomer = await call("POST", "/appointments", { ...appt, customerId: C.id });
    assert.equal(byCustomer.status, 422);
    const byVehicle = await call("POST", "/appointments", { ...appt, vehicleId: V.id });
    assert.equal(byVehicle.status, 422);
    assert.ok(byVehicle.json.fields?.vehicleId, "Feld vehicleId");
    assert.equal(await env.db.appointment.count(), before);
    assert.equal((await call("POST", "/appointments", { ...appt, vehicleId: VN.id })).status, 201);
  });

  it("Reifensatz: Fahrzeug von C wird abgelehnt (422), ein unbeschränktes geht; ein bestehender Satz bleibt über die Operation bearbeitbar", async () => {
    const before = await env.db.tireSet.count();
    const denied = await call("POST", "/tire-sets", { vehicleId: V.id, season: "winter" });
    assert.equal(denied.status, 422);
    assert.ok(denied.json.fields?.vehicleId);
    assert.equal(await env.db.tireSet.count(), before);
    assert.equal((await call("POST", "/tire-sets", { vehicleId: VN.id, season: "winter" })).status, 201);
  });

  it("Auftrag (Fahrzeug von C: 422), Rechnung (Kunde C: 422), Zeiterfassung am Auftrag von C (nicht erreichbar), Dateien an Fahrzeug/Auftrag von C (404)", async () => {
    assert.equal((await call("POST", "/orders", { vehicleId: V.id })).status, 422);
    const control = await call("POST", "/orders", { vehicleId: VN.id });
    assert.equal(control.status, 201, JSON.stringify(control.json));
    const invoice = { direction: "outgoing", number: "R-1", partyName: "X", issueDate: "2030-01-02", grossCents: 100 };
    assert.equal((await call("POST", "/invoices", { ...invoice, customerId: C.id })).status, 422);
    const invoiceControl = await call("POST", "/invoices", { ...invoice, number: "R-2", customerId: N.id });
    assert.equal(invoiceControl.status, 201, JSON.stringify(invoiceControl.json));
    assert.ok([404, 422].includes((await call("POST", "/time-entries/start", { orderId: O.id })).status));
    const timeControl = await call("POST", "/time-entries/start", { orderId: (control.json.data as { id: string }).id });
    assert.equal(timeControl.status, 201, JSON.stringify(timeControl.json));
    assert.equal(await upload("vehicle", V.id), 404);
    assert.equal(await upload("order", O.id), 404);
    assert.equal(await upload("vehicle", VN.id), 201);
  });

  it("die Oberfläche (Operation) behält bestehende Verknüpfungen: ein Termin mit dem Fahrzeug von C bleibt änderbar, ein anderes Fahrzeug von C nicht", async () => {
    const { updateAppointmentOperation } = await import("@/modules/workshop/appointments/operations");
    const { getSession } = await import("@/server/auth/session");
    const role = await env.role({ isAdmin: true });
    const user = await env.user({ username: `admin-${Math.random()}`, roles: [role] });
    env.browser.reset();
    await env.signIn(user);
    const admin = (await getSession())!;
    const base = { id: AP.id, version: String(AP.updatedAt.getTime()), title: "Neu", date: "2030-05-06", time: "10:00", duration: "30", status: "scheduled", vehicleId: V.id };
    const kept = await updateAppointmentOperation.execute(admin, base);
    assert.ok(kept.ok, JSON.stringify(!kept.ok && kept.failure));
    const V2 = await env.db.vehicle.create({ data: { plate: "B-RS 2", plateNorm: "BRS2", customerId: C.id } });
    const fresh = await env.db.appointment.findUniqueOrThrow({ where: { id: AP.id } });
    const switched = await updateAppointmentOperation.execute(admin, { ...base, version: String(fresh.updatedAt.getTime()), vehicleId: V2.id, customerId: undefined });
    assert.ok(!switched.ok && switched.failure.fields?.vehicleId, "ein anderes Fahrzeug von C lässt sich nicht neu verknüpfen");
  });
});

describe("Eingeschränkte Kunden sind für die API nicht lesbar", () => {
  it("Fahrzeuge, Reifensätze, Termine und Aufträge von C: nicht in Listen, einzeln 404 (auch Ändern und Löschen); die der anderen Kunden bleiben", async () => {
    const vehicles = await call("GET", "/vehicles?limit=100");
    const ids = (vehicles.json.data as Array<{ id: string }>).map((v) => v.id);
    assert.ok(ids.includes(VN.id) && !ids.includes(V.id));
    assert.equal((await call("GET", `/vehicles/${V.id}`)).status, 404);
    assert.equal((await call("GET", `/vehicles/${VN.id}`)).status, 200);
    assert.equal((await call("DELETE", `/vehicles/${V.id}`)).status, 404);
    assert.equal((await call("DELETE", `/customers/${C.id}`)).status, 404, "auch Löschen kennt nur, was die Ressource zeigt");
    assert.equal(await env.db.customer.count({ where: { id: C.id } }), 1);
    assert.equal((await call("GET", `/tire-sets/${TS.id}`)).status, 404);
    assert.ok(!((await call("GET", "/tire-sets?limit=100")).json.data as Array<{ id: string }>).some((s) => s.id === TS.id));
    assert.equal((await call("GET", `/appointments/${AP.id}`)).status, 404);
    assert.ok(!((await call("GET", "/appointments?limit=100")).json.data as Array<{ id: string }>).some((a) => a.id === AP.id));
    assert.equal((await call("GET", `/orders/${O.id}`)).status, 404);
    assert.equal((await call("GET", `/customers/${C.id}`)).status, 404);
    assert.ok(!((await call("GET", "/orders?limit=100")).json.data as Array<{ id: string }>).some((o) => o.id === O.id));
    // und die Daten stehen unverändert in der Datenbank
    assert.equal(await env.db.vehicle.count({ where: { id: V.id } }), 1);
  });
});

describe("Webhooks melden nichts zu Sachen eingeschränkter Kunden", () => {
  it("Fan-out und Zustellung (auch wenn die Einschränkung nach dem Anlegen kam): kein Versand, sichtbar im Protokoll", async () => {
    const { fanOutEvent, deliverDue } = await import("@/server/webhooks/deliver");
    const { isRestrictedEntity } = await import("@/modules/admin/api/restriction");
    const { issueWebhookSecret } = await import("@/server/webhooks/secrets");
    const hook = await env.db.webhook.create({ data: { name: "Z", url: "https://hook.example.invalid/x", events: "order.closed,billing.paid,file.uploaded,checklist.completed", enabled: true } });
    await issueWebhookSecret(hook.id);
    const when = new Date();
    const N_ORDER = await env.db.order.create({ data: { number: "A-2026-9002", status: "accepted", vehicleId: VN.id, customerId: N.id } });
    assert.equal(await fanOutEvent({ id: "evt_c", type: "order.closed", entityId: O.id, createdAt: when }, { isRestricted: isRestrictedEntity }), 0, "Auftrag von C");
    assert.equal(await fanOutEvent({ id: "evt_n", type: "order.closed", entityId: N_ORDER.id, createdAt: when }, { isRestricted: isRestrictedEntity }), 1, "Auftrag des anderen Kunden");
    const doc = await env.db.invoice.create({ data: { source: "billing", direction: "outgoing", docType: "invoice", number: "BR-1", partyName: "X", customerId: C.id, issueDate: when, grossCents: 1 } as never }).catch(() => null);
    if (doc) assert.equal(await fanOutEvent({ id: "evt_doc", type: "billing.paid", entityId: doc.id, createdAt: when }, { isRestricted: isRestrictedEntity }), 0, "Beleg von C");
    // Eintreffen der Einschränkung nach dem Anlegen der Zustellung
    await env.db.webhookDelivery.create({ data: { webhookId: hook.id, eventId: "evt_late", type: "order.closed", entityId: O.id, eventAt: when } });
    await env.db.webhookDelivery.deleteMany({ where: { eventId: "evt_n" } });
    const summary = await deliverDue({ isRestricted: isRestrictedEntity });
    assert.equal(summary.suppressed, 1);
    assert.equal(summary.failed, 0, "die Unterdrückung ist kein Ausfall");
    const late = await env.db.webhookDelivery.findFirstOrThrow({ where: { eventId: "evt_late" } });
    assert.deepEqual([late.status, late.lastError, late.attempts], ["suppressed", "restricted", 1]);
    assert.equal(late.lastStatus, null, "es wurde nichts gesendet");
  });
});
