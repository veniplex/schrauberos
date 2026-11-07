import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { withWorkshopZone } from "@/test/zone";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { inspectPdf } from "@/test/pdf-text";

/**
 * Terminzettel (F8): Zeit in der Zone der Werkstatt, Telefon nur mit `customers.view`, Notizen nur auf Wunsch, kein Arbeitsplatz und kein Zuständiger, Art. 18 (Kunde oder Halter eingeschränkt: 404),
 * Rechte vor der Erzeugung, Papier A5/A6.
 */
let env: TestEnv;
let ids: { slip: string; restrictedCustomer: string; restrictedHolder: string; bare: string; overnight: string };

const route = () => import("@/app/api/appointments/[id]/slip/route");
async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `s-${Math.random().toString(36).slice(2)}`, roles: [role] }));
  return (await (await import("@/server/auth/session")).getSession())!;
}
const get = async (id: string, query = "") => (await route()).GET(new NextRequest(`http://localhost/api/appointments/${id}/slip${query}`), { params: Promise.resolve({ id }) });
const flat = async (res: Response) => inspectPdf(Buffer.from(await res.arrayBuffer())).pages.join("\n").replace(/\s+/g, " ");
const mediaBox = async (res: Response) => (/\/MediaBox\s*\[\s*([\d.\s-]+)\]/.exec(inspectPdf(Buffer.from(await res.arrayBuffer())).structure)?.[1] ?? "").trim().split(/\s+/).map(Number);

before(async () => {
  env = await createTestEnv();
  await (await import("@/server/seed/base")).ensureBaseData(env.db);
  const owner = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", phone: "0151 123456", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf", customerId: owner.id } });
  const lockedCar = await env.db.vehicle.create({ data: { plate: "B-GS 9", plateNorm: "BGS9", customerId: restricted.id } });
  const type = await env.db.appointmentType.create({ data: { name: "Reifenwechsel" } });
  const bay = await env.db.bay.create({ data: { name: "Hebebühne 7" } });
  const assignee = await env.db.user.create({ data: { username: "meister", name: "Meister Eder" } });
  const tires = await env.db.tireSet.create({ data: { vehicleId: car.id, season: "winter", width: 205, aspect: 55, rim: 16, storageLocation: "Halle A / Regal 3" } });
  // 9. November 2026, 09:00 bis 10:30 Uhr Ortszeit Berlin (MEZ = UTC+1)
  ids = {
    slip: (await env.db.appointment.create({ data: { title: "Räderwechsel Winter", startsAt: new Date("2026-11-09T08:00:00Z"), endsAt: new Date("2026-11-09T09:30:00Z"), notes: "INTERN: Kunde zahlt immer spät", typeId: type.id, bayId: bay.id, assigneeId: assignee.id, vehicleId: car.id, tireSetId: tires.id } })).id,
    restrictedCustomer: (await env.db.appointment.create({ data: { title: "A", startsAt: new Date("2026-11-09T08:00:00Z"), endsAt: new Date("2026-11-09T09:00:00Z"), customerId: restricted.id } })).id,
    restrictedHolder: (await env.db.appointment.create({ data: { title: "B", startsAt: new Date("2026-11-09T08:00:00Z"), endsAt: new Date("2026-11-09T09:00:00Z"), vehicleId: lockedCar.id } })).id,
    bare: (await env.db.appointment.create({ data: { title: "Laufkundschaft", startsAt: new Date("2026-11-10T10:00:00Z"), endsAt: new Date("2026-11-10T10:30:00Z") } })).id,
    overnight: (await env.db.appointment.create({ data: { title: "Über Nacht", startsAt: new Date("2026-11-09T22:30:00Z"), endsAt: new Date("2026-11-10T07:00:00Z") } })).id,
  };
});
after(() => env.cleanup());

describe("appointmentSlipData", () => {
  it("Notizen nur auf Wunsch, Telefon nur mit `customers.view`; kein Arbeitsplatz, kein Zuständiger", async () => {
    const { appointmentSlipData } = await import("./queries");
    const session = await login(["appointments.view"]);
    const plain = await appointmentSlipData(session, ids.slip);
    assert.ok(plain);
    assert.equal(plain.notes, null, "ohne Wunsch werden die Notizen gar nicht gelesen");
    assert.equal(plain.phone, null);
    assert.equal(plain.customerName, "Erika Muster");
    const json = JSON.stringify(plain);
    for (const internal of ["Hebebühne 7", "Meister Eder", "INTERN", "0151 123456", "assigneeId", "bayId"]) assert.ok(!json.includes(internal), `${internal} gehört nicht auf den Zettel`);
    const withNotes = await appointmentSlipData(session, ids.slip, { withNotes: true });
    assert.equal(withNotes?.notes, "INTERN: Kunde zahlt immer spät");
    assert.equal((await appointmentSlipData(await login(["appointments.view", "customers.view"]), ids.slip))?.phone, "0151 123456");
  });

  it("ohne `appointments.view` nichts; Termine mit eingeschränktem Kunden oder Halter (Art. 18) gibt es nicht", async () => {
    const { appointmentSlipData } = await import("./queries");
    assert.equal(await appointmentSlipData(await login(["vehicles.view"]), ids.slip), null);
    const session = await login(["appointments.view", "customers.view"]);
    assert.equal(await appointmentSlipData(session, ids.restrictedCustomer), null);
    assert.equal(await appointmentSlipData(session, ids.restrictedHolder), null);
    assert.equal(await appointmentSlipData(session, "gibt-es-nicht"), null);
    assert.ok(await appointmentSlipData(session, ids.bare), "Laufkundschaft ohne Kunde und Fahrzeug ist druckbar");
  });
});

describe("Route /api/appointments/[id]/slip", () => {
  it("ohne Sitzung 401, ohne Recht 403, Art. 18 und unbekannt 404", async () => {
    env.signOut();
    assert.equal((await get(ids.slip)).status, 401);
    await login(["orders.view"]);
    assert.equal((await get(ids.slip)).status, 403);
    await login(["appointments.view"]);
    assert.equal((await get(ids.restrictedCustomer)).status, 404);
    assert.equal((await get(ids.restrictedHolder)).status, 404);
    assert.equal((await get("gibt-es-nicht")).status, 404);
  });

  it("das PDF zeigt Datum und Uhrzeit der Werkstatt-Zone, Anliegen, Terminart, Fahrzeug, Kunde und Reifensatz – nichts Internes", async () => {
    await login(["appointments.view"]);
    const res = await get(ids.slip);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    const text = await flat(res);
    for (const expected of ["Termin in unserer Werkstatt", "Montag, 9. November 2026", "09:00 – 10:30 Uhr", "Räderwechsel Winter", "Reifenwechsel", "B-AB 1234 · VW Golf", "Erika Muster", "Winter · 205/55 R16"]) assert.ok(text.includes(expected), `${expected} fehlt: ${text}`);
    for (const internal of ["Hebebühne", "Meister Eder", "INTERN", "0151 123456", "Halle A"]) assert.ok(!text.includes(internal), `${internal} darf nicht erscheinen`);
  });

  it("Telefon nur mit `customers.view`; Notizen nur mit `notes=1`", async () => {
    await login(["appointments.view", "customers.view"]);
    assert.ok((await flat(await get(ids.slip))).includes("0151 123456"));
    const withNotes = await flat(await get(ids.slip, "?notes=1"));
    assert.ok(withNotes.includes("Hinweise") && withNotes.includes("INTERN: Kunde zahlt immer spät"));
    assert.ok(!(await flat(await get(ids.slip))).includes("INTERN"));
  });

  it("Papier A5 (Standard) oder A6; die Größe außerhalb der Auswahl fällt auf A5 zurück", async () => {
    await login(["appointments.view"]);
    const a5 = await mediaBox(await get(ids.slip));
    assert.ok(Math.abs(a5[2] - 419.53) < 0.5, `A5 ${a5}`);
    const a6 = await mediaBox(await get(ids.slip, "?size=a6"));
    assert.ok(Math.abs(a6[2] - 297.64) < 0.5 && Math.abs(a6[3] - 419.53) < 0.5, `A6 ${a6}`);
    const a4 = await mediaBox(await get(ids.slip, "?size=a4"));
    assert.ok(Math.abs(a4[2] - 419.53) < 0.5, "A4 gibt es für den Zettel nicht");
    assert.equal(inspectPdf(Buffer.from(await (await get(ids.slip, "?size=a6")).arrayBuffer())).pageCount, 1, "ein Termin passt auf einen A6-Zettel");
  });

  it("Laufkundschaft ohne Fahrzeug/Kunde; Termine über Mitternacht zeigen das Ende mit Datum; Zeiten gelten in der Zone der Werkstatt, nicht der des Servers", async () => {
    await login(["appointments.view"]);
    const bare = await flat(await get(ids.bare));
    assert.ok(bare.includes("Laufkundschaft") && !bare.includes("Fahrzeug") && !bare.includes("Kunde"));
    const overnight = await flat(await get(ids.overnight));
    assert.ok(overnight.includes("23:30 –") && /10\.11\.2026/.test(overnight), overnight);
    // die Zone gehört der Einstellung der Werkstatt (getWorkshop setzt sie bei jedem Lesen), der Prozess läuft in einer ganz anderen
    await env.db.workshop.upsert({ where: { id: "default" }, update: { timezone: "America/New_York" }, create: { id: "default", timezone: "America/New_York" } });
    try {
      await withWorkshopZone("Europe/Berlin", async () => {
        assert.ok((await flat(await get(ids.slip))).includes("03:00 – 04:30 Uhr"), "09:00 MEZ = 03:00 in New York");
      });
    } finally {
      await env.db.workshop.update({ where: { id: "default" }, data: { timezone: "Europe/Berlin" } });
    }
  });
});
