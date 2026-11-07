import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { withRouter } from "@/test/router";

/**
 * Der Kalender in einem echten Renderer (react-dom/client + happy-dom, echte Termine aus der Datenbank): zwei Darstellungen (Raster ab md, Wochenstreifen und Karten darunter),
 * Karten mit Notizen, Status und Schnellstatus, Lese-Dialog ohne Bearbeiten-Recht, Tastaturbedienung des Rasters und die Regeln für `sticky` (kein Vorfahr mit `overflow`).
 * CSS wird in happy-dom nicht ausgewertet – geprüft wird, was im Markup steht (Klassen, Stile, Attribute) und was die Bedienung bewirkt.
 */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;

const DAY = new Date(2030, 4, 8); // Mittwoch
const NOW = new Date(2030, 4, 8, 10, 20);
const at = (day: number, h: number, m = 0) => new Date(2030, 4, day, h, m);

before(async () => {
  env = await createTestEnv();
  dom = installDom();
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

type Parts = { WeekView: ComponentType<Record<string, unknown>>; DayView: ComponentType<Record<string, unknown>>; ListView: ComponentType<Record<string, unknown>> };

let bayId: string;
beforeEach(async () => {
  await env.db.appointment.deleteMany();
  await env.db.vehicle.deleteMany();
  await env.db.bay.deleteMany();
  await env.db.appointmentType.deleteMany();
  await env.db.customer.deleteMany();
  const type = await env.db.appointmentType.create({ data: { name: "Inspektion", color: "#14532d" } });
  bayId = (await env.db.bay.create({ data: { name: "Hebebühne 1" } })).id;
  const customer = await env.db.customer.create({ data: { lastName: "Meier", firstName: "Anna", email: "anna@example.com", phone: "0170 1234567" } });
  const car = await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1", customerId: customer.id } });
  const base = { typeId: type.id, bayId, vehicleId: car.id };
  await env.db.appointment.createMany({
    data: [
      { ...base, title: "Ölwechsel", startsAt: at(8, 9), endsAt: at(8, 10), status: "scheduled", notes: "Kunde wartet.\nFilter mitbringen" },
      { ...base, title: "Kurzer Check", startsAt: at(8, 11), endsAt: at(8, 11, 10), status: "in_progress" },
      { ...base, title: "Nachkontrolle", startsAt: at(8, 11, 30), endsAt: at(8, 11, 40), status: "scheduled" },
      { title: "Storniert", startsAt: at(8, 14), endsAt: at(8, 15), status: "cancelled" },
      { title: "Donnerstag", startsAt: at(9, 9), endsAt: at(9, 10), status: "scheduled" },
    ],
  });
});

async function withProviders(child: ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  return createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, child));
}

async function render(name: keyof Parts, options: { canEdit?: boolean; canCreate?: boolean; slot?: number; bays?: number; range?: [Date, Date]; ssr?: boolean } = {}) {
  const calendar = (await import("./calendar")) as unknown as Parts;
  const { appointmentsBetween } = await import("./queries");
  const { createTranslator } = await import("@/i18n/translate");
  const { de } = await import("@/i18n/messages/de");
  const { DEFAULT_OPENING_HOURS } = await import("@/lib/opening-hours");
  const range = options.range ?? ([at(6, 0), at(13, 0)] as [Date, Date]);
  const events = await appointmentsBetween(...range);
  const ctx = {
    i18n: createTranslator("de", de),
    view: name === "WeekView" ? "week" : name === "DayView" ? "day" : "list",
    date: DAY,
    canCreate: options.canCreate ?? true,
    canEdit: options.canEdit ?? true,
    canStock: false,
    hours: DEFAULT_OPENING_HOURS,
    dayStartHour: 8,
    dayEndHour: 12,
    slotMinutes: options.slot ?? 30,
    now: NOW,
  };
  const bays = [{ id: bayId, name: "Hebebühne 1" }, ...Array.from({ length: (options.bays ?? 1) - 1 }, (_, i) => ({ id: `extra-${i}`, name: `Platz ${i + 2}` }))];
  const element = createElement(calendar[name], { ctx, events: name === "DayView" ? events.filter((e) => e.startsAt.getDate() === 8) : events, ...(name === "DayView" ? { bays } : {}) });
  let root: HTMLElement;
  if (options.ssr) {
    // Stil-Werte (`max(calc(…))`, `color-mix`) kennt happy-dom nicht und verwirft sie: für Prüfungen am Stil das serverseitig erzeugte Markup unverändert auswerten
    root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await withRouter(await withProviders(element)));
    document.body.append(root);
    view = { container: root, render: async () => {}, unmount: async () => void root.remove() };
  } else {
    view = await mount(await withRouter(await withProviders(element)));
    root = view.container;
  }
  const phone = root.querySelector(".md\\:hidden") as HTMLElement | null;
  const desktop = root.querySelector(".hidden.md\\:block") as HTMLElement | null;
  return { root, phone, desktop, text: (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ") };
}

/** Klassen aller Vorfahren eines Elements bis zum Container */
function ancestorClasses(el: Element, stop: Element) {
  const out: string[] = [];
  for (let node = el.parentElement; node && node !== stop.parentElement; node = node.parentElement) out.push(node.getAttribute("class") ?? "");
  return out;
}

describe("Kalender: zwei Darstellungen per CSS", () => {
  it("Woche: Wochenstreifen und Karten für Handy (md:hidden), Zeitraster ab md (hidden md:block) – beide im Markup", async () => {
    const { phone, desktop } = await render("WeekView");
    assert.ok(phone && desktop);
    assert.ok(phone.querySelector("nav[aria-label='Wochentage']"), "Wochenstreifen");
    assert.ok(phone.querySelector("article"), "Karten");
    assert.ok(desktop.querySelector("a[data-slot]"), "Zeitraster mit Zeitfenstern");
    assert.equal(phone.querySelector("a[data-slot]"), null);
  });

  it("Wochenstreifen: sieben Tage, der gewählte trägt aria-current, die Zahl nennt die Termine des Tages (ohne stornierte)", async () => {
    const { phone, text } = await render("WeekView");
    const chips = [...phone!.querySelectorAll("nav li a")];
    assert.equal(chips.length, 7);
    assert.deepEqual(chips.map((c) => c.getAttribute("aria-current")), [null, null, "true", null, null, null, null]);
    assert.match(text(chips[2]), /\b3\b/, "Mittwoch: drei Termine (der stornierte zählt nicht)");
    assert.match(chips[2].getAttribute("href") ?? "", /view=week&date=2030-05-08/);
    assert.match(text(chips[3]), /1 Termin/, "Donnerstag: ein Termin");
  });

  it("Karten zeigen nur die Termine des gewählten Tages: Zeit, Kennzeichen, Titel, Kunde, Arbeitsplatz, Status und die Notizen", async () => {
    const { phone, text } = await render("WeekView");
    const cards = [...phone!.querySelectorAll("article")];
    assert.equal(cards.length, 4);
    assert.ok(!text(phone).includes("Donnerstag"), "andere Tage nicht");
    const first = text(cards[0]);
    assert.match(first, /09:00–10:00/);
    assert.match(first, /B AB 1/);
    assert.match(first, /Ölwechsel/);
    assert.match(first, /Meier/);
    assert.match(first, /Hebebühne 1/);
    assert.match(first, /Geplant/);
    assert.match(first, /Kunde wartet\./, "Notizen sind sichtbar");
    assert.match(first, /Filter mitbringen/);
    assert.match(text(cards[3]), /Storniert/);
    assert.ok(cards[3].querySelector("a.line-through"), "stornierte Termine sind durchgestrichen");
  });

  it("Tag: dieselben Karten für Handy, Spalte je Arbeitsplatz im Raster", async () => {
    const { phone, desktop } = await render("DayView");
    assert.equal(phone!.querySelectorAll("article").length, 4);
    assert.ok(phone!.querySelector("nav[aria-label='Wochentage']"));
    const groups = [...desktop!.querySelectorAll("div[role='group'][aria-label]")];
    assert.deepEqual(groups.map((g) => g.getAttribute("aria-label")), ["Hebebühne 1", "Ohne Arbeitsplatz"]);
  });

  it("Liste: je Tag ein Abschnitt mit Überschrift und Karten (keine Tabelle)", async () => {
    const { root } = await render("ListView");
    assert.equal(root.querySelector("table"), null);
    assert.equal(root.querySelectorAll("section h3").length, 2);
    assert.equal(root.querySelectorAll("article").length, 5);
  });
});

describe("Kalender: Karten und Dialog", () => {
  it("ohne Bearbeiten-Recht führt eine Karte in die Leseansicht (show), mit dem Recht ins Formular (edit)", async () => {
    const readOnly = await render("WeekView", { canEdit: false });
    assert.match(readOnly.phone!.querySelector("article a")?.getAttribute("href") ?? "", /show=/);
    assert.equal(readOnly.root.querySelector("a[href*='edit=']"), null);
    await view?.unmount();
    const editor = await render("WeekView", { canEdit: true });
    assert.match(editor.phone!.querySelector("article a")?.getAttribute("href") ?? "", /edit=/);
    assert.equal(editor.root.querySelector("a[href*='show=']"), null);
  });

  it("Schnellstatus auf der Karte und im Raster: Starten/Fertig nur mit dem Recht und nur, wo der Status einen Schritt hat", async () => {
    const { phone, desktop } = await render("WeekView", { canEdit: true });
    const buttons = (el: Element) => [...el.querySelectorAll("button")].map((b) => b.textContent);
    const cards = [...phone!.querySelectorAll("article")];
    assert.deepEqual(buttons(cards[0]), ["Starten", "Fertig"], "Geplant");
    assert.deepEqual(buttons(cards[1]), ["Fertig"], "In Arbeit");
    assert.deepEqual(buttons(cards[3]), [], "Storniert");
    assert.ok([...desktop!.querySelectorAll("button")].some((b) => b.textContent === "Starten"), "auch im Raster (beim Überfahren)");
    await view?.unmount();
    const readOnly = await render("WeekView", { canEdit: false });
    assert.equal(readOnly.root.querySelectorAll("button").length, 0, "ohne Recht keine Knöpfe");
  });

  it("Lese-Dialog: Zeit, Status, Terminart, Fahrzeug, Kunde (nur Anzeigename), Arbeitsplatz und Notizen im Volltext; ohne Recht kein Bearbeiten-Knopf", async () => {
    const { AppointmentDetail } = await import("./appointment-detail");
    const row = await env.db.appointment.findFirstOrThrow({ where: { title: "Ölwechsel" } });
    const element = await AppointmentDetail({ id: row.id, view: "week", date: DAY, canEdit: false });
    assert.ok(element);
    view = await mount(await withRouter(await withProviders(element)));
    const text = (view.container.textContent ?? "").replace(/\s+/g, " ");
    for (const part of [/Ölwechsel/, /Mittwoch, 8\. Mai 2030/, /09:00–10:00/, /Geplant/, /Inspektion/, /B AB 1/, /Meier/, /Hebebühne 1/, /Kunde wartet\./, /Filter mitbringen/]) assert.match(text, part);
    assert.ok(!/anna@example\.com|0170/.test(text), "keine Kontaktdaten des Kunden");
    assert.ok(!view.container.querySelector("a[href*='edit=']"), "ohne Recht kein Bearbeiten-Knopf");
    assert.match(text, /fehlt das Recht/);
    assert.ok([...view.container.querySelectorAll("a")].some((a) => a.textContent === "Schließen" && a.getAttribute("href") === "/appointments?view=week&date=2030-05-08"));
  });

  it("Lese-Dialog mit Bearbeiten-Recht bietet „Bearbeiten“; ein unbekannter Termin zeigt nichts", async () => {
    const { AppointmentDetail } = await import("./appointment-detail");
    const row = await env.db.appointment.findFirstOrThrow({ where: { title: "Ölwechsel" } });
    const element = await AppointmentDetail({ id: row.id, view: "day", date: DAY, canEdit: true });
    assert.ok(element);
    view = await mount(await withRouter(await withProviders(element)));
    const edit = [...view.container.querySelectorAll("a")].find((a) => a.textContent === "Bearbeiten");
    assert.equal(edit?.getAttribute("href"), `/appointments?view=day&date=2030-05-08&edit=${row.id}`);
    assert.equal(await AppointmentDetail({ id: "gibt-es-nicht", view: "day", date: DAY, canEdit: true }), null);
  });
});

describe("Kalender: Raster", () => {
  it("jedes Zeitfenster ist ein Link mit Uhrzeit im Namen; genau einer ist Tab-Stopp – das jetzige (Mittwoch, 10:00)", async () => {
    const { desktop } = await render("WeekView");
    const slots = [...desktop!.querySelectorAll("a[data-slot]")];
    // 5 Tage (Woche ohne Wochenende); 8–15 Uhr (14 Uhr: der stornierte Termin verlängert das Raster) in 30-Minuten-Schritten = 14 Zeilen
    assert.equal(slots.length, 5 * 14);
    assert.ok(slots.every((s) => /Neuer Termin am/.test(s.getAttribute("aria-label") ?? "")));
    const stops = slots.filter((s) => s.getAttribute("tabindex") === "0");
    assert.equal(stops.length, 1, "ein Tab-Stopp");
    assert.equal(stops[0].getAttribute("data-col"), "2", "Mittwoch");
    assert.equal(stops[0].getAttribute("data-row"), "4", "10:00");
    assert.match(stops[0].getAttribute("href") ?? "", /at=2030-05-08T10%3A00/);
  });

  it("die Zeit läuft in CSS: `--min-px` wächst bei Touch bis ein Rasterschritt 44 px hoch ist; Fenster und Termine haben mindestens einen Rasterschritt", async () => {
    const { desktop } = await render("WeekView", { slot: 30, ssr: true });
    const grid = desktop!.firstElementChild as HTMLElement;
    assert.match(grid.getAttribute("style") ?? "", /--min-px: ?max\(calc\(var\(--tap-row\) \/ 30\), 0\.9333/);
    const slot = desktop!.querySelector("a[data-slot]") as HTMLElement;
    assert.match(slot.getAttribute("style") ?? "", /height: ?calc\(var\(--min-px\) \* 30\)/);
    // der 10-Minuten-Termin „Kurzer Check“ belegt einen ganzen Rasterschritt
    const short = [...desktop!.querySelectorAll("a[title]")].find((a) => /Kurzer Check/.test(a.getAttribute("title") ?? ""))!.parentElement as HTMLElement;
    assert.match(short.getAttribute("style") ?? "", /height: ?max\(calc\(var\(--min-px\) \* 30\), 22px\)/);
  });

  it("zwei kurze Termine hintereinander liegen nebeneinander in einer Spur, nicht übereinander", async () => {
    const { desktop } = await render("WeekView", { slot: 30, ssr: true });
    const blocks = ["Kurzer Check", "Nachkontrolle"].map((title) => [...desktop!.querySelectorAll("a[title]")].find((a) => (a.getAttribute("title") ?? "").includes(title))!.parentElement as HTMLElement);
    for (const block of blocks) assert.match(block.getAttribute("style") ?? "", /width: ?calc\(100% - 4px\)/, "volle Breite = eigene Spur");
  });

  it("ohne Recht zum Anlegen gibt es keine Zeitfenster (und keinen Hinweis dazu)", async () => {
    const { desktop, root } = await render("WeekView", { canCreate: false });
    assert.equal(desktop!.querySelector("a[data-slot]"), null);
    assert.equal(root.querySelector("#calendar-grid-hint"), null);
  });
});

describe("Kalender: Tastatur im Raster", () => {
  const press = (key: string) =>
    act(() => {
      const target = document.activeElement as HTMLElement;
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      pressed = event;
    });
  let pressed: Event | null = null;

  it("Pfeiltasten bewegen den Fokus durchs Raster (auf/ab = Zeit, links/rechts = Tag); der Tab-Stopp wandert mit", async () => {
    const { desktop } = await render("WeekView");
    const slot = (col: number, row: number) => desktop!.querySelector(`a[data-slot][data-col='${col}'][data-row='${row}']`) as HTMLElement;
    slot(2, 4).focus();
    await press("ArrowDown");
    assert.equal(document.activeElement, slot(2, 5));
    assert.equal(pressed?.defaultPrevented, true, "die Seite scrollt nicht");
    assert.equal(slot(2, 5).tabIndex, 0);
    assert.equal(slot(2, 4).tabIndex, -1, "genau ein Tab-Stopp");
    assert.equal([...desktop!.querySelectorAll("a[data-slot]")].filter((s) => s.getAttribute("tabindex") === "0").length, 1);
    await press("ArrowRight");
    assert.equal(document.activeElement, slot(3, 5));
    await press("ArrowUp");
    await press("ArrowLeft");
    assert.equal(document.activeElement, slot(2, 4));
  });

  it("Bild auf/ab springen eine Stunde-ish (vier Fenster), Pos1/Ende an den Rand der Spalte, am Rand bleibt der Fokus stehen", async () => {
    const { desktop } = await render("WeekView");
    const slot = (col: number, row: number) => desktop!.querySelector(`a[data-slot][data-col='${col}'][data-row='${row}']`) as HTMLElement;
    slot(0, 1).focus();
    await press("PageDown");
    assert.equal(document.activeElement, slot(0, 5));
    await press("End");
    assert.equal(document.activeElement, slot(0, 13));
    await press("ArrowDown");
    assert.equal(document.activeElement, slot(0, 13), "unten bleibt es stehen");
    assert.equal(pressed?.defaultPrevented, true, "auch am Rand scrollt die Seite nicht");
    await press("Home");
    assert.equal(document.activeElement, slot(0, 0));
    await press("ArrowLeft");
    assert.equal(document.activeElement, slot(0, 0));
  });

  it("andere Tasten (Tab, Buchstaben) und Tasten mit Strg/Alt gehören nicht dem Raster", async () => {
    const { desktop } = await render("WeekView");
    const first = desktop!.querySelector("a[data-slot][tabindex='0']") as HTMLElement;
    first.focus();
    await press("Tab");
    assert.equal(pressed?.defaultPrevented, false);
    assert.equal(document.activeElement, first);
    await act(() => {
      const event = new window.KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true, cancelable: true });
      first.dispatchEvent(event);
      pressed = event;
    });
    assert.equal(pressed?.defaultPrevented, false);
    assert.equal(document.activeElement, first);
  });
});

describe("Kalender: kleben (sticky) nur ohne Überlauf-Vorfahren", () => {
  const overflowing = (classes: string[]) => classes.filter((c) => /(^|\s)(overflow(-[xy])?-(auto|scroll|hidden)|overflow-clip)(\s|$)/.test(c));

  it("Raster, Wochenstreifen und Listenköpfe: kein Vorfahr bis zum Container setzt overflow", async () => {
    for (const name of ["WeekView", "DayView", "ListView"] as const) {
      const { root } = await render(name);
      const sticky = [...root.querySelectorAll("[class*='sticky']")].filter((el) => /(^|\s)sticky(\s|$)/.test(el.getAttribute("class") ?? "") && /top-\(--sticky-top\)/.test(el.getAttribute("class") ?? ""));
      assert.ok(sticky.length > 0, `${name}: es klebt etwas`);
      for (const el of sticky) assert.deepEqual(overflowing(ancestorClasses(el, root)), [], `${name}: Vorfahr mit overflow – ${el.getAttribute("class")}`);
      await view?.unmount();
      view = null;
    }
  });

  it("alle klebenden Elemente kleben unter der Kopfzeile (Token --sticky-top), auch der Tageskopf im Raster", async () => {
    const { desktop, phone } = await render("WeekView");
    assert.ok(desktop!.querySelector("[class*='top-(--sticky-top)']"), "Tageskopf");
    assert.ok(phone!.querySelector("nav[class*='top-(--sticky-top)']"), "Wochenstreifen");
  });

  it("Ausnahme: mit mehr als sechs Spalten scrollt das Raster seitlich (dann klebt der Kopf nur am Raster)", async () => {
    const { desktop } = await render("DayView", { bays: 6 }); // sechs Arbeitsplätze plus „Ohne Arbeitsplatz“
    assert.match(desktop!.firstElementChild?.getAttribute("class") ?? "", /overflow-x-auto/);
    const fit = await (async () => {
      await view?.unmount();
      return render("DayView", { bays: 5 }); // fünf plus „Ohne Arbeitsplatz“ = sechs Spalten passen
    })();
    assert.doesNotMatch(fit.desktop!.firstElementChild?.getAttribute("class") ?? "", /overflow/);
  });
});
