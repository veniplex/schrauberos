import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { click, mountI18n as mountPlain, plain, type } from "@/test/ui";

/** Formulare der Aufträge in einem echten Renderer: Freigabe (Art wechselt zwischen Unterschrift und Telefon), Positionen (Art je Position, Werkzeug-Platz), Auftrag annehmen. */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;

/** Mit Übersetzer und Toast-Rahmen (die Formulare brauchen beides). */
async function mountI18n(element: ReturnType<typeof createElement>) {
  const { ToastProvider } = await import("@/components/ui/toast");
  return mountPlain(createElement(ToastProvider, null, element));
}
before(async () => {
  dom = installDom();
  env = await createTestEnv();
});
after(async () => {
  await dom.close();
  await env.cleanup();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

describe("ApprovalForm", () => {
  it("zeigt standardmäßig das Zeichenfeld, bei „Telefonisch“ nur den Hinweis; Betrag, Person und Begründung sind Pflichtfelder des Formulars", async () => {
    const { ApprovalForm } = await import("./approval-form");
    view = await mountI18n(createElement(ApprovalForm, { id: "o1" }));
    const root = view.container;
    assert.ok(root.querySelector("input[name='signature']"), "Unterschriftsfeld");
    assert.ok(root.querySelector("canvas"), "Zeichenfeld");
    assert.equal((root.querySelector("input[name='id']") as HTMLInputElement).value, "o1");
    for (const name of ["amount", "approverName", "reason", "method"]) assert.ok(root.querySelector(`[name='${name}']`), name);
    const method = root.querySelector("select[name='method']") as HTMLSelectElement;
    await type(method, "phone");
    assert.equal(root.querySelector("input[name='signature']"), null, "kein Unterschriftsfeld mehr");
    assert.match(plain(root.textContent), /telefonische Freigabe wird mit dem Namen/);
    // der Entwurf enthält nie die Unterschrift
    assert.equal(root.querySelector("input[name='signature']"), null);
  });
});

describe("OrderItemsForm", () => {
  const items = [
    { description: "Inspektion", unit: "Std.", quantityMilli: 1500, unitCents: 8500, taxBp: 1900, discountBp: 0, kind: "labor" },
    { description: "Ölfilter", unit: "Stk", quantityMilli: 1000, unitCents: 1250, taxBp: 1900, discountBp: 0, kind: "part", refType: "article", refId: "a1" },
  ];

  it("Positionen-Editor mit Art je Position (Arbeit/Teil/Sonstiges), Verweis im Absendefeld und Platz für Werkzeuge anderer Funktionen", async () => {
    const { OrderItemsForm } = await import("./items-form");
    view = await mountI18n(createElement(OrderItemsForm, { id: "o1", version: "1", items, exempt: false, tools: createElement("p", { "data-tool": "" }, "Artikel einfügen") }));
    const root = view.container;
    assert.ok(root.querySelector("[data-tool]"), "Werkzeug-Platz");
    const submitted = JSON.parse((root.querySelector("input[name='items']") as HTMLInputElement).value) as Array<Record<string, unknown>>;
    assert.deepEqual(submitted.map((i) => i.kind), ["labor", "part"]);
    assert.deepEqual([submitted[1].refType, submitted[1].refId], ["article", "a1"]);
    const kindSelects = Array.from(root.querySelectorAll("select")).filter((s) => Array.from(s.options).some((o) => o.value === "part"));
    assert.equal(kindSelects.length, 2);
    assert.deepEqual(Array.from(kindSelects[0].options).map((o) => o.textContent), ["Arbeit", "Teil", "Sonstiges"]);
    assert.equal((root.querySelector("input[name='version']") as HTMLInputElement).value, "1");
  });

  it("ein eingefügter Artikel (Ereignis) wird zur Position mit Verweis", async () => {
    const { OrderItemsForm } = await import("./items-form");
    const { LINE_ITEM_ADD_EVENT } = await import("@/lib/line-items");
    view = await mountI18n(createElement(OrderItemsForm, { id: "o1", version: "1", items: [], exempt: false }));
    await act(() => void window.dispatchEvent(new window.CustomEvent(LINE_ITEM_ADD_EVENT, { detail: { name: "items", row: { description: "Bremsscheibe", unit: "Stk", unitPrice: "49,90", taxRate: "19", kind: "part", refType: "article", refId: "b2" } } })));
    const submitted = JSON.parse((view.container.querySelector("input[name='items']") as HTMLInputElement).value) as Array<Record<string, unknown>>;
    assert.deepEqual([submitted[0].description, submitted[0].kind, submitted[0].refId, submitted[0].unitCents], ["Bremsscheibe", "part", "b2", 4990]);
  });
});

describe("OrderForm", () => {
  it("Anlegen: Fahrzeugauswahl, Kundenwunsch und Kilometerstand; aus einem Termin mit versteckter Termin-Kennung; Bearbeiten: Fahrzeug fest, Version", async () => {
    const { OrderForm } = await import("./order-form");
    view = await mountI18n(createElement(OrderForm, { initial: { vehicle: null, appointmentId: "t1", appointmentLabel: "Inspektion", request: "Inspektion", mileageKm: "" }, cancelHref: "/orders" }));
    let root = view.container;
    assert.equal((root.querySelector("input[name='appointmentId']") as HTMLInputElement).value, "t1");
    assert.ok(root.querySelector("textarea[name='request']"));
    assert.ok(root.querySelector("input[name='mileageKm']"));
    assert.match(plain(root.textContent), /Aus dem Termin „Inspektion“/);
    assert.equal(root.querySelector("input[name='id']"), null);
    await view.unmount();
    view = await mountI18n(createElement(OrderForm, { initial: { id: "o9", version: "42", vehicle: { id: "v1", label: "B AB 1", sublabel: "", plate: "B AB 1", description: "VW Golf", customer: "Muster" }, request: "x", mileageKm: "100" }, cancelHref: "/orders/o9" }));
    root = view.container;
    assert.equal((root.querySelector("input[name='version']") as HTMLInputElement).value, "42");
    assert.equal((root.querySelector("input[name='vehicleId']") as HTMLInputElement).value, "v1");
    assert.match(plain(root.textContent), /VW Golf/);
  });
});

describe("ApprovalForm: Unterschrift nach dem Absenden (Fix-Runde 12b: M3)", () => {
  it("nach einem Fehler bleibt die Unterschrift stehen, nach dem Erfolg ist sie leer – die nächste Freigabe braucht eine neue", async () => {
    const { ApprovalForm } = await import("./approval-form");
    const { wait } = await import("@/test/ui");
    let outcome: "error" | "ok" = "error";
    const submitted: string[] = [];
    const action = async (_previous: unknown, data: FormData) => {
      submitted.push(String(data.get("signature")));
      return outcome === "ok" ? { ok: true, message: "Freigabe protokolliert." } : { fieldErrors: { amount: "Betrag fehlt." } };
    };
    view = await mountI18n(createElement(ApprovalForm, { id: "o1", action: action as never }));
    const root = view.container;
    const signature = () => root.querySelector("input[name='signature']") as HTMLInputElement;
    const fieldset = () => root.querySelector("[data-signature-canvas]")!.closest("fieldset") as HTMLFieldSetElement;
    const nameInput = () => fieldset().querySelector("input:not([type])") as HTMLInputElement;
    const submit = async () => {
      await act(() => (root.querySelector("form") as HTMLFormElement).requestSubmit(root.querySelector("button[type='submit']:last-of-type") as HTMLButtonElement));
      await wait(60);
    };

    // Namensweg: Name tippen und bestätigen (der Zeichenweg verhält sich gleich: Zustand des Bausteins)
    await click(fieldset().querySelector("[role='radio']:last-child"));
    await type(nameInput(), "Hans Beispiel");
    await click(fieldset().querySelector("input[type='checkbox']"));
    assert.equal(signature().value, "typed:Hans Beispiel");

    await submit();
    assert.equal(submitted.at(-1), "typed:Hans Beispiel");
    assert.equal(signature().value, "typed:Hans Beispiel", "Fehler: die Eingabe geht nicht verloren");
    assert.equal(nameInput().value, "Hans Beispiel");

    outcome = "ok";
    await submit();
    assert.equal(submitted.at(-1), "typed:Hans Beispiel");
    assert.equal(signature().value, "", "Erfolg: die Unterschrift ist weg");
    assert.equal(nameInput().value, "", "und der getippte Name auch");
    assert.equal((fieldset().querySelector("input[type='checkbox']") as HTMLInputElement).checked, false);
    assert.ok(root.querySelector("canvas"), "die Zeichenfläche ist wieder da (neu, leer)");

    // die nächste Freigabe geht ohne neue Unterschrift nicht mit dem alten Wert hinaus
    await submit();
    assert.equal(submitted.at(-1), "", "ohne neue Unterschrift wird nichts mitgeschickt");
  });
});
