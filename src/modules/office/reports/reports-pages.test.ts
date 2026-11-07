import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { plain } from "@/test/ui";

/** Die Seiten der Berichte im echten Renderer (Diagramm mit Tabellen-Alternative, Tabelle, Hinweise, Rechte je Quelle, Export nur mit eigenem Recht), das Dashboard-Widget und die Schnellsuche. */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
const MAIN = ["reports.view", "invoices.view", "appointments.view", "tires.view", "vehicles.view", "fleet.view"];

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
  await view?.unmount();
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, await resolveServerTree(node))));
  return view.container;
}
const page = async (path: string) => (await import(`@/app/(app)/(office)/reports/${path}`)).default as (props?: never) => Promise<ReactNode>;

before(async () => {
  dom = installDom();
  env = await createTestEnv();
  await env.db.featureSetting.create({ data: { key: "office.reports", enabled: true, updatedByName: "test" } });
  const { noon } = await import("@/lib/zone");
  const now = new Date();
  const thisMonth = new Date(now.getTime());
  void thisMonth;
  await env.db.invoice.create({ data: { direction: "outgoing", number: "RE-1", partyName: "Muster GmbH", issueDate: noon(new Date().toISOString().slice(0, 10)), netCents: 10_000, vatCents: 1_900, grossCents: 11_900, status: "open", dueDate: noon("2020-01-01") } });
  await env.db.bay.create({ data: { name: "Hebebühne 1" } });
  const car = await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", inspectionDue: "2020-01" } });
  await env.db.tireSet.create({ data: { vehicleId: car.id, season: "winter", storageLocation: "Halle A" } });
});
after(async () => {
  await view?.unmount();
  await dom.close();
  await env.cleanup();
});

describe("Übersicht", () => {
  it("zeigt nur die Berichte, die die Rechte hergeben; ohne Quelle der Hinweis", async () => {
    const Page = await page("page");
    await login(["reports.view", "tires.view"]);
    let root = await render(await Page());
    assert.match(plain(root.textContent), /Einlagerungsbestand/);
    assert.doesNotMatch(plain(root.textContent), /Umsatz je Monat/);
    assert.ok(root.querySelector("a[href='/reports/storage']"));
    await login(["reports.view"]);
    root = await render(await Page());
    assert.match(plain(root.textContent), /noch kein Bericht verfügbar/);
    await login(MAIN);
    root = await render(await Page());
    assert.equal(root.querySelectorAll("li a[href^='/reports/']").length, 5);
  });

  it("ohne reports.view: Weiterleitung auf „Kein Zugriff“", async () => {
    const Page = await page("page");
    await login(["invoices.view"]);
    assert.equal(await redirectOf(() => Page()), "/forbidden");
  });
});

describe("Umsatz", () => {
  it("Kennzahlen, Diagramm mit Tabellen-Alternative, Tabelle, Hinweis zur Rundung auf Monate und die Rechenregeln; Export nur mit reports.export", async () => {
    const Page = await page("revenue/page");
    await login(MAIN);
    let root = await render(await Page({ searchParams: Promise.resolve({}) } as never));
    const text = plain(root.textContent);
    assert.match(text, /Umsatz je Monat/);
    assert.match(text, /Gerechnet wird je ganzem Monat/);
    assert.ok(root.querySelector("svg[role='img']"), "Diagramm");
    assert.ok([...root.querySelectorAll("button")].some((b) => /Als Tabelle/.test(b.textContent ?? "")), "Tabellen-Alternative");
    assert.match(text, /119,00/, "Brutto der Rechnung");
    assert.match(text, /So wird gerechnet/);
    assert.equal(root.querySelector("form[class*='max-w-xl'] select[name='format']"), null, "ohne reports.export kein Export");
    assert.doesNotMatch(text, /Als CSV herunterladen/);

    await login([...MAIN, "reports.export"]);
    root = await render(await Page({ searchParams: Promise.resolve({}) } as never));
    assert.match(plain(root.textContent), /Als CSV herunterladen/);
  });

  it("ein ungültiger Zeitraum fällt mit Hinweis auf die Voreinstellung zurück; ohne invoices.view Weiterleitung", async () => {
    const Page = await page("revenue/page");
    await login(MAIN);
    const root = await render(await Page({ searchParams: Promise.resolve({ from: "2026-05-01", to: "2026-01-01" }) } as never));
    assert.match(plain(root.textContent), /Das Ende liegt vor dem Beginn/);
    assert.ok(root.querySelector("svg[role='img']"));
    await login(["reports.view", "appointments.view"]);
    assert.equal(await redirectOf(() => Page({ searchParams: Promise.resolve({}) } as never)), "/forbidden");
  });
});

describe("Offene Posten, Auslastung, Einlagerung, Fälligkeiten", () => {
  it("offene Posten: Stufen, Liste, Verlinkung zur Rechnung; Richtung wählbar", async () => {
    const Page = await page("open-items/page");
    await login(MAIN);
    const root = await render(await Page({ searchParams: Promise.resolve({}) } as never));
    const text = plain(root.textContent);
    assert.match(text, /Forderungen \(Ausgangsrechnungen\)/);
    assert.match(text, /Über 90 Tage überfällig/);
    assert.match(text, /RE-1/);
    assert.match(text, /119,00/);
    assert.ok(root.querySelector("a[href='/reports/open-items?direction=incoming']"));
    const incoming = await render(await Page({ searchParams: Promise.resolve({ direction: "incoming" }) } as never));
    assert.match(plain(incoming.textContent), /Es gibt keine offenen Posten/);
  });

  it("Auslastung: Arbeitsplatz in Tabelle, Hinweise zur Berechnung; Einlagerung: Anzahlen je Saison ohne Kennzeichen; Fälligkeiten: überfälliges Fahrzeug", async () => {
    await login(MAIN);
    let root = await render(await (await page("utilization/page"))({ searchParams: Promise.resolve({}) } as never));
    assert.match(plain(root.textContent), /Hebebühne 1/);
    assert.match(plain(root.textContent), /So wird gerechnet/);
    // eindeutige Kennzahlen: Kapazität je Arbeitsplatz / gesamt, gebucht gesamt, davon ohne Arbeitsplatz (kein mehrdeutiges „Öffnungszeit“ neben „Gebucht“)
    const util = plain(root.textContent);
    for (const label of ["Kapazität je Arbeitsplatz", "Kapazität gesamt", "Gebucht gesamt", "davon ohne Arbeitsplatz"]) assert.ok(util.includes(label), label);
    assert.match(util, /1 Arbeitsplatz/, "Zahl der Arbeitsplätze unter der Gesamtkapazität");
    root = await render(await (await page("storage/page"))({} as never));
    const storage = plain(root.textContent);
    assert.match(storage, /Halle A/);
    assert.doesNotMatch(storage, /B-AB 1/, "kein Kennzeichen im Einlagerungsbericht");
    root = await render(await (await page("due/page"))({ searchParams: Promise.resolve({ months: "6" }) } as never));
    const due = plain(root.textContent);
    assert.match(due, /B-AB 1/);
    assert.match(due, /Überfällig/);
    assert.ok(root.querySelector("a[href='/reports/due?months=12']"));
  });

  it("Fälligkeiten: jeder Monat des Zeitraums steht im Diagramm – auch ohne Fristen; der Listenhinweis nur bei voller Liste", async () => {
    await login(MAIN);
    const root = await render(await (await page("due/page"))({ searchParams: Promise.resolve({ months: "6" }) } as never));
   // das Fahrzeug ist 2020-01 überfällig, im Zeitraum (6 Monate) gibt es keine kommende Frist: trotzdem sechs Monate auf der Achse (Tabellen-Alternative des Diagramms)
    const text = plain(root.textContent);
    assert.match(text, /7 Werte je Reihe/, "Überfällig plus sechs Monate");
    assert.equal((text.match(/Fahrzeuge, [^:]+: 0/g) ?? []).length, 6, "alle sechs Monate stehen als Nullmonat in der Tabelle des Diagramms (datumsunabhängig gezählt)");
    assert.doesNotMatch(plain(root.textContent), /Angezeigt werden die ersten 50 Zeilen/, "weniger als 50 Zeilen: kein Hinweis");
    const open = await render(await (await page("open-items/page"))({ searchParams: Promise.resolve({}) } as never));
    assert.doesNotMatch(plain(open.textContent), /Angezeigt werden die ersten 50 Zeilen/);
  });

  it("Fälligkeiten nur mit einer Quelle: ohne Fahrzeug-, Fuhrpark- und Rechnungsrecht Weiterleitung; mit nur einem Recht nur dieser Teil", async () => {
    const Page = await page("due/page");
    await login(["reports.view", "tires.view"]);
    assert.equal(await redirectOf(() => Page({ searchParams: Promise.resolve({}) } as never)), "/forbidden");
    await login(["reports.view", "fleet.view"]);
    const root = await render(await Page({ searchParams: Promise.resolve({}) } as never));
    const text = plain(root.textContent);
    assert.match(text, /Fristen im Fuhrpark/);
    assert.equal(root.querySelector("#due-inspection"), null, "kein Teil der Fahrzeuge ohne vehicles.view");
    assert.equal(root.querySelector("#due-payments"), null, "keine Zahlungsziele ohne invoices.view");
    assert.ok(root.querySelector("#due-fleet"));
  });
});

describe("Baustein und Schnellsuche", () => {
  it("der Umsatz-Baustein nennt Brutto, Netto und Belege des laufenden Monats – nur mit reports.view und invoices.view, sonst leer", async () => {
    const { RevenueWidget } = await import("./widgets");
    await login(MAIN);
    let root = await render(await RevenueWidget());
    assert.match(plain(root.textContent), /Umsatz im laufenden Monat/);
    assert.match(plain(root.textContent), /119,00/);
    assert.ok(root.querySelector("a[href='/reports/revenue']"));
    const label = root.querySelector("a[href='/reports/revenue']")!.getAttribute("aria-label") ?? "";
    assert.match(label, /119,00/, "der zugängliche Name nennt den Betrag (sonst läse ein Screenreader ihn nicht vor)");
    assert.match(label, /1 Beleg/);
    await login(["reports.view"]);
    root = await render((await RevenueWidget()) ?? createElement("div", { id: "leer" }));
    assert.ok(root.querySelector("#leer"), "ohne Rechnungsrecht kein Betrag");
  });

  it("die Schnellsuche findet Berichte nach Namen und nur die, die die Person öffnen darf", async () => {
    const { searchProviders } = await import("./search");
    const provider = searchProviders[0];
    const rich = await login(MAIN);
    const hits = await provider.search("Umsatz", { session: rich, limit: 5 });
    assert.deepEqual(hits.map((h) => h.href), ["/reports/revenue"]);
    assert.equal((await provider.search("", { session: rich, limit: 5 })).length, 0);
    const poor = await login(["reports.view", "tires.view"]);
    assert.equal((await provider.search("Umsatz", { session: poor, limit: 5 })).length, 0);
    assert.deepEqual((await provider.search("Einlagerung", { session: poor, limit: 5 })).map((h) => h.href), ["/reports/storage"]);
  });
});
