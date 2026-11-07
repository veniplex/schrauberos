import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { inspectPdf } from "@/test/pdf-text";

/**
 * Reifenlager-Etikett (F8): Daten nur mit Recht und ohne eingeschränkte Kunden (Art. 18), nur der Anzeigename des Halters, QR-Link aus der Einstellung (nie aus dem Header) und die PDF-Route (Rechte vor der
 * Erzeugung, Kopfzeilen, Format/Anzahl). Die Druckseite steht in `label-page.test.ts` (die DOM-Attrappe verträgt sich nicht mit `pdfkit`).
 */
let env: TestEnv;
let ids: { set: string; free: string; restricted: string };

const route = () => import("@/app/api/tires/[id]/label/route");
async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `l-${Math.random().toString(36).slice(2)}`, roles: [role] }));
  return (await (await import("@/server/auth/session")).getSession())!;
}
const get = async (id: string, query = "") => (await route()).GET(new NextRequest(`http://localhost/api/tires/${id}/label${query}`, { headers: { host: "evil.example" } }), { params: Promise.resolve({ id }) });
const rects = (bytes: Uint8Array) => (inspectPdf(Buffer.from(bytes)).contents[0].match(/ re\b/g) ?? []).length;

before(async () => {
  env = await createTestEnv();
  const owner = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", phone: "0151 123456", street: "Hauptstr. 1", city: "Berlin", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", customerId: owner.id } });
  const free = await env.db.vehicle.create({ data: { plate: "B-FR 1", plateNorm: "BFR1" } });
  const locked = await env.db.vehicle.create({ data: { plate: "B-GS 9", plateNorm: "BGS9", customerId: restricted.id } });
  const set = await env.db.tireSet.create({ data: { vehicleId: car.id, season: "winter", brand: "Conti", model: "WinterContact", width: 205, aspect: 55, rim: 16, loadIndex: "91", speedIndex: "H", storageLocation: "Halle A / Regal 3", notes: "GEHEIME NOTIZ" } });
  ids = {
    set: set.id,
    free: (await env.db.tireSet.create({ data: { vehicleId: free.id, season: "summer" } })).id,
    restricted: (await env.db.tireSet.create({ data: { vehicleId: locked.id, season: "summer", storageLocation: "X" } })).id,
  };
});
after(async () => {
  await env.cleanup();
});

describe("tireLabelData", () => {
  it("liefert Kennzeichen, Größe, Lagerplatz und nur den Anzeigenamen des Halters – nichts sonst", async () => {
    const session = await login(["tires.view"]);
    const { tireLabelData } = await import("./queries");
    const data = await tireLabelData(session, ids.set);
    assert.ok(data);
    assert.equal(data.plate, "B-AB 1234");
    assert.equal(data.ownerName, "Erika Muster");
    assert.equal(data.storageLocation, "Halle A / Regal 3");
    const text = JSON.stringify(data);
    for (const secret of ["0151 123456", "Hauptstr", "Berlin", "GEHEIME NOTIZ"]) assert.ok(!text.includes(secret), `${secret} darf nicht auf dem Etikett landen`);
  });

  it("ohne `tires.view` gibt es nichts; Sätze eingeschränkt verarbeiteter Kunden (Art. 18) gibt es nicht", async () => {
    const { tireLabelData } = await import("./queries");
    assert.equal(await tireLabelData(await login(["vehicles.view"]), ids.set), null);
    const session = await login(["tires.view"]);
    assert.equal(await tireLabelData(session, ids.restricted), null);
    assert.equal(await tireLabelData(session, "gibt-es-nicht"), null);
    const free = await tireLabelData(session, ids.free);
    assert.equal(free?.ownerName, null, "Fahrzeug ohne Halter");
  });
});

describe("tireLabelContent", () => {
  it("der QR-Code ist der absolute Link zur Seite des Satzes aus der Einstellung; ohne Einstellung kein QR", async () => {
    const session = await login(["tires.view"]);
    const { tireLabelData } = await import("./queries");
    const { tireLabelContent } = await import("./label");
    const { getI18n } = await import("@/i18n/server");
    const data = (await tireLabelData(session, ids.set))!;
    const i18n = await getI18n();
    const withBase = tireLabelContent(data, i18n, "https://werkstatt.example");
    assert.equal(withBase.qr, `https://werkstatt.example/tires/${ids.set}`);
    assert.equal(withBase.title, "B-AB 1234");
    assert.ok(withBase.lines.some((l) => l.includes("Halle A / Regal 3")));
    assert.ok(withBase.lines.some((l) => l.includes("205/55 R16 91H") && l.includes("Winter")));
    assert.ok(withBase.lines.includes("Conti WinterContact"));
    assert.equal(tireLabelContent(data, i18n, null).qr, null);
  });
});

describe("Route /api/tires/[id]/label", () => {
  it("ohne Sitzung 401, ohne Recht 403 (vor der Erzeugung), eingeschränkter Kunde und unbekannter Satz 404", async () => {
    env.signOut();
    assert.equal((await get(ids.set)).status, 401);
    await login(["vehicles.view"]);
    assert.equal((await get(ids.set)).status, 403);
    await login(["tires.view"]);
    assert.equal((await get(ids.restricted)).status, 404);
    assert.equal((await get("gibt-es-nicht")).status, 404);
  });

  it("liefert ein PDF mit den Schutzköpfen; Format, Anzahl und Bogen-Auslassung wirken; der Download-Parameter erzwingt den Anhang", async () => {
    await login(["tires.view"]);
    const res = await get(ids.set, "?format=100x50&copies=3");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
    assert.match(res.headers.get("content-disposition") ?? "", /^inline/);
    const read = inspectPdf(Buffer.from(await res.arrayBuffer()));
    assert.equal(read.pageCount, 3, "drei gleiche Etiketten, je eine Seite");
    assert.ok(read.pages[0].includes("B-AB 1234") && read.pages[0].replace(/\s+/g, " ").includes("Halle A / Regal 3"));
    assert.ok(!read.pages[0].includes("0151 123456"));

    const sheet = inspectPdf(Buffer.from(await (await get(ids.set, "?format=sheet-3x8&copies=2&skip=23")).arrayBuffer()));
    assert.equal(sheet.pageCount, 2, "23 Felder übersprungen, 2 Etiketten: das zweite steht auf der nächsten Seite");

    const download = await get(ids.set, "?download=1");
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment; filename="etikett-B-AB-1234\.pdf"/);
  });

  it("unbekanntes Format fällt auf den Standard zurück; Anzahl und Überspringen außerhalb der Grenzen werden geklemmt (nicht still auf den Standard gesetzt)", async () => {
    await login(["tires.view"]);
    const res = await get(ids.set, "?format=a4&copies=500&skip=-3");
    assert.equal(res.status, 200);
    assert.equal(inspectPdf(Buffer.from(await res.arrayBuffer())).pageCount, 24, "500 → höchstens 24 Etiketten (Einzelformat: eine Seite je Etikett)");
    const sheet = await get(ids.set, "?format=sheet-3x8&copies=2&skip=99");
    assert.equal(inspectPdf(Buffer.from(await sheet.arrayBuffer())).pageCount, 2, "skip=99 → 23: das zweite Etikett steht auf der nächsten Seite");
    const junk = await get(ids.set, "?copies=abc&skip=x");
    assert.equal(inspectPdf(Buffer.from(await junk.arrayBuffer())).pageCount, 1, "keine Zahl: Standard");
  });

  it("der QR-Code kommt aus der Einstellung, nie aus dem Host-Header", async () => {
    await login(["tires.view"]);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
    const without = rects(new Uint8Array(await (await get(ids.set)).arrayBuffer()));
    await env.db.appSetting.create({ data: { key: "app.publicUrl", value: "https://werkstatt.example" } });
    const withUrl = rects(new Uint8Array(await (await get(ids.set)).arrayBuffer()));
    assert.ok(withUrl > without + 100, `mit eingestellter Adresse ein QR-Code (Rechtecke ${without} → ${withUrl})`);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
  });
});

