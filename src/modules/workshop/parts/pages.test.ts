import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { click, mountI18n as mountPlain, plain, type } from "@/test/ui";

/**
 * Die Seiten von Teile & Lager wirklich gerendert (Liste, Artikel, Neu/Bearbeiten, Wareneingang, Inventur), dazu die Einhängepunkte in der Auftragsseite (Artikel einfügen, Verbrauchte Teile)
 * und der Übersichtsbaustein. Ersetzt keinen Browserlauf, fängt aber Laufzeitfehler und falsche Rechte-Anzeige.
 */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
let ids: { oil: string; brake: string; archived: string; order: string };

const ALL = ["parts.view", "parts.edit", "parts.stock", "parts.prices", "orders.view", "orders.create", "orders.edit", "orders.close", "orders.prices", "vehicles.view"];

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
  for (const key of ["workshop.orders", "workshop.parts"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  const owner = await env.db.customer.create({ data: { lastName: "Muster", nameKey: "muster" } });
  for (const [plate, norm] of [["B-AB 1234", "BAB1234"], ["B-MS 4711", "BMS4711"], ["B-EY 2020", "BEY2020"], ["B-MS 815", "BMS815"], ["B-SN 909", "BSN909"], ["B-AN 100", "BAN100"]] as const) {
    await env.db.vehicle.create({ data: { plate, plateNorm: norm, customerId: owner.id } });
  }
  for (const feature of ["orders", "parts"]) {
    const { seeds } = await import(`../${feature}/seed`);
    for (const seed of seeds) await seed.demo?.(env.db);
  }
  const find = (number: string) => env.db.article.findUniqueOrThrow({ where: { number } });
  const archived = await env.db.article.create({ data: { number: "ALT-1", name: "Altteil", searchKey: "alt 1 altteil", archivedAt: new Date() } });
  ids = { oil: (await find("OEL-5W30-1L")).id, brake: (await find("BEL-VA-01")).id, archived: archived.id, order: (await env.db.order.findFirstOrThrow({ where: { status: "in_progress" } })).id };
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
  it("zeigt aktive Artikel mit Bestand und Zustand, Verkaufspreis nur mit parts.prices; Filter unter Mindestbestand, Archiv und Suche", async () => {
    await login(ALL);
    const { default: PartsPage } = await import("@/app/(app)/(workshop)/parts/page");
    let root = await render(await PartsPage({ searchParams: Promise.resolve({}) }));
    let text = plain(root.textContent);
    assert.match(text, /OEL-5W30-1L/);
    assert.match(text, /Motoröl 5W-30/);
    assert.doesNotMatch(text, /ALT-1/, "archivierte Artikel fehlen in der Standardliste");
    assert.match(text, /Verkauf netto/);
    assert.match(text, /Unter Mindestbestand \(\d+\)/);
    await view!.unmount();
    root = await render(await PartsPage({ searchParams: Promise.resolve({ stock: "low" }) }));
    text = plain(root.textContent);
    assert.match(text, /BEL-VA-01/, "Bestand 1 ≤ Mindestbestand 2");
    assert.doesNotMatch(text, /OEL-5W30-1L/);
    await view!.unmount();
    root = await render(await PartsPage({ searchParams: Promise.resolve({ archived: "1" }) }));
    assert.match(plain(root.textContent), /ALT-1/);
    await view!.unmount();
    root = await render(await PartsPage({ searchParams: Promise.resolve({ q: "wischer 60" }) }));
    assert.match(plain(root.textContent), /WISCH-60/);
    await login(["parts.view"]);
    await view!.unmount();
    root = await render(await PartsPage({ searchParams: Promise.resolve({}) }));
    text = plain(root.textContent);
    assert.doesNotMatch(text, /Verkauf netto/);
    assert.doesNotMatch(text, /Wareneingang buchen/, "kein Knopf ohne parts.stock");
    assert.doesNotMatch(text, /Neuer Artikel/);
  });
});

describe("Artikel", () => {
  it("Detail: Bestand, Bewegungen mit Auftragsbezug, Preise nur mit Recht, Archivieren; ohne Recht /forbidden, unbekannt 404", async () => {
    await login(ALL);
    const { default: ArticlePage } = await import("@/app/(app)/(workshop)/parts/[id]/page");
    const wuchtId = (await env.db.article.findUniqueOrThrow({ where: { number: "WUCHT-5G" } })).id;
    let root = await render(await ArticlePage({ params: Promise.resolve({ id: wuchtId }) }));
    let text = plain(root.textContent);
    assert.match(text, /Wuchtgewicht 5 g/);
    assert.match(text, /Auftragsabgang/);
    assert.match(text, /Auftrag A-\d{4}-\d{4}/);
    assert.match(text, /Einkaufspreis netto/);
    assert.ok(Array.from(root.querySelectorAll("button")).some((b) => /Archivieren/.test(b.textContent ?? "")));
    await view!.unmount();
    await login(["parts.view"]);
    root = await render(await ArticlePage({ params: Promise.resolve({ id: wuchtId }) }));
    text = plain(root.textContent);
    assert.doesNotMatch(text, /Einkaufspreis/);
    assert.doesNotMatch(text, /0,25/);
    assert.equal(Array.from(root.querySelectorAll("button")).length, 0);
    assert.equal(await isNotFound(() => ArticlePage({ params: Promise.resolve({ id: "gibtsnicht" }) })), true);
    await login(["orders.view"]);
    assert.equal(await redirectOf(() => ArticlePage({ params: Promise.resolve({ id: wuchtId }) })), "/forbidden");
  });

  it("Negativer Bestand wird auf der Artikelseite deutlich gemacht", async () => {
    await login(ALL);
    const { default: ArticlePage } = await import("@/app/(app)/(workshop)/parts/[id]/page");
    const id = (await env.db.article.create({ data: { number: "NEG-1", name: "Knapp", searchKey: "neg 1 knapp", stockMilli: -2000 } })).id;
    const root = await render(await ArticlePage({ params: Promise.resolve({ id }) }));
    assert.match(plain(root.textContent), /Bestand negativ/);
    assert.match(plain(root.textContent), /-2 Stk/);
  });

  it("Neu und Bearbeiten: Preisfelder nur mit parts.prices, Bestand nie im Formular", async () => {
    await login(ALL);
    const { default: NewPage } = await import("@/app/(app)/(workshop)/parts/new/page");
    const { default: EditPage } = await import("@/app/(app)/(workshop)/parts/[id]/edit/page");
    let root = await render(await NewPage());
    assert.ok(root.querySelector("input[name='number']"));
    assert.ok(root.querySelector("input[name='purchase']") && root.querySelector("input[name='sale']"));
    assert.equal(root.querySelector("input[name='stock']"), null);
    assert.equal((root.querySelector("input[name='pricesShown']") as HTMLInputElement).value, "1");
    await view!.unmount();
    root = await render(await EditPage({ params: Promise.resolve({ id: ids.oil }) }));
    assert.equal((root.querySelector("input[name='number']") as HTMLInputElement).value, "OEL-5W30-1L");
    assert.equal((root.querySelector("input[name='sale']") as HTMLInputElement).value, "14,50");
    assert.ok(root.querySelector("input[name='version']"));
    await login(["parts.view", "parts.edit"]);
    await view!.unmount();
    root = await render(await EditPage({ params: Promise.resolve({ id: ids.oil }) }));
    assert.equal(root.querySelector("input[name='sale']"), null);
    assert.equal(root.querySelector("input[name='pricesShown']"), null);
    assert.ok(!root.innerHTML.includes("14,50"), "der Preis wird nicht einmal gerendert");
  });
});

describe("Wareneingang und Inventur", () => {
  it("Wareneingang: Artikel vorgewählt (?article=) oder per Auswahl; archivierte Artikel nicht; Inventur listet aktive Artikel mit Soll", async () => {
    await login(ALL);
    const { default: ReceiptPage } = await import("@/app/(app)/(workshop)/parts/receipt/page");
    const { default: CountPage } = await import("@/app/(app)/(workshop)/parts/count/page");
    let root = await render(await ReceiptPage({ searchParams: Promise.resolve({ article: ids.oil }) }));
    assert.equal((root.querySelector("input[name='articleId']") as HTMLInputElement).value, ids.oil);
    assert.ok(root.querySelector("input[name='quantity']") && root.querySelector("input[name='reference']"));
    await view!.unmount();
    root = await render(await ReceiptPage({ searchParams: Promise.resolve({ article: ids.archived }) }));
    assert.ok(root.querySelector("input[role='combobox'], input[aria-autocomplete]") || !root.querySelector("input[name='articleId'][type='hidden'][value='" + ids.archived + "']"), "archivierter Artikel ist nicht vorgewählt");
    await view!.unmount();
    root = await render(await CountPage());
    const text = plain(root.textContent);
    assert.match(text, /Motoröl 5W-30/);
    assert.doesNotMatch(text, /Altteil/);
    assert.ok(root.querySelector(`input[name='count.${ids.oil}']`));
    await login(["parts.view"]);
    await view!.unmount();
    assert.equal(await redirectOf(() => CountPage()), "/forbidden");
    assert.equal(await redirectOf(() => ReceiptPage({ searchParams: Promise.resolve({}) })), "/forbidden");
  });
});

describe("Einhängepunkte in der Auftragsseite und Übersicht", () => {
  it("Auftragsseite: „Artikel einfügen“ über dem Editor und „Verbrauchte Teile“ mit Warnung, wenn der Bestand nicht reicht", async () => {
    await login(ALL);
    const { default: OrderPage } = await import("@/app/(app)/(workshop)/orders/[id]/page");
    const root = await render(await OrderPage({ params: Promise.resolve({ id: ids.order }) }));
    const text = plain(root.textContent);
    assert.match(text, /Artikel einfügen/);
    assert.match(text, /Verbrauchte Teile/);
    assert.match(text, /Bestand reicht nicht/);
    assert.match(text, /Bremsbeläge Vorderachse/);
    assert.match(text, /Wird beim Abschluss gebucht/);
  });

  it("Mechaniker (parts.view, keine Preise): sieht „Verbrauchte Teile“, aber keinen Positionen-Editor und damit kein „Artikel einfügen“", async () => {
    await login(["orders.view", "orders.edit", "parts.view", "vehicles.view"]);
    const { default: OrderPage } = await import("@/app/(app)/(workshop)/orders/[id]/page");
    const root = await render(await OrderPage({ params: Promise.resolve({ id: ids.order }) }));
    const text = plain(root.textContent);
    assert.match(text, /Verbrauchte Teile/);
    assert.doesNotMatch(text, /Artikel einfügen/);
  });

  it("Übersichtsbaustein „Unter Mindestbestand“ nennt die knappen Artikel", async () => {
    await login(ALL);
    const { LowStockWidget } = await import("./widgets");
    const root = await render(createElement(LowStockWidget));
    const text = plain(root.textContent);
    assert.match(text, /Unter Mindestbestand/);
    assert.match(text, /Bremsbeläge Vorderachse/);
    assert.match(text, /Bestand 1 von mindestens 2 Satz/);
  });
});

describe("Artikelauswahl im Editor", () => {
  it("die Auswahl fügt eine Position mit Verweis, Verkaufspreis und Steuersatz in den Editor ein (Ereignis)", async () => {
    const { LINE_ITEM_ADD_EVENT } = await import("@/lib/line-items");
    const { ArticlePicker } = await import("./article-picker");
    const events: Array<{ name?: string; row: Record<string, string> }> = [];
    window.addEventListener(LINE_ITEM_ADD_EVENT, (event) => events.push((event as CustomEvent).detail));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [{ id: "a9", label: "OEL-1", sublabel: "Motoröl", number: "OEL-1", name: "Motoröl 5W-30", unit: "l", taxBp: 1900, stockMilli: 5000, saleCents: 1450 }] }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const { ToastProvider } = await import("@/components/ui/toast");
      view = await mountPlain(createElement(ToastProvider, null, createElement(ArticlePicker)));
      const input = view.container.querySelector("input[role='combobox'], input[type='search'], input:not([type='hidden'])") as HTMLInputElement;
      await type(input, "oel");
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));
      const option = view.container.querySelector("[role='option']") as HTMLElement;
      assert.ok(option, "Trefferliste");
      await click(option);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].row, { description: "Motoröl 5W-30", unit: "l", quantity: "1", unitPrice: "14,50", taxRate: "19", kind: "part", refType: "article", refId: "a9" });
      assert.equal(events[0].name, "items");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
