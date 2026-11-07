import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { addDaysToKey, dayKey } from "@/lib/zone";
import { installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { click, plain, wait } from "@/test/ui";

/** Die Seiten der Zeiterfassung wirklich gerendert (Server-Komponenten aufgelöst), der Stempel-Bereich im echten Renderer mit echter Aktion, der Abschnitt „Zeiten“ am Auftrag. */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
let entryId: string;
let foreignId: string;
let orderId: string;

const ALL = ["time.view", "time.stamp", "time.correct", "time.viewAll", "time.correctAll", "orders.view", "orders.edit", "orders.prices", "settings.manage"];

async function login(permissions: readonly string[], employee = true) {
  const role = await env.role({ permissions });
  env.signOut();
  const user = await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, roles: [role] });
  if (employee) await env.db.employee.create({ data: { firstName: "Tom", lastName: `Meyer${Math.random().toString(36).slice(2, 6)}`, userId: user.id } });
  await env.signIn(user);
  return user;
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
  for (const key of ["office.time", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  await env.db.workshop.upsert({ where: { id: "default" }, update: { hourlyRateCents: 9000 }, create: { id: "default", hourlyRateCents: 9000 } });
  const vehicle = await env.db.vehicle.create({ data: { plate: "B-ZT 1", plateNorm: "BZT1" } });
  orderId = (await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId: vehicle.id } })).id;
  const other = await env.db.employee.create({ data: { firstName: "Lena", lastName: "Hoffmann" } });
  const { parseZoned } = await import("@/lib/zone");
  const day = addDaysToKey(dayKey(new Date()), -1);
  foreignId = (await env.db.timeEntry.create({ data: { employeeId: other.id, orderId, startedAt: parseZoned(day, "08:00")!, endedAt: parseZoned(day, "12:00")!, activity: "Fremd" } })).id;
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

describe("Seiten", () => {
  it("Heute: Stempel-Knopf, Wochenübersicht mit Ist/Soll/Saldo; ohne Mitarbeiterprofil ein Hinweis statt des Knopfes", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(office)/time/page");
    let root = await render(await Page({ searchParams: Promise.resolve({}) }));
    let text = plain(root.textContent);
    assert.match(text, /Kommen/);
    assert.match(text, /Ist/);
    assert.match(text, /Soll/);
    assert.match(text, /Saldo/);
    assert.ok(root.querySelector("select#stamp-order"), "Auftragsauswahl");
    assert.match(text, /Team/, "Reiter Team nur mit time.viewAll");
    await view!.unmount();
    await login(["time.view", "time.stamp"], false);
    root = await render(await Page({ searchParams: Promise.resolve({}) }));
    text = plain(root.textContent);
    assert.match(text, /noch kein Mitarbeiter verknüpft/);
    assert.equal(root.querySelector("button.btn-primary"), null);
    assert.doesNotMatch(text, /Team/);
  });

  it("Stempeln in der Oberfläche: Antippen bucht (Aktion mit Schlüssel), die Seite zeigt danach „Gehen“; ein Fehler zeigt „Nicht gebucht“", async () => {
    const user = await login(ALL);
    const { default: Page } = await import("@/app/(app)/(office)/time/page");
    let root = await render(await Page({ searchParams: Promise.resolve({}) }));
    await click(root.querySelector("button.btn"));
    await wait(80);
    const entry = await env.db.timeEntry.findFirstOrThrow({ where: { employee: { userId: user.id } } });
    assert.ok(entry.runningKey && entry.startKey, "gestempelt, mit Schlüssel");
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({}) }));
    assert.match(plain(root.textContent), /Gehen/);
    assert.match(plain(root.textContent), /Läuft seit/);
    await click(root.querySelector("button.btn"));
    await wait(80);
    assert.ok((await env.db.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).endedAt);
    // Fehler (nichts läuft mehr, aber die Oberfläche zeigt noch „Gehen“): „Nicht gebucht“ – nach dem Cooldown des Knopfes
    await wait(1700);
    await click(root.querySelector("button.btn"));
    await wait(80);
    assert.match(plain(root.textContent), /Nicht gebucht|nicht gebucht/i);
  });

  it("Einträge: eigene Zeiten, mit viewAll auch fremde; Detailseite mit Korrekturformular und Verlauf; fremde Seite ohne Recht ist 404", async () => {
    const user = await login(["time.view", "time.stamp", "time.correct"]);
    const employee = await env.db.employee.findFirstOrThrow({ where: { userId: user.id } });
    const { parseZoned } = await import("@/lib/zone");
    const day = addDaysToKey(dayKey(new Date()), -2);
    entryId = (await env.db.timeEntry.create({ data: { employeeId: employee.id, startedAt: parseZoned(day, "08:00")!, endedAt: parseZoned(day, "16:00")!, activity: "Eigen", source: "manual" } })).id;
    await env.db.timeCorrection.create({ data: { entryId, kind: "create", reason: "Vergessen zu stempeln", byName: "Tom" } });

    const { default: Entries } = await import("@/app/(app)/(office)/time/entries/page");
    let root = await render(await Entries({ searchParams: Promise.resolve({ from: day, to: dayKey(new Date()) }) }));
    let text = plain(root.textContent);
    assert.match(text, /Eigen/);
    assert.doesNotMatch(text, /Fremd/);
    await view!.unmount();

    const { default: Detail } = await import("@/app/(app)/(office)/time/entries/[id]/page");
    root = await render(await Detail({ params: Promise.resolve({ id: entryId }) }));
    text = plain(root.textContent);
    assert.match(text, /Korrekturverlauf/);
    assert.match(text, /Vergessen zu stempeln/);
    assert.ok(root.querySelector("textarea[name='reason']"), "Begründung ist Pflichtfeld des Formulars");
    assert.ok(root.querySelector("input[name='version']"));
    await view!.unmount();
    view = null;
    assert.ok(await isNotFound(async () => Detail({ params: Promise.resolve({ id: foreignId }) })), "fremder Eintrag ohne time.viewAll");

    await login(ALL);
    root = await render(await Entries({ searchParams: Promise.resolve({ from: day, to: dayKey(new Date()) }) }));
    assert.match(plain(root.textContent), /Fremd/);
    assert.ok(root.querySelector("select[name='employee']"), "Mitarbeiter-Filter");
  });

  it("Team: nur mit time.viewAll; Nachtragen-Seite; Zeiten anderer korrigieren verlangt time.correctAll", async () => {
    await login(["time.view", "time.correct"]);
    const { default: Team } = await import("@/app/(app)/(office)/time/team/page");
    const redirected = await redirectOf(() => Team({ searchParams: Promise.resolve({}) }));
    assert.equal(redirected, "/forbidden");
    await login(ALL);
    let root = await render(await Team({ searchParams: Promise.resolve({}) }));
    assert.match(plain(root.textContent), /Team/);
    await view!.unmount();
    const { default: New } = await import("@/app/(app)/(office)/time/entries/new/page");
    root = await render(await New());
    assert.ok(root.querySelector("select[name='employeeId']"), "Auswahl des Mitarbeiters nur mit time.correctAll");
    assert.ok(root.querySelector("textarea[name='reason']"));
  });
});

describe("Abschnitt „Zeiten“ am Auftrag", () => {
  it("zeigt die Summe, die eigenen Zeilen und – mit orders.prices – „Zeiten als Positionen übernehmen“; ohne Stundensatz ein Hinweis", async () => {
    await login(ALL);
    const { sections } = await import("./sections");
    const section = sections[0];
    const session = await (await import("@/server/auth/session")).getSession();
    let root = await render(await section.Component({ entityId: orderId, session: session! }));
    let text = plain(root.textContent);
    assert.match(text, /Zeiten/);
    assert.match(text, /4:00/);
    assert.match(text, /Zeiten als Positionen übernehmen/);
    assert.ok(root.querySelector("select[name='unit']"));
    await view!.unmount();
    await env.db.workshop.update({ where: { id: "default" }, data: { hourlyRateCents: null } });
    root = await render(await section.Component({ entityId: orderId, session: session! }));
    text = plain(root.textContent);
    assert.doesNotMatch(text, /Zeiten als Positionen übernehmen/);
    assert.match(text, /Stundensatz/);
    await env.db.workshop.update({ where: { id: "default" }, data: { hourlyRateCents: 9000 } });
    await view!.unmount();
    // ohne Preise: keine Übernahme
    await login(["time.view", "orders.view", "orders.edit"]);
    const plainSession = await (await import("@/server/auth/session")).getSession();
    root = await render(await section.Component({ entityId: orderId, session: plainSession! }));
    assert.doesNotMatch(plain(root.textContent), /Zeiten als Positionen übernehmen/);
    assert.match(plain(root.textContent), /keine eigenen/, "fremde Zeilen sind verborgen, die Summe nicht");
  });

  it("Hinweis vor dem Abschließen (orders/close): nennt laufende und nicht übernommene Zeiten, sperrt nichts, schweigt ohne offene Zeiten", async () => {
    await login(ALL);
    const { sections } = await import("./sections");
    const hint = sections.find((section) => section.host === "orders/close")!;
    const session = (await (await import("@/server/auth/session")).getSession())!;
    let root = await render(await hint.Component({ entityId: orderId, session }));
    assert.match(plain(root.textContent), /4:00 Stunden Arbeitszeit sind noch nicht als Positionen übernommen/);
    assert.match(plain(root.textContent), /Wieder öffnen/);
    await view!.unmount();
    const vehicle = await env.db.vehicle.create({ data: { plate: "B-ZT 2", plateNorm: "BZT2" } });
    const quiet = await env.db.order.create({ data: { number: "A-2026-0002", status: "in_progress", vehicleId: vehicle.id } });
    root = await render(await hint.Component({ entityId: quiet.id, session }));
    assert.equal(plain(root.textContent), "");
  });

  it("Korrekturformular ohne Auftragsauswahl (Aufträge aus oder ohne Recht) behält den Auftrag über ein verstecktes Feld", async () => {
    const { CorrectForm } = await import("./entry-forms");
    const initial = { startDate: "2026-01-02", startTime: "08:00", endDate: "2026-01-02", endTime: "09:00", breakMinutes: "0", orderId: "order-1", activity: "", note: "" };
    let root = await render(createElement(CorrectForm, { id: "e1", version: "v", initial, orders: [], running: false, cancelHref: "/time" }));
    assert.equal((root.querySelector("input[name=\"orderId\"]") as HTMLInputElement | null)?.value, "order-1");
    assert.equal(root.querySelector("select[name=\"orderId\"]"), null);
    await view!.unmount();
    root = await render(createElement(CorrectForm, { id: "e1", version: "v", initial, orders: [{ id: "order-1", label: "A-1" }], running: false, cancelHref: "/time" }));
    assert.ok(root.querySelector("select[name=\"orderId\"]"));
    assert.equal(root.querySelector("input[name=\"orderId\"]"), null);
  });
});
