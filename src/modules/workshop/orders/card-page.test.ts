import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/** Die Druckseite der Auftragskarte (F8) im echten Renderer: Papierwahl, Karte ohne Preise, Hinweis auf das Annahmeprotokoll, Hinweis ohne Adresse, Art. 18. */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let ids: { order: string; restricted: string };

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, roles: [role] }));
}
async function render(node: ReactNode) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, await resolveServerTree(node))));
  return view.container;
}

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  for (const key of ["workshop.orders", "workshop.checklists"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  const owner = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", phone: "0151 123456", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf", customerId: owner.id } });
  const order = await env.db.order.create({
    data: { number: "A-2026-0001", vehicleId: car.id, customerId: owner.id, request: "Bremsen prüfen", items: { create: [{ position: 1, description: "Bremsbeläge wechseln", unit: "Std", quantityMilli: 2000, unitCents: 12345, taxBp: 1900 }] } },
  });
  ids = { order: order.id, restricted: (await env.db.order.create({ data: { number: "A-2026-0002", vehicleId: car.id, customerId: restricted.id } })).id };
});
after(async () => {
  await view?.unmount();
  await dom.close();
  await env.cleanup();
});

describe("Seite /orders/[id]/card", () => {
  it("zeigt die Karte ohne Preise im gewählten Papier, die Papierwahl und das PDF", async () => {
    await login(["orders.view", "orders.prices", "customers.view"]);
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
    const { default: Page } = await import("@/app/(app)/(workshop)/orders/[id]/card/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.order }), searchParams: Promise.resolve({ size: "a5" }) }));
    const text = plain(root.textContent);
    assert.ok(root.querySelector(".print-a5"), "benannte Seite A5");
    // Spaltenbreiten wie im PDF (Gewichte des Modells 0,6/1,1/4,2/1,4/0,9 als Anteile), nicht gleich breit
    const widths = [...root.querySelectorAll("table col")].map((col) => parseFloat((col as HTMLElement).style.width));
    assert.equal(widths.length, 5);
    assert.ok(widths[2] > widths[0] * 5 && Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.1, `Spaltenanteile ${widths}`);
    assert.match(text, /Auftragskarte A-2026-0001/);
    assert.match(text, /Bremsen prüfen/);
    assert.match(text, /Bremsbeläge wechseln/);
    assert.match(text, /0151 123456/);
    assert.match(text, /Notizen/);
    for (const price of ["123,45", "€", "19 %", "unitCents"]) assert.ok(!text.includes(price), `Preis ${price} in der Druckansicht`);
    assert.match(text, /ohne QR-Code/);
    assert.ok(root.querySelector("a[href='/orders/" + ids.order + "/card?size=a4']"), "Papierwahl A4");
    assert.ok(root.querySelector("a[href^='/api/orders/'][href*='/card?size=a5']"), "PDF mit demselben Papier");
    assert.ok(root.querySelector(".no-print"));
  });

  it("zeigt Hinweis auf das Annahmeprotokoll, wenn die Checklisten aktiv sind, und den QR-Code mit eingestellter Adresse", async () => {
    await login(["orders.view", "checklists.view"]);
    await env.db.appSetting.create({ data: { key: "app.publicUrl", value: "https://werkstatt.example" } });
    const { default: Page } = await import("@/app/(app)/(workshop)/orders/[id]/card/page");
    await view?.unmount();
    const root = await render(await Page({ params: Promise.resolve({ id: ids.order }), searchParams: Promise.resolve({}) }));
    assert.match(plain(root.textContent), /Annahmeprotokoll\s*noch nicht erstellt/);
    assert.ok(root.querySelector("svg[role='img']"), "QR-Code");
    assert.doesNotMatch(plain(root.textContent), /ohne QR-Code/);
    assert.ok(root.querySelector(".print-a4"));
    await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
  });

  it("Aufträge eingeschränkt verarbeiteter Kunden gibt es nicht (404)", async () => {
    await login(["orders.view"]);
    const { default: Page } = await import("@/app/(app)/(workshop)/orders/[id]/card/page");
    assert.equal(await isNotFound(() => Page({ params: Promise.resolve({ id: ids.restricted }), searchParams: Promise.resolve({}) })), true);
  });
});
