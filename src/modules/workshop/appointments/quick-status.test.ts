import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createElement, type ComponentType, type ReactElement } from "react";
import { versionOf } from "@/lib/concurrency";
import { act, installDom, mount, sleep, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Schnellstatus-Knöpfe und der Vorschlag „Satz ein-/ausbuchen?“ in einem echten Renderer – mit der echten Aktion und der echten Datenbank:
 * Die Knöpfe richten sich nach dem Status, der Klick ändert genau den Status (Version wird mitgesendet), ein Konflikt kommt als Fehler-Toast, und der Vorschlag
 * erscheint erst nach „Fertig“ – gebucht wird erst auf die Bestätigung.
 */
let env: TestEnv;
let dom: TestDom;
let view: MountedView | null = null;
let carId: string;

before(async () => {
  env = await createTestEnv();
  dom = installDom();
  carId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } })).id;
});
after(async () => {
  await dom.close();
  env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});
beforeEach(async () => {
  await env.db.appointment.deleteMany();
  await env.db.tireSet.deleteMany();
  await env.db.auditLog.deleteMany();
  env.browser.reset();
  env.signOut();
});

const login = async (permissions: string[]) => env.signIn(await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] }));
const makeAppointment = (status = "scheduled", tireSetId?: string) =>
  env.db.appointment.create({
    data: { title: "Reifenwechsel", status, startsAt: new Date("2030-05-06T08:00:00"), endsAt: new Date("2030-05-06T09:00:00"), vehicleId: carId, tireSetId },
  });

type Parts = { QuickStatus: ComponentType<Record<string, unknown>>; TireStockPrompt: ComponentType<Record<string, unknown>> };

async function render(element: (parts: Parts) => ReactElement) {
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("@/components/ui/toast");
  const { de } = await import("@/i18n/messages/de");
  const parts: Parts = {
    QuickStatus: (await import("./quick-status")).QuickStatus as never,
    TireStockPrompt: (await import("@/modules/workshop/tires/stock-prompt")).TireStockPrompt as never,
  };
  view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(ToastProvider, null, element(parts))));
  const root = view.container;
  const button = (label: RegExp) => [...root.querySelectorAll("button")].find((b) => label.test(b.getAttribute("aria-label") ?? b.textContent ?? "")) as HTMLButtonElement | undefined;
  const toasts = () => [...document.querySelectorAll("[data-flash]")].map((n) => `${n.getAttribute("data-flash")}: ${n.textContent}`);
  return { root, button, toasts };
}

function plain(a: { id: string; updatedAt: Date; title: string }, status: string) {
  return function renderQuickStatus(parts: Parts) {
    return createElement(parts.QuickStatus, { id: a.id, version: versionOf(a), status, title: a.title });
  };
}

describe("QuickStatus", () => {
  it("zeigt je Status die möglichen Schritte: Geplant/Bestätigt Starten + Fertig, In Arbeit nur Fertig, sonst nichts", async () => {
    await login(["appointments.edit"]);
    for (const [status, expected] of [
      ["scheduled", ["Starten", "Fertig"]],
      ["confirmed", ["Starten", "Fertig"]],
      ["in_progress", ["Fertig"]],
      ["done", []],
      ["cancelled", []],
      ["no_show", []],
    ] as const) {
      const a = await makeAppointment(status);
      const { root } = await render(plain(a, status));
      assert.deepEqual([...root.querySelectorAll("button")].map((b) => b.textContent), expected, status);
      await view?.unmount();
      view = null;
    }
  });

  it("die Knöpfe tragen den Termin im Namen („Starten: Reifenwechsel“), damit gleiche Knöpfe in Listen unterscheidbar sind", async () => {
    await login(["appointments.edit"]);
    const a = await makeAppointment();
    const { button } = await render(plain(a, a.status));
    assert.ok(button(/^Starten: Reifenwechsel$/));
    assert.ok(button(/^Fertig: Reifenwechsel$/));
  });

  it("„Starten“ setzt In Arbeit (nur der Status), meldet es als Toast und protokolliert", async () => {
    await login(["appointments.edit"]);
    const a = await makeAppointment();
    const { button, toasts } = await render(plain(a, a.status));
    await act(() => button(/^Starten/)!.click());
    await sleep(80);
    const row = await env.db.appointment.findUniqueOrThrow({ where: { id: a.id } });
    assert.deepEqual([row.status, row.title], ["in_progress", a.title]);
    assert.ok(toasts().some((t) => /success.*gestartet/.test(t)), toasts().join("|"));
    assert.equal(await env.db.auditLog.count({ where: { action: "appointment.status" } }), 1);
  });

  it("ein Konflikt (inzwischen geändert) kommt als Fehler-Toast, der Termin bleibt wie er ist", async () => {
    await login(["appointments.edit"]);
    const a = await makeAppointment();
    const { button, toasts } = await render(plain(a, a.status));
    await env.db.appointment.update({ where: { id: a.id }, data: { notes: "jemand war schneller" } });
    await act(() => button(/^Fertig/)!.click());
    await sleep(80);
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status, "scheduled");
    assert.ok(toasts().some((t) => t.startsWith("error:")), toasts().join("|"));
  });
});

describe("Vorschlag „Satz ein-/ausbuchen?“ nach „Fertig“", () => {
  const setup = async (setStatus: string) => {
    await login(["appointments.edit", "tires.stock"]);
    const set = await env.db.tireSet.create({ data: { vehicleId: carId, season: "winter", status: setStatus } });
    const a = await makeAppointment("in_progress", set.id);
    const ui = await render((parts) =>
      createElement(parts.QuickStatus, {
        id: a.id,
        version: versionOf(a),
        status: a.status,
        title: a.title,
        prompt: createElement(parts.TireStockPrompt, { id: set.id, version: versionOf(set), status: set.status, label: "B AB 1 · Winter" }),
      }),
    );
    return { set, a, ...ui };
  };
  const dialog = (root: HTMLElement) => root.querySelector("dialog") as HTMLDialogElement | null;
  const inDialog = (root: HTMLElement, label: RegExp) => [...(dialog(root)?.querySelectorAll("button") ?? [])].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement;
  const setOf = (id: string) => env.db.tireSet.findUniqueOrThrow({ where: { id } });

  it("vor „Fertig“ erscheint nichts; danach fragt der Dialog (gelagerter Satz: ausbuchen), gebucht ist noch nichts", async () => {
    const { root, button, set } = await setup("stored");
    assert.equal(dialog(root), null);
    await act(() => button(/^Fertig/)!.click());
    await sleep(80);
    assert.ok(dialog(root)?.open, "Vorschlag erscheint");
    assert.match(dialog(root)?.textContent ?? "", /Satz jetzt ausbuchen\?/);
    assert.match(dialog(root)?.textContent ?? "", /B AB 1 · Winter/);
    assert.equal((await setOf(set.id)).status, "stored", "kein Auto-Buchen");
  });

  it("„Später“ lässt den Satz unberührt, „Ausbuchen“ bucht ihn (mit Version) und protokolliert", async () => {
    const first = await setup("stored");
    await act(() => first.button(/^Fertig/)!.click());
    await sleep(80);
    await act(() => inDialog(first.root, /^Später$/).click());
    assert.equal(dialog(first.root), null);
    assert.equal((await setOf(first.set.id)).status, "stored");
    await view?.unmount();
    view = null;

    const second = await setup("stored");
    await act(() => second.button(/^Fertig/)!.click());
    await sleep(80);
    await act(() => inDialog(second.root, /^Ausbuchen$/).click());
    await sleep(120);
    assert.equal((await setOf(second.set.id)).status, "mounted");
    assert.equal(await env.db.auditLog.count({ where: { action: "tires.stock" } }), 1);
    assert.equal(dialog(second.root), null, "der Dialog bleibt nach der Buchung zu");
  });

  it("ein ausgelagerter Satz wird zum Einbuchen vorgeschlagen und dann wieder ins Lager gebucht", async () => {
    const { root, button, set } = await setup("mounted");
    await act(() => button(/^Fertig/)!.click());
    await sleep(80);
    assert.match(dialog(root)?.textContent ?? "", /Satz jetzt einbuchen\?/);
    await act(() => inDialog(root, /^Einbuchen$/).click());
    await sleep(120);
    assert.equal((await setOf(set.id)).status, "stored");
  });

  it("hat jemand den Satz inzwischen umgebucht, meldet die Bestätigung den Konflikt statt doppelt zu buchen", async () => {
    const { root, button, set, toasts } = await setup("stored");
    await act(() => button(/^Fertig/)!.click());
    await sleep(80);
    await env.db.tireSet.update({ where: { id: set.id }, data: { status: "mounted" } });
    await act(() => inDialog(root, /^Ausbuchen$/).click());
    await sleep(120);
    assert.equal((await setOf(set.id)).status, "mounted");
    assert.equal(await env.db.auditLog.count({ where: { action: "tires.stock" } }), 0);
    assert.ok(toasts().some((t) => t.startsWith("error:")), toasts().join("|"));
  });

  it("ein entsorgter Satz bekommt keinen Vorschlag", async () => {
    const { root, button } = await setup("disposed");
    await act(() => button(/^Fertig/)!.click());
    await sleep(80);
    assert.equal(dialog(root), null);
  });
});

describe("AppointmentQuickStatus (Server-Teil: Rechte und Vorschlag)", () => {
  const set = { id: "s1", status: "stored", season: "winter", brand: "Conti", width: 205, aspect: 55, rim: 16, loadIndex: null, speedIndex: null, updatedAt: new Date("2030-01-01"), vehicle: { plate: "B AB 1" } };
  const appointment = (status: string, tireSet: typeof set | null = set) => ({ id: "a1", title: "Wechsel", status, updatedAt: new Date("2030-01-02"), tireSet });

  const build = async (a: ReturnType<typeof appointment>, flags: { canEdit: boolean; canStock: boolean }) => {
    const { AppointmentQuickStatus } = await import("./appointment-quick-status");
    const { createTranslator } = await import("@/i18n/translate");
    const { de } = await import("@/i18n/messages/de");
    const i18n = createTranslator("de", de as never);
    return AppointmentQuickStatus({ a, ...flags, i18n } as never) as ReactElement<{ prompt?: ReactElement<Record<string, unknown>>; version: string }> | null;
  };

  it("ohne appointments.edit oder ohne mögliche Schritte entsteht nichts", async () => {
    assert.equal(await build(appointment("scheduled"), { canEdit: false, canStock: true }), null);
    assert.equal(await build(appointment("done"), { canEdit: true, canStock: true }), null);
    assert.equal(await build(appointment("cancelled"), { canEdit: true, canStock: true }), null);
  });

  it("der Vorschlag entsteht nur mit tires.stock und einem buchbaren verknüpften Satz – mit dessen Version und Bezeichnung", async () => {
    const withPrompt = await build(appointment("in_progress"), { canEdit: true, canStock: true });
    assert.equal(withPrompt?.props.prompt?.props.id, "s1");
    assert.equal(withPrompt?.props.prompt?.props.version, String(set.updatedAt.getTime()));
    assert.match(String(withPrompt?.props.prompt?.props.label), /^B AB 1 · Winter · Conti · 205\/55 R16$/);
    assert.equal((await build(appointment("in_progress"), { canEdit: true, canStock: false }))?.props.prompt, undefined, "ohne tires.stock kein Vorschlag");
    assert.equal((await build(appointment("in_progress", null), { canEdit: true, canStock: true }))?.props.prompt, undefined, "ohne verknüpften Satz kein Vorschlag");
    assert.equal((await build(appointment("in_progress", { ...set, status: "disposed" }), { canEdit: true, canStock: true }))?.props.prompt, undefined, "entsorgt: kein Vorschlag");
  });
});
