import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { withRouter } from "@/test/router";

/** Navigation: Gruppen (Titel auch bei einem Eintrag), Aktiv-Logik, Einklappen mit Cookie, Seitenfach (Drawer) auf Handy und Tablet, Sprunglink. */
let dom: TestDom;
let view: MountedView | null = null;
let cookies: string[] = [];
/** Wer auf Änderungen der Medienabfragen hört (happy-dom meldet sie nicht von selbst): Der Test löst „Fenster wächst“ wie der Browser aus. */
const mediaListeners = new Set<() => void>();

before(() => {
  dom = installDom({ width: 820 });
  Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: (value: string) => void cookies.push(value) });
  const evaluate = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    return Boolean((min && window.innerWidth >= Number(min[1])) || (max && window.innerWidth <= Number(max[1])));
  };
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return evaluate(query);
    },
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  cookies = [];
});

const item = (href: string, label: string) => ({ href, label, icon: createElement("span", { "data-icon": href }) });
const props = {
  workshopName: "Werkstatt Müller",
  logoSrc: null,
  primary: [item("/", "Übersicht")],
  groups: [
    { id: "workshop", label: "Werkstatt", items: [item("/appointments", "Termine"), item("/customers", "Kunden"), item("/vehicles", "Fahrzeuge")] },
    { id: "handbook", label: "Handbuch", items: [item("/docs/handbook", "Handbuch")] },
    { id: "admin", label: "Verwaltung", items: [item("/admin/users", "Benutzer")] },
  ],
  trailing: [item("/help", "Hilfe")],
  collapsed: [] as string[],
  search: createElement("span", { "data-search": "" }),
  quickNew: createElement("span", { "data-new": "" }),
  account: createElement("span", { "data-account": "" }),
  accountCompact: createElement("span", { "data-account-compact": "" }),
};

async function mountSidebar(pathname: string, overrides: Partial<typeof props> = {}) {
  const { I18nProvider } = await import("@/i18n/client");
  const { de } = await import("@/i18n/messages/de");
  const { Sidebar } = await import("./sidebar");
  const build = async (path: string) =>
    createElement(
      I18nProvider,
      { locale: "de", messages: de } as never,
      (await withRouter(createElement(Sidebar, { ...props, ...overrides, children: createElement("main", { id: "main-content" }, "Inhalt") } as never) as ReactElement, { pathname: path })) as ReactElement,
    );
  view = await mount(await build(pathname));
  const root = view.container;
  const desktop = () => root.querySelector("aside") as HTMLElement;
  return { root, desktop, rerender: async (path: string) => view!.render(await build(path)) };
}

describe("Sidebar", () => {
  it("Gruppen mit Titel – auch bei nur einem Eintrag –, Einträge eingerückt; Übersicht oben, Hilfe am Ende", async () => {
    const s = await mountSidebar("/admin/users");
    const nav = s.desktop().querySelector("nav")!;
    const titles = [...nav.querySelectorAll("button[aria-expanded], p")].map((e) => e.textContent?.trim()).filter((t) => ["Werkstatt", "Handbuch", "Verwaltung"].includes(t ?? ""));
    assert.deepEqual(titles, ["Werkstatt", "Handbuch", "Verwaltung"]);
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent?.trim());
    assert.equal(links[0], "Übersicht");
    assert.equal(links.at(-1), "Hilfe");
    assert.ok(nav.querySelector("ul.ml-4"), "Unterpunkte eingerückt");
  });

  it("aktiv ist nur der längste passende Eintrag (Unterseite von Kunden: Kunden, nicht zwei)", async () => {
    const s = await mountSidebar("/customers/abc/edit");
    const current = [...s.desktop().querySelectorAll("[aria-current='page']")].map((a) => a.textContent?.trim());
    assert.deepEqual(current, ["Kunden"]);
  });

  it("die Gruppe der aktuellen Seite ist offen und nicht einklappbar; die anderen lassen sich einklappen (Cookie merkt es)", async () => {
    const s = await mountSidebar("/customers");
    const nav = s.desktop().querySelector("nav")!;
    const button = (title: string) => [...nav.querySelectorAll("button[aria-expanded]")].find((b) => b.textContent?.trim() === title) as HTMLButtonElement | undefined;
    assert.equal(button("Werkstatt"), undefined, "aktive Gruppe: kein Einklapp-Knopf");
    const handbook = button("Handbuch")!;
    assert.equal(handbook.getAttribute("aria-expanded"), "true");
    await act(() => handbook.click());
    assert.equal(button("Handbuch")!.getAttribute("aria-expanded"), "false");
    assert.deepEqual(cookies, ["so_nav=handbook; Path=/; Max-Age=31536000; SameSite=Lax"]);
    await act(() => button("Handbuch")!.click());
    assert.equal(cookies.at(-1), "so_nav=; Path=/; Max-Age=31536000; SameSite=Lax");
  });

  it("eingeklappte Gruppen aus dem Cookie sind schon beim ersten Zeichnen zu", async () => {
    const s = await mountSidebar("/customers", { collapsed: ["admin"] });
    const nav = s.desktop().querySelector("nav")!;
    const admin = [...nav.querySelectorAll("button[aria-expanded]")].find((b) => b.textContent?.trim() === "Verwaltung") as HTMLButtonElement;
    assert.equal(admin.getAttribute("aria-expanded"), "false");
    assert.equal(document.getElementById(admin.getAttribute("aria-controls")!)?.hasAttribute("hidden"), true);
  });

  it("Sprunglink zum Inhalt ist das erste Element; die Kopfzeile trägt Suche, Neu und Konto", async () => {
    const s = await mountSidebar("/");
    const skip = s.root.querySelector("a") as HTMLAnchorElement;
    assert.equal(skip.getAttribute("href"), "#main-content");
    assert.equal(skip.textContent, "Zum Inhalt springen");
    const header = s.root.querySelector("header")!;
    assert.ok(header.querySelector("[data-search]") && header.querySelector("[data-new]") && header.querySelector("[data-account-compact]"));
  });
});

describe("Seitenfach (Drawer)", () => {
  const drawer = (root: HTMLElement) => root.querySelector("dialog.drawer") as HTMLDialogElement;
  const openButton = (root: HTMLElement) => root.querySelector("header button[aria-label='Menü öffnen']") as HTMLButtonElement;

  it("der Menü-Knopf öffnet das modale Seitenfach mit Schließen-Knopf; Escape und Schließen-Knopf schließen es", async () => {
    const s = await mountSidebar("/");
    assert.equal(drawer(s.root).open, false);
    await act(() => openButton(s.root).click());
    assert.equal(drawer(s.root).open, true);
    assert.ok(drawer(s.root).querySelector("nav"), "Navigation im Seitenfach");
    await act(() => void drawer(s.root).dispatchEvent(new window.Event("cancel", { cancelable: true })));
    assert.equal(drawer(s.root).open, false);

    await act(() => openButton(s.root).click());
    await act(() => (drawer(s.root).querySelector("button[aria-label='Menü schließen']") as HTMLButtonElement).click());
    assert.equal(drawer(s.root).open, false);
  });

  it("schließt bei Navigation", async () => {
    const s = await mountSidebar("/");
    await act(() => openButton(s.root).click());
    assert.equal(drawer(s.root).open, true);
    await s.rerender("/customers");
    assert.equal(drawer(s.root).open, false);
  });

  it("schließt, wenn das Fenster auf Seitenleisten-Breite (1024 px) wächst", async () => {
    const s = await mountSidebar("/");
    await act(() => openButton(s.root).click());
    assert.equal(drawer(s.root).open, true);
    await act(() => {
      dom.setViewport(1280, 800);
      for (const listener of [...mediaListeners]) listener();
    });
    assert.equal(drawer(s.root).open, false);
  });
});
