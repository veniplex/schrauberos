import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/** Übersicht, Abschnitt an Fahrzeug und Auftrag und die Galerie im echten Renderer; die Demo-Daten (echte kleine Dateien) bedienen jede Seite. */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
let orderId: string;
let vehicleId: string;
let restrictedOrderId: string;

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, roles: [role] }));
  return (await (await import("@/server/auth/session")).getSession())!;
}

async function render(node: ReactNode) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  const resolved = await resolveServerTree(node);
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, resolved)));
  return view.container;
}

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  for (const key of ["workshop.files", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf" } })).id;
  orderId = (await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId } })).id;
  const customer = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
  const restricted = await env.db.vehicle.create({ data: { plate: "B-XY 9", plateNorm: "BXY9", customerId: customer.id } });
  restrictedOrderId = (await env.db.order.create({ data: { number: "A-2026-0002", status: "in_progress", vehicleId: restricted.id, customerId: customer.id } })).id;
  const { seeds } = await import("./seed");
  for (const seed of seeds) await seed.demo?.(env.db);
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

const ALL = ["files.view", "files.upload", "files.delete", "vehicles.view", "orders.view"];

describe("Übersicht", () => {
  it("listet die sichtbaren Dateien (ohne entfernte), mit Suche und Filtern; ohne orders.view nur die am Fahrzeug", async () => {
    const session = await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/files/page");
    let root = await render(await Page({ searchParams: Promise.resolve({}) }));
    let text = plain(root.textContent);
    assert.match(text, /Annahme: Front, kleiner Kratzer links/);
    assert.match(text, /Parkschaden rechts hinten/);
    assert.doesNotMatch(text, /Falsches Foto/, "entfernte Datei");
    assert.match(text, /5 Dateien|6 Dateien|\d Dateien/);
    assert.ok(root.querySelector("input[name='q']"));
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({ type: "vehicle" }) }));
    text = plain(root.textContent);
    assert.match(text, /Parkschaden/);
    assert.doesNotMatch(text, /Annahme: Front/);
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({ q: "Kostenvoranschlag" }) }));
    assert.match(plain(root.textContent), /Kostenvoranschlag/);
    assert.doesNotMatch(plain(root.textContent), /Parkschaden/);
    void session;
    await view!.unmount();
    await login(["files.view", "vehicles.view"]);
    root = await render(await Page({ searchParams: Promise.resolve({}) }));
    text = plain(root.textContent);
    assert.match(text, /Parkschaden/);
    assert.doesNotMatch(text, /Annahme: Front/, "Dateien am Auftrag nur mit orders.view");
  });
});

describe("Abschnitt an Fahrzeug und Auftrag", () => {
  it("zeigt Galerie, Dokumente und – mit files.upload – die Upload-Knöpfe; ohne files.upload nur die Ansicht", async () => {
    const { sections } = await import("./sections");
    const order = sections.find((s) => s.host === "orders/detail")!;
    const vehicle = sections.find((s) => s.host === "vehicles/detail")!;
    const session = await login(ALL);
    let root = await render(await order.Component({ entityId: orderId, session }));
    let text = plain(root.textContent);
    assert.match(text, /Dokumente & Fotos/);
    assert.match(text, /Kostenvoranschlag/);
    assert.ok(root.querySelector("img[src='/api/files/" + (await (await import("@/server/db")).db.fileAttachment.findFirstOrThrow({ where: { orderId, archivedAt: null, mime: "image/png" } })).id + "']"), "Vorschaubild über die Auslieferungsroute");
    assert.ok(root.querySelectorAll("input[type='file']").length >= 2, "Fotos und Dokumente");
    assert.match(text, /Entfernen/);
    await view!.unmount();
    root = await render(await vehicle.Component({ entityId: vehicleId, session }));
    assert.match(plain(root.textContent), /Parkschaden rechts hinten/);
    await view!.unmount();

    const reader = await login(["files.view", "vehicles.view", "orders.view"]);
    root = await render(await order.Component({ entityId: orderId, session: reader }));
    text = plain(root.textContent);
    assert.equal(root.querySelectorAll("input[type='file']").length, 0, "kein Upload ohne files.upload");
    assert.doesNotMatch(text, /Entfernen/);
    assert.match(text, /Annahme: Front/);
  });

  it("bei einem Kunden mit eingeschränkter Verarbeitung erscheint der Abschnitt gar nicht; an einem abgeschlossenen Auftrag nur die Ansicht", async () => {
    const { sections } = await import("./sections");
    const order = sections.find((s) => s.host === "orders/detail")!;
    const session = await login(ALL);
    const hidden = await render(await order.Component({ entityId: restrictedOrderId, session }));
    assert.equal(hidden.textContent, "", "kein Abschnitt, auch kein Hinweis");
    await view!.unmount();
    await env.db.order.update({ where: { id: orderId }, data: { status: "picked_up" } });
    const root = await render(await order.Component({ entityId: orderId, session }));
    assert.match(plain(root.textContent), /nicht mehr offen/);
    assert.equal(root.querySelectorAll("input[type='file']").length, 0);
    await env.db.order.update({ where: { id: orderId }, data: { status: "in_progress" } });
  });
});
