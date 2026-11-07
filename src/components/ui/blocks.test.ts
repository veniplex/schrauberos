import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { installFakes } from "@/test/harness";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/** Die kleinen Bausteine (P2a-5, P2a-8) in einem echten Renderer: Zustandsmarke, Links, Kennzahl, Hinweis, Reiter, Seitenkopf, Inhaltsverzeichnis. */
let dom: TestDom;
let view: MountedView | null = null;

before(() => {
  installFakes();
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

async function show(element: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, element));
  return view.container;
}
const h = createElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement;

describe("StatusBadge", () => {
  it("grün, gelb, rot und blau tragen ein Symbol (nicht nur Farbe), grau und Akzent nicht", async () => {
    const { StatusBadge } = await import("./layout");
    const root = await show(h("div", null, (["success", "warning", "danger", "info", "neutral", "accent"] as const).map((tone) => h(StatusBadge, { key: tone, tone, children: tone }))));
    const badges = [...root.querySelectorAll(".badge")];
    assert.deepEqual(badges.map((b) => b.className.match(/badge-(\w+)/)?.[1]), ["success", "warning", "danger", "info", "neutral", "accent"]);
    assert.deepEqual(badges.map((b) => b.querySelector("svg") !== null), [true, true, true, true, false, false]);
    assert.equal(badges[0].querySelector("svg")?.getAttribute("aria-hidden"), "true", "das Symbol ist dekorativ");
  });
});

describe("TextLink", () => {
  it("ist unterstrichen und hat bei Touch ein Mindestziel; external ist ein normaler Verweis", async () => {
    const { TextLink } = await import("./layout");
    const root = await show(h("div", null, [h(TextLink, { key: "a", href: "/x" }, "intern"), h(TextLink, { key: "b", href: "mailto:a@b.de", external: true }, "Mail")]));
    const [a, b] = [...root.querySelectorAll("a")];
    for (const link of [a, b]) {
      assert.match(link.className, /\bunderline\b/);
      assert.match(link.className, /min-h-\(--tap-row\)/);
    }
    assert.equal(b.getAttribute("href"), "mailto:a@b.de");
    assert.equal(b.querySelector("span"), null, "externer Verweis ohne Wartesymbol");
  });
});

describe("StatCard", () => {
  it("Kennzahl; mit href ist die ganze Kachel ein Link; tone färbt den Wert", async () => {
    const { StatCard } = await import("./layout");
    const root = await show(h("div", null, [h(StatCard, { key: "a", label: "Offen", value: "12,00 €", sub: "2 Rechnungen", tone: "danger" }), h(StatCard, { key: "b", label: "Geräte", value: 7, href: "/network/devices" })]));
    assert.match(root.textContent ?? "", /Offen12,00 €2 Rechnungen/);
    assert.match(root.querySelector("p.text-2xl")?.className ?? "", /text-danger-ink/);
    assert.equal(root.querySelector("a")?.getAttribute("href"), "/network/devices");
  });
});

describe("Alert", () => {
  it("Rolle nach Ton: Fehler = alert, sonst status; live=false ohne Rolle; Symbol und Attribute werden durchgereicht", async () => {
    const { Alert } = await import("./layout");
    const root = await show(
      h("div", null, [
        h(Alert, { key: "d", tone: "danger" }, "Fehler"),
        h(Alert, { key: "i", tone: "info" }, "Info"),
        h(Alert, { key: "q", tone: "warning", live: false }, "still"),
        h(Alert, { key: "s", tone: "success", icon: h("svg", { "data-icon": "" }), "data-x": "1" } as never, "ok"),
      ]),
    );
    const els = [...root.firstElementChild!.children];
    assert.deepEqual(els.map((e) => e.getAttribute("role")), ["alert", "status", null, "status"]);
    assert.ok(els[3].querySelector("[data-icon]"));
    assert.equal(els[3].getAttribute("data-x"), "1");
  });
});

describe("TabNav und SegmentedLinks", () => {
  it("der aktive Reiter trägt aria-current=page, die Navigation ist benannt", async () => {
    const { TabNav } = await import("./tab-nav");
    const root = await show(h(TabNav, { label: "Rechnungen", items: [{ href: "/a", label: "Eingang", active: true }, { href: "/b", label: "Ausgang", active: false }] }));
    assert.equal(root.querySelector("nav")?.getAttribute("aria-label"), "Rechnungen");
    assert.deepEqual([...root.querySelectorAll("a")].map((a) => a.getAttribute("aria-current")), ["page", null]);
  });
  it("SegmentedLinks: Auswahl über die Adresse, aktive Option markiert", async () => {
    const { SegmentedLinks } = await import("./segmented");
    const root = await show(h(SegmentedLinks, { label: "Ansicht", options: [{ href: "/x", label: "Alle", active: false }, { href: "/x?due=1", label: "Fällig", active: true }] }));
    assert.deepEqual([...root.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.getAttribute("aria-current")]), [["/x", null], ["/x?due=1", "true"]]);
  });
});

describe("PageHeader", () => {
  it("Pfad ab sm, darunter der Rücksprung; Hilfe-Knopf mit Namen; ohne back/help nur die Überschrift", async () => {
    const { PageHeader } = await import("./page-header");
    const root = await show(
      await PageHeader({ title: "Müller", back: { href: "/customers", label: "Kunden" }, help: "workshop.customers", description: "Kunde seit 2020", actions: h("button", { type: "button" }, "Bearbeiten") }),
    );
    assert.equal(root.querySelector("h1")?.textContent, "Müller");
    const nav = root.querySelector("nav");
    assert.equal(nav?.getAttribute("aria-label"), "Pfad");
    assert.deepEqual([...nav!.querySelectorAll("a")].map((a) => a.getAttribute("href")), ["/customers", "/customers"], "einmal im Pfad (ab sm), einmal als Rücksprung (darunter)");
    const help = root.querySelector("a[href='/help/workshop.customers']");
    assert.equal(help?.getAttribute("aria-label"), "Hilfe zu dieser Seite");
    await view?.unmount();
    const bare = await show(await PageHeader({ title: "Liste" }));
    assert.equal(bare.querySelector("nav"), null);
    assert.equal(bare.querySelector("a"), null);
  });
  it("mehrere Vorfahren: der ganze Pfad, der Rücksprung geht zum nächsten", async () => {
    const { PageHeader } = await import("./page-header");
    const root = await show(await PageHeader({ title: "Bearbeiten", breadcrumbs: [{ href: "/customers", label: "Kunden" }, { href: "/customers/1", label: "Müller" }] }));
    assert.deepEqual([...root.querySelectorAll("nav a")].map((a) => a.getAttribute("href")), ["/customers", "/customers/1", "/customers/1"]);
  });
});

describe("Card und DangerZone", () => {
  it("Kartenüberschrift h2, in Abschnitten h3; der Gefahrenbereich hat eine Überschrift", async () => {
    const { Card, DangerZone } = await import("./layout");
    const root = await show(h("div", null, [h(Card, { key: "a", title: "Kontakt" }, "x"), h(Card, { key: "b", title: "Widget", headingLevel: 3 }, "y"), h(DangerZone, { key: "c", title: "Gefahrenbereich" }, "Löschen")]));
    assert.deepEqual([...root.querySelectorAll("h2, h3")].map((e) => `${e.tagName}:${e.textContent}`), ["H2:Kontakt", "H3:Widget", "H2:Gefahrenbereich"]);
  });
});

describe("PageToc", () => {
  it("einklappbar unter xl (Disclosure) und feste Spalte ab xl – beide benannt, mit denselben Einträgen", async () => {
    const { PageToc } = await import("./toc");
    const items = [
      { id: "a", text: "Anfang", level: 2 as const },
      { id: "b", text: "Detail", level: 3 as const },
    ];
    const root = await show(h("div", null, [h(PageToc, { key: "i", title: "Auf dieser Seite", items, placement: "inline" }), h(PageToc, { key: "a", title: "Auf dieser Seite", items, placement: "aside" })]));
    assert.equal(root.querySelectorAll("a[href^='#']").length, 4);
    assert.equal(root.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded"), "false");
    assert.equal(root.querySelectorAll("nav[aria-label='Auf dieser Seite']").length, 2);
  });
});
