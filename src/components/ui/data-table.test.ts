import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { installFakes } from "@/test/harness";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/**
 * DataTable, Pagination, FilterBar: die Datenliste in einem echten Renderer – Tabelle ab md, Karten darunter, Zeilenlink, Sortierung, Seitenwahl.
 * (Die Komponenten sind Server-Komponenten: Sie werden aufgerufen, ihr Ergebnis wird im Browser-DOM gerendert.)
 */
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

type Row = { id: string; name: string; city: string; km: number };
const rows: Row[] = [
  { id: "a", name: "Anna", city: "Bonn", km: 10 },
  { id: "b", name: "Bert", city: "Köln", km: 20 },
];

async function table(props: Record<string, unknown> = {}) {
  const { DataTable } = await import("./data-table");
  const element = await DataTable<Row>({
    caption: "Kunden",
    rows,
    rowKey: (r) => r.id,
    rowHref: (r) => `/customers/${r.id}`,
    sort: { key: "name", dir: "asc" },
    sortHref: (key, dir) => `/customers?sort=${key}&dir=${dir}`,
    columns: [
      { id: "name", header: "Name", priority: "primary", sort: "name", cell: (r) => r.name, sub: (r) => `#${r.id}` },
      { id: "city", header: "Ort", sort: "city", cell: (r) => r.city },
      { id: "km", header: "Kilometer", align: "end", priority: "low", cell: (r) => r.km },
      { id: "actions", header: "Aktionen", hideHeader: true, cell: (r) => createElement("button", { type: "button" }, `Löschen ${r.name}`) },
    ],
    ...props,
  });
  return show(element);
}

describe("DataTable", () => {
  it("Tabelle: Beschriftung, aria-sort nur an sortierbaren Spalten, Aktionsspalte ohne sichtbaren Kopf; ohne Überlauf kein Tab-Stopp (Verhalten: scroll-area.test.ts)", async () => {
    const root = await table();
    const t = root.querySelector("table");
    assert.ok(t);
    assert.equal(t.querySelector("caption")?.textContent, "Kunden");
    assert.equal(root.querySelector("[role='region']"), null, "passt die Tabelle hinein, gibt es keine leere Region und keinen zusätzlichen Tab-Stopp");
    const heads = [...t.querySelectorAll("th")];
    assert.deepEqual(heads.map((h) => h.getAttribute("aria-sort")), ["ascending", "none", null, null]);
    assert.match(heads[3].textContent ?? "", /Aktionen/);
    assert.ok(heads[3].querySelector(".sr-only"), "der Kopf der Aktionsspalte ist nur für Hilfstechnik da");
  });

  it("Sortierkopf: erster Klick auf die gewählte Spalte kehrt die Richtung um, eine andere Spalte beginnt aufsteigend", async () => {
    const root = await table();
    const links = [...root.querySelectorAll("thead a")].map((a) => a.getAttribute("href"));
    assert.deepEqual(links, ["/customers?sort=name&dir=desc", "/customers?sort=city&dir=asc"]);
  });

  it("Zeilenlink: die Hauptspalte trägt den gestreckten Link, Nebenzeile und andere Zellen stehen außerhalb", async () => {
    const root = await table();
    const row = root.querySelector("tbody tr");
    assert.ok(row);
    const link = row.querySelector("a");
    assert.equal(link?.getAttribute("href"), "/customers/a");
    assert.equal(link?.textContent, "Anna", "der Name des Links bleibt kurz");
    assert.match(row.querySelector("td")?.textContent ?? "", /#a/);
    assert.equal(row.querySelectorAll("a").length, 1);
  });

  it("Verweise in der Nebenzeile der Hauptspalte liegen über dem gestreckten Zeilenlink (bleiben anklickbar)", async () => {
    const root = await table({
      columns: [{ id: "name", header: "Name", priority: "primary", cell: (r: Row) => r.name, sub: (r: Row) => createElement("a", { href: `/v/${r.id}` }, "Fahrzeug") }],
    });
    const sub = root.querySelector("tbody td div");
    assert.ok(sub?.className.includes("[&_a]:relative"), "Verweise stehen in einer eigenen Ebene");
    assert.ok(sub?.className.includes("[&_a]:z-10"), "und über dem gestreckten Link");
  });

  it("Karten (unter md): je Zeile eine Karte mit Titel, beschrifteten Werten ohne `low`-Spalten und der Aktionsleiste", async () => {
    const root = await table();
    const cards = [...root.querySelectorAll("ul > li")];
    assert.equal(cards.length, 2);
    const first = cards[0];
    assert.equal(first.querySelector("a")?.getAttribute("href"), "/customers/a");
    const labels = [...first.querySelectorAll("dt")].map((d) => d.textContent);
    assert.deepEqual(labels, ["Ort"], "Kilometer ist `low` (nur Tabelle), die Aktionsspalte hat keine Beschriftung");
    assert.match(first.textContent ?? "", /Löschen Anna/);
    // die Sortierung steht über den Karten als Links
    assert.ok(root.querySelector("nav[aria-label='Sortieren nach']"));
  });

  it("ohne Zeilen erscheint `empty` statt der Liste", async () => {
    const root = await table({ rows: [], empty: createElement("p", null, "Nichts da") });
    assert.equal(root.querySelector("table"), null);
    assert.match(root.textContent ?? "", /Nichts da/);
  });

  it("ohne rowHref gibt es keine Zeilenlinks", async () => {
    const root = await table({ rowHref: undefined });
    assert.equal(root.querySelector("tbody a"), null);
  });
});

describe("Pagination", () => {
  async function pager(page: number, total: number) {
    const { Pagination } = await import("./pagination");
    return show(createElement("div", null, await Pagination({ page, pageSize: 25, total, hrefFor: (p) => `/x?page=${p}` })));
  }
  it("eine Seite: nichts", async () => {
    assert.equal((await pager(1, 25)).textContent, "");
  });
  it("mittlere Seite: Bereich, vorherige und nächste Seite", async () => {
    const root = await pager(2, 80);
    assert.match(root.textContent ?? "", /26–50 von 80/);
    assert.equal(root.querySelector("a[rel='prev']")?.getAttribute("href"), "/x?page=1");
    assert.equal(root.querySelector("a[rel='next']")?.getAttribute("href"), "/x?page=3");
  });
  it("letzte Seite: kein „Weiter“", async () => {
    const root = await pager(4, 80);
    assert.match(root.textContent ?? "", /76–80 von 80/);
    assert.equal(root.querySelector("a[rel='next']"), null);
  });
});

describe("FilterBar", () => {
  async function bar(props: Record<string, unknown>) {
    const { FilterBar } = await import("./filter-bar");
    return show(
      await FilterBar({
        columns: "sm:grid-cols-[1fr_auto]",
        search: createElement("input", { name: "q", "aria-label": "Suche" }),
        resetHref: "/liste",
        ...props,
      } as never),
    );
  }
  it("Suchfeld steht immer außerhalb der einklappbaren Zusatzfilter; „Zurücksetzen“ nur bei gesetztem Filter", async () => {
    const root = await bar({ children: createElement("select", { name: "status", "aria-label": "Status" }), active: true });
    const search = root.querySelector("input[name='q']");
    assert.ok(search);
    assert.equal(search.closest("[id]"), null, "das Suchfeld liegt nicht im Zusatzfilter-Bereich");
    const toggle = [...root.querySelectorAll("button")].find((b) => /Weitere Filter/.test(b.textContent ?? ""));
    assert.ok(toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    const extras = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    assert.ok(extras?.querySelector("select[name='status']"));
    assert.ok([...root.querySelectorAll("button")].some((b) => b.textContent === "Zurücksetzen"), "Zurücksetzen (Knopf: lädt die Liste ohne Filter und leert die Felder)");
    assert.ok(root.querySelector("form [role='status']"), "Live-Filter: Statusbereich für den Wartezustand");
  });
  it("keep: die gewählte Sortierung bleibt beim Filtern erhalten (versteckte Felder), leere Werte entfallen", async () => {
    const root = await bar({ keep: { sort: "city", dir: "desc", order: undefined } });
    assert.deepEqual(
      [...root.querySelectorAll("form input[type='hidden']")].map((i) => [i.getAttribute("name"), (i as HTMLInputElement).value]),
      [["sort", "city"], ["dir", "desc"]],
    );
  });
  it("ohne gesetzten Filter kein „Zurücksetzen“, ohne Zusatzfilter kein Einklapp-Knopf", async () => {
    const root = await bar({});
    assert.equal([...root.querySelectorAll("button")].some((b) => b.textContent === "Zurücksetzen"), false);
    assert.equal([...root.querySelectorAll("button")].some((b) => /Weitere Filter/.test(b.textContent ?? "")), false);
  });
});
