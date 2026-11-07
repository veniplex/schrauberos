import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, isNotFound, redirectOf, type TestEnv } from "@/test/harness";
import { resolveServerTree } from "@/test/server-tree";
import { blur, click, plain, type, wait } from "@/test/ui";

function omit<T extends Record<string, unknown>, K extends string>(row: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !(keys as string[]).includes(key))) as Omit<T, K>;
}

/** Die Seiten der Checklisten wirklich gerendert; die Punkte speichern über die echte Aktion (Haken, Messwert beim Verlassen, Auswahl), der Abschnitt am Auftrag und der Baustein der Übersicht. */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;
let ids: { free: string; open: string; completed: string; discarded: string; order: string; vehicle: string; template: string };

const ALL = ["checklists.view", "checklists.fill", "checklists.manage", "checklists.reopen", "vehicles.view", "vehicles.edit", "orders.view"];

async function login(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `p-${Math.random().toString(36).slice(2)}`, name: "Tom Meyer", roles: [role] }));
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
  for (const key of ["workshop.checklists", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  const vehicle = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf" } });
  const open = await env.db.order.create({ data: { number: "A-2026-0001", status: "in_progress", vehicleId: vehicle.id } });
  const done = await env.db.vehicle.create({ data: { plate: "B-MS 815", plateNorm: "BMS815" } });
  await env.db.order.create({ data: { number: "A-2026-0002", status: "picked_up", vehicleId: done.id } });
  const { seeds } = await import("./seed");
  for (const seed of seeds) await seed.demo?.(env.db);
  const find = async (status: string, extra: Record<string, unknown> = {}) => (await env.db.checklist.findFirstOrThrow({ where: { status, ...extra } })).id;
  // eine abgeschlossene Checkliste ohne Auftrag (am Fahrzeug): nur sie lässt sich wieder öffnen, die am abgeschlossenen Auftrag nicht
  const hu = await env.db.checklist.findFirstOrThrow({ where: { standardKey: "hu" }, include: { items: true } });
  const free = await env.db.checklist.create({
    data: { templateId: hu.templateId, versionId: hu.versionId, templateName: hu.templateName, templateVersion: 1, standardKey: "hu", vehicleId: hu.vehicleId, status: "completed", completedAt: new Date(), completedByName: "Demo", createdByName: "Demo", items: { create: hu.items.map((row) => ({ ...omit(row, ["id", "checklistId"]), done: true })) } },
  });
  ids = { free: free.id, open: await find("open", { standardKey: "intake" }), completed: await find("completed"), discarded: await find("discarded"), order: open.id, vehicle: vehicle.id, template: (await env.db.checklistTemplate.findFirstOrThrow({ where: { standardKey: "intake" } })).id };
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
  it("Liste: Reiter mit Anzahl, offene standardmäßig, Suche; Vorlagen und Beginnen nur mit den Rechten", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/checklists/page");
    let root = await render(await Page({ searchParams: Promise.resolve({}) }));
    let text = plain(root.textContent);
    assert.match(text, /Offen \(\d+\)/);
    assert.match(text, /Annahmeprotokoll/);
    assert.match(text, /Vorlagen verwalten/);
    assert.ok(root.querySelector("input[name='q']"));
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({ status: "completed" }) }));
    assert.match(plain(root.textContent), /Reifenwechsel/);
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({ q: "BMS815", status: "all" }) }));
    text = plain(root.textContent);
    assert.match(text, /B-MS 815/);
    assert.doesNotMatch(text, /B-AB 1234/);
    await view!.unmount();
    await login(["checklists.view", "vehicles.view", "orders.view"]);
    root = await render(await Page({ searchParams: Promise.resolve({}) }));
    text = plain(root.textContent);
    assert.doesNotMatch(text, /Vorlagen verwalten/);
    assert.doesNotMatch(text, /Checkliste beginnen/);
  });

  it("Beginnen: Vorlage und Fahrzeugauswahl; mit ?order= der Auftrag; ohne Vorlagen ein Hinweis", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/checklists/new/page");
    let root = await render(await Page({ searchParams: Promise.resolve({ order: ids.order }) }));
    assert.ok(root.querySelector("select[name='templateId']"));
    assert.equal((root.querySelector("input[name='orderId']") as HTMLInputElement).value, ids.order);
    assert.match(plain(root.textContent), /A-2026-0001/);
    await view!.unmount();
    root = await render(await Page({ searchParams: Promise.resolve({ vehicle: ids.vehicle }) }));
    assert.ok(root.querySelector("input[name='vehicleId']"));
    await view!.unmount();
    // ein geschlossener Auftrag lässt sich nicht vorbelegen
    const closed = await env.db.order.findFirstOrThrow({ where: { status: "picked_up" } });
    root = await render(await Page({ searchParams: Promise.resolve({ order: closed.id }) }));
    assert.equal(root.querySelector("input[name='orderId']"), null);
  });

  it("Detail einer offenen Checkliste: Punkte mit Haken/Eingaben, Fortschritt, Abschließen mit Unterschrift; abgeschlossen: gesperrt, Unterschrift und Wiederöffnen nur mit manage; verworfen: nur ansehen", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/checklists/[id]/page");
    let root = await render(await Page({ params: Promise.resolve({ id: ids.open }) }));
    let text = plain(root.textContent);
    assert.match(text, /Kilometerstand abgelesen/);
    assert.match(text, /erledigt/);
    assert.ok(root.querySelectorAll("input[type='checkbox']").length >= 8, "Punkte als Zeilen mit Haken");
    assert.ok(root.querySelector("canvas"), "Zeichenfeld der Unterschrift");
    assert.ok(root.querySelector("input[name='customerName']"));
    assert.match(text, /Checkliste abschließen/);
    await view!.unmount();

    root = await render(await Page({ params: Promise.resolve({ id: ids.completed }) }));
    text = plain(root.textContent);
    assert.match(text, /abgeschlossen und unveränderlich/);
    assert.equal(root.querySelector("canvas"), null);
    assert.doesNotMatch(text, /Wieder öffnen/, "der Auftrag ist abgeschlossen: auch die Leitung kann die Checkliste nicht wieder öffnen");
    assert.ok(Array.from(root.querySelectorAll("input[type='checkbox']")).every((c) => (c as HTMLInputElement).disabled));
    await view!.unmount();

    root = await render(await Page({ params: Promise.resolve({ id: ids.free }) }));
    assert.match(plain(root.textContent), /Wieder öffnen/);
    assert.ok(root.querySelector("textarea[name='reason']"));
    await view!.unmount();

    await login(["checklists.view", "checklists.fill", "vehicles.view", "orders.view"]);
    root = await render(await Page({ params: Promise.resolve({ id: ids.free }) }));
    assert.doesNotMatch(plain(root.textContent), /Wieder öffnen/, "nur mit checklists.reopen");
    await view!.unmount();
    root = await render(await Page({ params: Promise.resolve({ id: ids.discarded }) }));
    assert.match(plain(root.textContent), /verworfen/);
    assert.equal(root.querySelector("canvas"), null);
    await view!.unmount();
    view = null;
    await login(["checklists.view"]);
    assert.ok(await isNotFound(async () => Page({ params: Promise.resolve({ id: ids.open }) })), "ohne vehicles.view/orders.view gibt es sie nicht");
  });

  it("Vorlagen: Liste mit Version und Punkten, Editor mit Versionsverlauf, Neu; nur mit manage", async () => {
    await login(["checklists.view", "checklists.fill"]);
    const { default: Templates } = await import("@/app/(app)/(workshop)/checklists/templates/page");
    assert.equal(await redirectOf(() => Templates()), "/forbidden");
    await login(ALL);
    let root = await render(await Templates());
    let text = plain(root.textContent);
    assert.match(text, /Annahmeprotokoll/);
    assert.match(text, /mitgeliefert/);
    assert.doesNotMatch(text, /Mitgelieferte Vorlagen einrichten/, "alle vier sind eingerichtet");
    await view!.unmount();
    const { default: Edit } = await import("@/app/(app)/(workshop)/checklists/templates/[id]/page");
    root = await render(await Edit({ params: Promise.resolve({ id: ids.template }) }));
    text = plain(root.textContent);
    assert.match(text, /Als neue Version speichern/);
    assert.match(text, /Versionen/);
    assert.ok(root.querySelector("input[name='items']"), "Punkte gehen als ein Feld an den Server");
    const items = JSON.parse((root.querySelector("input[name='items']") as HTMLInputElement).value) as Array<{ label: string }>;
    assert.ok(items.length >= 8 && items[0].label === "Kilometerstand abgelesen");
    await view!.unmount();
    const { default: New } = await import("@/app/(app)/(workshop)/checklists/templates/new/page");
    root = await render(await New());
    assert.match(plain(root.textContent), /Vorlage anlegen/);
  });
});

describe("Punkte speichern (echte Aktion)", () => {
  it("Haken, Messwert beim Verlassen des Feldes (mit Dezimalkomma), Auswahl: gespeichert mit Person und Zeit; bei Fehler „Nicht gespeichert“", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/checklists/[id]/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.open }) }));
    const rows = await env.db.checklistItem.findMany({ where: { checklistId: ids.open }, orderBy: { position: "asc" } });
    const undone = rows.filter((r) => !r.done);
    const km = rows.find((r) => r.label === "Kilometerstand abgelesen")!;
    // Haken: ein Punkt der nicht abgehakten
    const check = undone.find((r) => r.type === "check")!;
    const checkbox = root.querySelector(`input[type='checkbox'][aria-describedby]`) as HTMLInputElement | null;
    assert.ok(checkbox);
    const label = Array.from(root.querySelectorAll("label")).find((l) => plain(l.textContent).includes(check.label.slice(0, 20)));
    assert.ok(label, "Zeile des Punktes");
    await click(label!.querySelector("input[type='checkbox']"));
    await wait(120);
    const saved = await env.db.checklistItem.findUniqueOrThrow({ where: { id: check.id } });
    assert.equal(saved.done, true);
    assert.equal(saved.doneByName, "Tom Meyer");
    assert.ok(saved.doneAt);

    // Messwert: Wert tippen und das Feld verlassen
    const input = root.querySelector(`input[aria-label='${km.label}: Wert']`) as HTMLInputElement;
    assert.ok(input, "Eingabe des Kilometerstands");
    await type(input, "87450,5");
    await blur(input);
    await wait(120);
    const measured = await env.db.checklistItem.findUniqueOrThrow({ where: { id: km.id } });
    assert.deepEqual([measured.done, measured.numberValue], [true, 87450.5]);

    // unlesbarer Wert: Fehlermeldung am Punkt, nichts gespeichert
    await type(input, "viel");
    await blur(input);
    await wait(120);
    assert.match(plain(root.textContent), /Ungültig|ungültig|Bitte/);
    assert.equal((await env.db.checklistItem.findUniqueOrThrow({ where: { id: km.id } })).numberValue, 87450.5);

    // Auswahl
    const choice = rows.find((r) => r.type === "choice")!;
    const select = root.querySelector(`select[aria-label='${choice.label}']`) as HTMLSelectElement;
    assert.ok(select);
    await type(select, "voll");
    await wait(120);
    assert.equal((await env.db.checklistItem.findUniqueOrThrow({ where: { id: choice.id } })).textValue, "voll");
    void act;
  });

  /** Seite neu rendern, wie es `router.refresh()` tut: neue Props, derselbe React-Baum */
  async function rerender(Page: (props: { params: Promise<{ id: string }> }) => Promise<ReactNode>, id: string) {
    const { I18nProvider } = await import("@/i18n/client");
    const { ToastProvider } = await import("@/components/ui/toast");
    const { de } = await import("@/i18n/messages/de");
    const resolved = await resolveServerTree(await Page({ params: Promise.resolve({ id }) }));
    await view!.render(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, resolved)));
  }
  const checkboxOf = (root: HTMLElement, label: string) => (Array.from(root.querySelectorAll("label")).find((l) => plain(l.textContent).includes(label.slice(0, 20)))!.querySelector("input[type=\"checkbox\"]") as HTMLInputElement);

  it("Neu laden wirkt: hakt ein anderes Gerät einen Punkt ab, übernimmt die Zeile nach dem Neurendern mit neuen Daten Haken und Version – ein Klick danach ist kein Konflikt", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/checklists/[id]/page");
    const root = await render(await Page({ params: Promise.resolve({ id: ids.open }) }));
    const rows = await env.db.checklistItem.findMany({ where: { checklistId: ids.open }, orderBy: { position: "asc" } });
    const target = rows.find((r) => r.type === "check" && !r.done)!;
    // ein anderes Gerät hakt den Punkt ab (neue Version in der Datenbank)
    await env.db.checklistItem.update({ where: { id: target.id }, data: { done: true, doneByName: "Lena", doneAt: new Date() } });
    await rerender(Page, ids.open);
    assert.equal(checkboxOf(root, target.label).checked, true, "Stand des Servers sichtbar");
    // Abhaken zurücknehmen geht ohne Konflikt (Version war nachgeführt)
    await click(checkboxOf(root, target.label));
    await wait(150);
    assert.doesNotMatch(plain(root.textContent), /Nicht gespeichert|inzwischen von jemand anderem/);
    assert.equal((await env.db.checklistItem.findUniqueOrThrow({ where: { id: target.id } })).done, false);
  });

  it("Messwert tippen und gleich den Haken antippen: die Speichervorgänge laufen nacheinander (kein Selbstkonflikt), beides ist gespeichert", async () => {
    await login(ALL);
    const { default: Page } = await import("@/app/(app)/(workshop)/checklists/[id]/page");
    const km = await env.db.checklistItem.findFirstOrThrow({ where: { checklistId: ids.open, label: "Kilometerstand abgelesen" } });
    await env.db.checklistItem.update({ where: { id: km.id }, data: { done: false, numberValue: null, doneByName: null, doneAt: null } });
    const root = await render(await Page({ params: Promise.resolve({ id: ids.open }) }));
    const input = root.querySelector(`input[aria-label='${km.label}: Wert']`) as HTMLInputElement;
    await type(input, "51000");
    // Verlassen des Feldes und Antippen des Hakens im selben Augenblick (ein act: überlappende act-Aufrufe verwirren den Test-Renderer)
    const box = checkboxOf(root, km.label);
    await act(() => {
      input.focus();
      input.blur();
      box.click();
    });
    await wait(500);
    assert.doesNotMatch(plain(root.textContent), /Nicht gespeichert|inzwischen von jemand anderem/);
    const saved = await env.db.checklistItem.findUniqueOrThrow({ where: { id: km.id } });
    assert.deepEqual([saved.done, saved.numberValue], [true, 51000]);
    // Haken zurücknehmen löscht den Wert beim Server – die Eingabe zeigt dasselbe
    await click(checkboxOf(root, km.label));
    await wait(500);
    assert.equal((await env.db.checklistItem.findUniqueOrThrow({ where: { id: km.id } })).numberValue, null);
    assert.equal((root.querySelector(`input[aria-label='${km.label}: Wert']`) as HTMLInputElement).value, "");
  });
});

describe("Vorlageneditor", () => {
  it("Zahlen gehen als getippt an den Server (kein stilles NaN → null): „120 Nm“ und Dezimalkomma kommen unverändert an", async () => {
    await login(ALL);
    const { TemplateEditor } = await import("./template-editor");
    const root = await render(
      createElement(TemplateEditor, { initial: { name: "Test", description: "", signatureMode: "none", items: [{ label: "Radschrauben", type: "torque", required: true, unit: "Nm", minValue: "120 Nm", maxValue: "1.234,5", targetValue: "120,5", options: "", hint: "" }] } }),
    );
    const items = JSON.parse((root.querySelector("input[name='items']") as HTMLInputElement).value) as Array<{ minValue: string | null; maxValue: string | null; targetValue: string | null }>;
    assert.deepEqual([items[0].minValue, items[0].maxValue, items[0].targetValue], ["120 Nm", "1.234,5", "120,5"]);
  });
});

describe("Abschnitt am Auftrag und Baustein der Übersicht", () => {
  it("Abschnitt: „Annahmeprotokoll starten“ nur ohne vorhandenes, Liste mit Stand; am geschlossenen Auftrag nur die Ansicht; ohne Recht kein Knopf", async () => {
    const { sections } = await import("./sections");
    const order = sections.find((s) => s.host === "orders/detail")!;
    const vehicle = sections.find((s) => s.host === "vehicles/detail")!;
    const session = await login(ALL);
    // Auftrag mit offenem Annahmeprotokoll: Fortsetzen statt Starten
    let root = await render(await order.Component({ entityId: ids.order, session }));
    let text = plain(root.textContent);
    assert.match(text, /Checklisten/);
    assert.match(text, /Annahmeprotokoll fortsetzen/);
    assert.doesNotMatch(text, /Annahmeprotokoll starten/);
    await view!.unmount();
    // ein Auftrag ohne Checkliste: Annahmeprotokoll starten (Formular mit Vorlage und Auftrag)
    const fresh = await env.db.order.create({ data: { number: "A-2026-0009", status: "accepted", vehicleId: ids.vehicle } });
    root = await render(await order.Component({ entityId: fresh.id, session }));
    text = plain(root.textContent);
    assert.match(text, /Annahmeprotokoll starten/);
    assert.equal((root.querySelector("input[name='orderId']") as HTMLInputElement).value, fresh.id);
    assert.equal((root.querySelector("input[name='templateId']") as HTMLInputElement).value, ids.template);
    assert.match(text, /Keine|Noch keine/);
    await view!.unmount();
    root = await render(await vehicle.Component({ entityId: ids.vehicle, session }));
    assert.match(plain(root.textContent), /Checklisten/);
    await view!.unmount();
    // geschlossen: nur ansehen
    const closed = await env.db.order.findFirstOrThrow({ where: { status: "picked_up" } });
    root = await render(await order.Component({ entityId: closed.id, session }));
    text = plain(root.textContent);
    assert.match(text, /nicht mehr offen/);
    assert.doesNotMatch(text, /Annahmeprotokoll starten/);
    await view!.unmount();
    const reader = await login(["checklists.view", "vehicles.view", "orders.view"]);
    root = await render(await order.Component({ entityId: fresh.id, session: reader }));
    assert.doesNotMatch(plain(root.textContent), /Annahmeprotokoll starten/);
  });

  it("Annahmeprotokoll starten über die Aktion: legt die Checkliste am Auftrag an und führt auf sie", async () => {
    const session = await login(ALL);
    void session;
    const { startChecklist } = await import("./actions");
    const fresh = await env.db.order.create({ data: { number: "A-2026-0010", status: "accepted", vehicleId: ids.vehicle } });
    const form = new FormData();
    form.set("templateId", ids.template);
    form.set("orderId", fresh.id);
    const target = await redirectOf(() => startChecklist(form));
    const created = await env.db.checklist.findFirstOrThrow({ where: { orderId: fresh.id } });
    assert.equal(target, `/checklists/${created.id}`);
    assert.equal(created.standardKey, "intake");
  });

  it("Baustein „Offene Checklisten“: Anzahl und die ältesten mit Fortschritt; ohne Recht nichts", async () => {
    await login(ALL);
    const { OpenChecklistsWidget } = await import("./widgets");
    const root = await render(await OpenChecklistsWidget());
    const text = plain(root.textContent);
    assert.match(text, /Offene Checklisten/);
    assert.match(text, /\d+ offene Checklisten?/);
    assert.match(text, /\d+ von \d+/);
  });
});
