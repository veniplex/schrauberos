import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { inspectPdf } from "@/test/pdf-text";

/**
 * Auftragskarte (F8): keine Preise (auch nicht mit `orders.prices`), Telefon nur mit `customers.view`, Art. 18 (Auftrag oder Fahrzeug eines eingeschränkten Kunden: 404), Rechte vor der Erzeugung,
 * Papiergröße, QR-Link aus der Einstellung, Beitrag der Checklisten (Stand des Annahmeprotokolls) nur bei aktiver Funktion und vorhandenem Recht.
 */
let env: TestEnv;
let ids: { order: string; restrictedOrder: string; restrictedVehicleOrder: string; empty: string };

const route = () => import("@/app/api/orders/[id]/card/route");
async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `c-${Math.random().toString(36).slice(2)}`, name: "Tom Meyer", roles: [role] }));
  return (await (await import("@/server/auth/session")).getSession())!;
}
const get = async (id: string, query = "") => (await route()).GET(new NextRequest(`http://localhost/api/orders/${id}/card${query}`), { params: Promise.resolve({ id }) });
const textOf = async (res: Response) => inspectPdf(Buffer.from(await res.arrayBuffer()));
const flat = (pages: string[]) => pages.join("\n").replace(/\s+/g, " ");
const mediaBox = (structure: string): number[] => (/\/MediaBox\s*\[\s*([\d.\s-]+)\]/.exec(structure)?.[1] ?? "").trim().split(/\s+/).map(Number);

before(async () => {
  env = await createTestEnv();
  for (const key of ["workshop.orders", "workshop.checklists"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  const owner = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", phone: "0151 123456", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf", customerId: owner.id } });
  const lockedCar = await env.db.vehicle.create({ data: { plate: "B-GS 9", plateNorm: "BGS9", customerId: restricted.id } });
  const order = await env.db.order.create({
    data: {
      number: "A-2026-0001",
      status: "in_progress",
      vehicleId: car.id,
      customerId: owner.id,
      request: "Bremsen quietschen, bitte prüfen",
      mileageKm: 123456,
      items: {
        create: [
          { position: 1, kind: "labor", description: "Bremsbeläge vorn wechseln", unit: "Std", quantityMilli: 1500, unitCents: 9999, taxBp: 1900 },
          { position: 2, kind: "part", description: "Bremsbelagsatz", unit: "Stk", quantityMilli: 1000, unitCents: 8765, taxBp: 1900, discountBp: 500 },
        ],
      },
    },
  });
  ids = {
    order: order.id,
    restrictedOrder: (await env.db.order.create({ data: { number: "A-2026-0002", vehicleId: car.id, customerId: restricted.id } })).id,
    restrictedVehicleOrder: (await env.db.order.create({ data: { number: "A-2026-0003", vehicleId: lockedCar.id } })).id,
    empty: (await env.db.order.create({ data: { number: "A-2026-0004", vehicleId: car.id } })).id,
  };
});
after(() => env.cleanup());

describe("orderCardData", () => {
  it("liefert die Positionen ohne jeden Preis – auch mit `orders.prices` und `orders.edit` nicht", async () => {
    const { orderCardData } = await import("./queries");
    for (const rights of [["orders.view"], ["orders.view", "orders.prices", "orders.edit", "customers.view"]]) {
      const data = await orderCardData(await login(rights), ids.order);
      assert.ok(data);
      assert.equal(data.items.length, 2);
      const json = JSON.stringify(data);
      for (const price of ["unitCents", "9999", "8765", "taxBp", "discountBp"]) assert.ok(!json.includes(price), `${price} darf nicht in den Kartendaten stehen (${rights})`);
    }
  });

  it("Telefon nur mit `customers.view`; ohne `orders.view` nichts", async () => {
    const { orderCardData } = await import("./queries");
    assert.equal((await orderCardData(await login(["orders.view"]), ids.order))?.phone, null);
    assert.equal((await orderCardData(await login(["orders.view", "customers.view"]), ids.order))?.phone, "0151 123456");
    assert.equal((await orderCardData(await login(["orders.view"]), ids.order))?.customerName, "Erika Muster", "der Anzeigename ist immer sichtbar (D7)");
    assert.equal(await orderCardData(await login(["vehicles.view"]), ids.order), null);
  });

  it("Auftrag oder Fahrzeug eines eingeschränkt verarbeiteten Kunden (Art. 18) gibt es nicht", async () => {
    const { orderCardData } = await import("./queries");
    const session = await login(["orders.view", "customers.view"]);
    assert.equal(await orderCardData(session, ids.restrictedOrder), null);
    assert.equal(await orderCardData(session, ids.restrictedVehicleOrder), null);
    assert.equal(await orderCardData(session, "gibt-es-nicht"), null);
  });
});

describe("Route /api/orders/[id]/card", () => {
  it("ohne Sitzung 401, ohne Recht 403, eingeschränkter Kunde und unbekannter Auftrag 404", async () => {
    env.signOut();
    assert.equal((await get(ids.order)).status, 401);
    await login(["vehicles.view"]);
    assert.equal((await get(ids.order)).status, 403);
    await login(["orders.view"]);
    assert.equal((await get(ids.restrictedOrder)).status, 404);
    assert.equal((await get(ids.restrictedVehicleOrder)).status, 404);
    assert.equal((await get("gibt-es-nicht")).status, 404);
  });

  it("das PDF zeigt Auftrag, Fahrzeug, Kunde, Wunsch und Positionen – nie einen Preis; Schutzköpfe wie bei jedem PDF", async () => {
    await login(["orders.view", "orders.prices", "customers.view"]);
    const res = await get(ids.order);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
    const read = await textOf(res);
    const text = flat(read.pages);
    for (const expected of ["Auftragskarte A-2026-0001", "B-AB 1234", "VW Golf", "Erika Muster", "0151 123456", "Bremsen quietschen, bitte prüfen", "Bremsbeläge vorn wechseln", "Bremsbelagsatz", "1,5 Std", "1 Stk", "Notizen"]) {
      assert.ok(text.includes(expected), `${expected} fehlt: ${text}`);
    }
    assert.ok(text.includes("123.456 km"), "Kilometerstand");
    for (const price of ["99,99", "87,65", "9999", "8765", "€", "19 %", "5 %"]) assert.ok(!text.includes(price), `Preis ${price} auf der Karte`);
    assert.equal(read.pageCount, 1);
  });

  it("ohne `customers.view` fehlt das Telefon, der Name bleibt", async () => {
    await login(["orders.view"]);
    const text = flat((await textOf(await get(ids.order))).pages);
    assert.ok(text.includes("Erika Muster"));
    assert.ok(!text.includes("0151 123456"));
  });

  it("Papier A5 statt A4; unbekannte Größe fällt auf A4 zurück; Download erzwingt den Anhang", async () => {
    await login(["orders.view"]);
    const a5 = mediaBox((await textOf(await get(ids.order, "?size=a5"))).structure);
    assert.ok(Math.abs(a5[2] - 419.53) < 0.5 && Math.abs(a5[3] - 595.28) < 0.5, `A5: ${a5}`);
    const a4 = mediaBox((await textOf(await get(ids.order, "?size=a4"))).structure);
    assert.ok(Math.abs(a4[2] - 595.28) < 0.5);
    const fallback = mediaBox((await textOf(await get(ids.order, "?size=a6"))).structure);
    assert.ok(Math.abs(fallback[2] - 595.28) < 0.5, "a6 gibt es für die Auftragskarte nicht");
    assert.match((await get(ids.order, "?download=1")).headers.get("content-disposition") ?? "", /^attachment; filename="auftragskarte-A-2026-0001\.pdf"/);
  });

  it("ein Auftrag ohne Positionen zeigt den Hinweis; der QR-Code steht nur mit eingestellter Adresse", async () => {
    await login(["orders.view"]);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
    const without = await textOf(await get(ids.empty));
    assert.ok(flat(without.pages).includes("Noch keine Positionen erfasst."));
    const rects = (read: ReturnType<typeof inspectPdf>) => (read.contents[0].match(/ re\b/g) ?? []).length;
    await env.db.appSetting.create({ data: { key: "app.publicUrl", value: "https://werkstatt.example" } });
    const withUrl = await textOf(await get(ids.empty));
    assert.ok(rects(withUrl) > rects(without) + 100, "mit Adresse ein QR-Code");
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
  });

  it("die Karte verweist auf das Annahmeprotokoll (Beitrag der Checklisten): nicht erstellt, begonnen, abgeschlossen", async () => {
    const { installDefaultTemplates } = await import("@/modules/workshop/checklists/install");
    await installDefaultTemplates(env.db, "test");
    const worker = await login(["orders.view", "checklists.view", "checklists.fill", "vehicles.view"]);
    assert.ok(flat((await textOf(await get(ids.order))).pages).includes("Annahmeprotokoll noch nicht erstellt"));

    const { startChecklistOperation } = await import("@/modules/workshop/checklists/operations");
    const template = await env.db.checklistTemplate.findFirstOrThrow({ where: { standardKey: "intake" } });
    const started = await startChecklistOperation.execute(worker, { templateId: template.id, orderId: ids.order });
    assert.ok(started.ok, JSON.stringify(!started.ok && started.failure));
    assert.ok(flat((await textOf(await get(ids.order))).pages).includes("Annahmeprotokoll begonnen, noch nicht abgeschlossen"));

    await env.db.checklist.updateMany({ where: { orderId: ids.order }, data: { status: "completed", completedAt: new Date("2026-11-03T10:00:00Z"), completedByName: "Tom Meyer", signedName: "Erika Muster" } });
    const done = flat((await textOf(await get(ids.order))).pages);
    assert.ok(done.includes("abgeschlossen am 03.11.2026 von Tom Meyer"), done);
    assert.ok(done.includes("mit Namen bestätigt: Erika Muster"));

    // ohne das Recht an den Checklisten: keine Zeile (und auch keine über deren Zustand)
    await login(["orders.view"]);
    assert.ok(!flat((await textOf(await get(ids.order))).pages).includes("Annahmeprotokoll"));
    // Funktion ausgeschaltet: keine Zeile
    await env.db.featureSetting.update({ where: { key: "workshop.checklists" }, data: { enabled: false } });
    await login(["orders.view", "checklists.view"]);
    assert.ok(!flat((await textOf(await get(ids.order))).pages).includes("Annahmeprotokoll"));
    await env.db.featureSetting.update({ where: { key: "workshop.checklists" }, data: { enabled: true } });
  });
});
