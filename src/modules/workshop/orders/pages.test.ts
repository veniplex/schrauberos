import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/**
 * Die Seiten der Aufträge wirklich gerendert (Server-Komponenten werden aufgelöst, das Ergebnis im DOM gezeigt): Liste, Detail (alle Status, mit und ohne Preise), Neu aus Termin, Bearbeiten.
 * Das ersetzt keinen Browserlauf (Layout, Touch), fängt aber Laufzeitfehler der Seiten und falsche Rechte-Anzeige ab.
 */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
let ids: { open: string; ready: string; closed: string; cancelled: string; appointment: string; vehicle: string };

const ALL = ["orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices", "orders.reopen", "appointments.view", "customers.view", "vehicles.view", "vehicles.edit", "appointments.create"];

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, roles: [role] }));
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
  await env.db.featureSetting.create({ data: { key: "workshop.orders", enabled: true, updatedByName: "test" } });
  const { seeds } = await import("./seed");
  const owner = await env.db.customer.create({ data: { lastName: "Muster", firstName: "Erika", nameKey: "muster erika" } });
  const vehicle = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf", customerId: owner.id, mileageKm: 50_000 } });
  await env.db.vehicle.create({ data: { plate: "B-MS 4711", plateNorm: "BMS4711", customerId: owner.id } });
  await env.db.vehicle.create({ data: { plate: "B-EY 2020", plateNorm: "BEY2020" } });
  await env.db.vehicle.create({ data: { plate: "B-MS 815", plateNorm: "BMS815" } });
  await env.db.vehicle.create({ data: { plate: "B-SN 909", plateNorm: "BSN909" } });
  await env.db.vehicle.create({ data: { plate: "B-AN 100", plateNorm: "BAN100" } });
  for (const seed of seeds) await seed.demo?.(env.db);
  const find = async (status: string) => (await env.db.order.findFirstOrThrow({ where: { status } })).id;
  const appointment = await env.db.appointment.create({ data: { title: "Inspektion", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), vehicleId: vehicle.id } });
  ids = { open: await find("in_progress"), ready: await find("ready"), closed: await find("picked_up"), cancelled: await find("cancelled"), appointment: appointment.id, vehicle: vehicle.id };
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

describe("Liste", () => {
  it("zeigt standardmäßig die offenen Aufträge mit Summen (mit Preisen), Statusleiste mit Anzahl, Suche und Spaltenköpfen", async () => {
    await login(ALL);
    const { default: OrdersPage } = await import("@/app/(app)/(workshop)/orders/page");
    const root = await render(await OrdersPage({ searchParams: Promise.resolve({}) }));
    const text = plain(root.textContent);
    assert.match(text, /Offen \(3\)/);
    assert.match(text, /B-AB 1234/);
    assert.match(text, /A-\d{4}-0002/);
    assert.doesNotMatch(text, /B-SN 909/, "storniert ist nicht offen");
    assert.match(text, /Brutto/, "Preisspalte");
    assert.ok(root.querySelector("input[name='q']"));
  });

  it("ohne orders.prices fehlt die Summenspalte; Statusfilter und Suche wirken", async () => {
    await login(["orders.view", "vehicles.view"]);
    const { default: OrdersPage } = await import("@/app/(app)/(workshop)/orders/page");
    let root = await render(await OrdersPage({ searchParams: Promise.resolve({}) }));
    assert.doesNotMatch(plain(root.textContent), /Brutto/);
    await view!.unmount();
    root = await render(await OrdersPage({ searchParams: Promise.resolve({ status: "cancelled" }) }));
    assert.match(plain(root.textContent), /B-SN 909/);
    await view!.unmount();
    root = await render(await OrdersPage({ searchParams: Promise.resolve({ status: "all", q: "zzz" }) }));
    assert.match(plain(root.textContent), /Keine Aufträge gefunden/);
  });
});

describe("Detail", () => {
  it("offener Auftrag mit Preisen: Stepper, Statusknöpfe, Positionen-Editor mit Summen, Befund- und Freigabeformular, Verlauf", async () => {
    await login(ALL);
    const { default: OrderPage } = await import("@/app/(app)/(workshop)/orders/[id]/page");
    const root = await render(await OrderPage({ params: Promise.resolve({ id: ids.open }) }));
    const text = plain(root.textContent);
    assert.match(text, /B-AB 1234/);
    assert.match(text, /Fertig melden/);
    assert.match(text, /Abschließen \(abgeholt\)/);
    assert.match(text, /Stornieren/);
    assert.doesNotMatch(text, /Wieder öffnen/, "nur bei abgeschlossenen Aufträgen");
    assert.ok(root.querySelector("input[name='items']"), "Positionen-Editor");
    assert.ok(root.querySelector("li[aria-current='step']"), "Stepper");
    assert.ok(root.querySelector("textarea[name='text']"), "Befundformular");
    assert.ok(root.querySelector("input[name='approverName']"), "Freigabeformular");
    assert.match((root.querySelector("input[name='items']") as HTMLInputElement).value, /Inspektion klein/);
    assert.match(text, /Bremsbeläge vorn bei 2 mm/);
    assert.match(text, /Auftrag angenommen/);
  });

  it("Mechaniker: Positionen ohne Preise (nur lesen), kein Preis, keine Freigabe, Status ja, Abschließen nein", async () => {
    await login(["orders.view", "orders.edit", "vehicles.view"]);
    const { default: OrderPage } = await import("@/app/(app)/(workshop)/orders/[id]/page");
    const root = await render(await OrderPage({ params: Promise.resolve({ id: ids.open }) }));
    const text = plain(root.textContent);
    assert.match(text, /Inspektion klein/);
    assert.doesNotMatch(text, /85,00/, "keine Preise");
    assert.doesNotMatch(text, /€/);
    assert.equal(root.querySelector("input[name='items']"), null);
    assert.equal(root.querySelector("input[name='approverName']"), null);
    assert.ok(root.querySelector("textarea[name='text']"), "Befund erfassen darf er");
    assert.match(text, /Fertig melden/);
    assert.doesNotMatch(text, /Abschließen \(abgeholt\)/);
  });

  it("abgeschlossen: Wieder öffnen nur mit dem eigenen Recht, keine Editoren, Summen sichtbar; storniert: Hinweis und Wiederaufnahme", async () => {
    await login(ALL);
    const { default: OrderPage } = await import("@/app/(app)/(workshop)/orders/[id]/page");
    let root = await render(await OrderPage({ params: Promise.resolve({ id: ids.closed }) }));
    let text = plain(root.textContent);
    assert.equal(Array.from(root.querySelectorAll("button")).some((b) => /Wieder öffnen/.test(b.textContent ?? "")), true);
    assert.match(text, /Abgeholt/);
    assert.equal(root.querySelector("input[name='items']"), null);
    assert.match(text, /Brutto/);
    await view!.unmount();
    await login(["orders.view", "orders.edit", "orders.close", "orders.prices"]);
    root = await render(await OrderPage({ params: Promise.resolve({ id: ids.closed }) }));
    assert.equal(Array.from(root.querySelectorAll("button")).some((b) => /Wieder öffnen/.test(b.textContent ?? "")), false, "ohne orders.reopen kein Knopf");
    await view!.unmount();
    root = await render(await OrderPage({ params: Promise.resolve({ id: ids.cancelled }) }));
    text = plain(root.textContent);
    assert.match(text, /storniert/i);
    assert.match(text, /Wieder aufnehmen/);
  });

  it("Freigabe-Protokoll: Betrag, Art, erfassende Person; unbekannter Auftrag und fehlendes Recht", async () => {
    await login(ALL);
    const { default: OrderPage } = await import("@/app/(app)/(workshop)/orders/[id]/page");
    const root = await render(await OrderPage({ params: Promise.resolve({ id: ids.ready }) }));
    const text = plain(root.textContent);
    assert.match(text, /Erika Beispiel/);
    assert.match(text, /240,00/);
    assert.match(text, /Telefonisch/);
    assert.equal(await isNotFound(() => OrderPage({ params: Promise.resolve({ id: "gibtsnicht" }) })), true);
    await login(["appointments.view"]);
    assert.equal(await redirectOf(() => OrderPage({ params: Promise.resolve({ id: ids.ready }) })), "/forbidden");
  });
});

describe("Neu und Bearbeiten", () => {
  it("Neu aus Termin: Fahrzeug und Anliegen sind vorbelegt; ohne Recht /forbidden", async () => {
    await login(ALL);
    const { default: NewOrderPage } = await import("@/app/(app)/(workshop)/orders/new/page");
    const root = await render(await NewOrderPage({ searchParams: Promise.resolve({ appointment: ids.appointment }) }));
    assert.match(plain(root.textContent), /Aus dem Termin „Inspektion“/);
    assert.equal((root.querySelector("input[name='appointmentId']") as HTMLInputElement).value, ids.appointment);
    assert.equal((root.querySelector("input[name='vehicleId']") as HTMLInputElement).value, ids.vehicle);
    assert.equal((root.querySelector("textarea[name='request']") as HTMLTextAreaElement).value, "Inspektion");
    await login(["orders.view"]);
    assert.equal(await redirectOf(() => NewOrderPage({ searchParams: Promise.resolve({}) })), "/forbidden");
  });

  it("Bearbeiten: nur offene Aufträge (abgeschlossene: nicht gefunden)", async () => {
    await login(ALL);
    const { default: EditPage } = await import("@/app/(app)/(workshop)/orders/[id]/edit/page");
    const root = await render(await EditPage({ params: Promise.resolve({ id: ids.open }) }));
    assert.ok(root.querySelector("input[name='version']"));
    assert.match((root.querySelector("textarea[name='request']") as HTMLTextAreaElement).value, /Inspektion nach Herstellervorgabe/);
    await view!.unmount();
    assert.equal(await isNotFound(() => EditPage({ params: Promise.resolve({ id: ids.closed }) })), true);
  });
});
