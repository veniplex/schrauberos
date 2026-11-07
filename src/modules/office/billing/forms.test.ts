import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { installDom, type MountedView, type TestDom } from "@/test/dom";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { click, mountI18n as mountPlain, plain } from "@/test/ui";

/** Formular der Entwürfe in einem echten Renderer: Felder je Belegart, Positionen-Editor (Kleinunternehmer ohne Steuer), Abschläge der Schlussrechnung, Platz für Werkzeuge anderer Funktionen. */
let dom: TestDom;
let env: TestEnv;
let view: MountedView | null = null;

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

const base = {
  docType: "invoice",
  customer: null,
  partyName: "Max Mustermann",
  partyStreet: "Nebenweg 2",
  partyZip: "50667",
  partyCity: "Köln",
  buyerEmail: "max@kunde.example",
  introText: "",
  footerText: "",
  serviceFrom: "",
  serviceTo: "",
  validUntil: "",
  paymentDays: "14",
  paymentMethod: "transfer",
  buyerReference: "",
  taxNote: "",
  mileageKm: "",
  items: [{ description: "Ölwechsel", quantityMilli: 1000, unitCents: 8900, taxBp: 1900, discountBp: 0, unit: "Stk" }],
};
const props = { exempt: false, canPickCustomer: false, vehicleField: null, candidates: [], cancelHref: "/billing" };

describe("DocumentForm", () => {
  it("Rechnung: Empfänger, Leistungszeitraum, Zahlungsziel, Zahlungsart, Käuferreferenz, Hinweis zur Steuerbefreiung und die Positionen; die Belegart steht als verstecktes Feld", async () => {
    const { DocumentForm } = await import("./document-form");
    view = await mountI18n(createElement(DocumentForm, { ...props, initial: base }));
    const root = view.container;
    assert.equal((root.querySelector("input[name='docType']") as HTMLInputElement).value, "invoice");
    assert.equal(root.querySelector("input[name='id']"), null, "neuer Entwurf ohne Kennung");
    for (const name of ["partyName", "partyStreet", "partyZip", "partyCity", "buyerEmail", "serviceFrom", "serviceTo", "paymentDays", "paymentMethod", "buyerReference", "taxNote", "introText", "footerText"]) assert.ok(root.querySelector(`[name='${name}']`), name);
    assert.equal(root.querySelector("[name='validUntil']"), null, "Gültigkeit gibt es nur beim Angebot");
    assert.equal((root.querySelector("input[name='partyName']") as HTMLInputElement).value, "Max Mustermann");
    // Positionen: das Absendefeld des Editors trägt die Zahlen
    const items = root.querySelector("input[name='items']") as HTMLInputElement;
    const parsed = JSON.parse(items.value) as Array<{ description: string; quantityMilli: number; unitCents: number; taxBp: number }>;
    assert.deepEqual([parsed[0].description, parsed[0].quantityMilli, parsed[0].unitCents, parsed[0].taxBp], ["Ölwechsel", 1000, 8900, 1900]);
    assert.match(plain(root.textContent), /Brutto/);
  });

  it("Angebot: Gültigkeit statt Zahlungsangaben; Bearbeiten trägt Kennung und Version", async () => {
    const { DocumentForm } = await import("./document-form");
    view = await mountI18n(createElement(DocumentForm, { ...props, initial: { ...base, docType: "offer", id: "x1", version: "123", validUntil: "2026-12-01" } }));
    const root = view.container;
    assert.ok(root.querySelector("input[name='validUntil']"));
    assert.equal((root.querySelector("input[name='validUntil']") as HTMLInputElement).value, "2026-12-01");
    for (const name of ["serviceFrom", "paymentDays", "buyerReference", "taxNote"]) assert.equal(root.querySelector(`[name='${name}']`), null, name);
    assert.equal((root.querySelector("input[name='id']") as HTMLInputElement).value, "x1");
    assert.equal((root.querySelector("input[name='version']") as HTMLInputElement).value, "123");
    assert.equal(root.querySelector("input[name='docType']"), null, "die Belegart ändert sich nach dem Anlegen nie");
  });

  it("Kleinunternehmer: Hinweis, kein Feld für die Steuerbefreiung, Summen ohne Steuer", async () => {
    const { DocumentForm } = await import("./document-form");
    view = await mountI18n(createElement(DocumentForm, { ...props, exempt: true, initial: base }));
    const root = view.container;
    assert.match(plain(root.textContent), /Kleinunternehmer, § 19 UStG/);
    assert.equal(root.querySelector("input[name='taxNote']"), null);
    assert.doesNotMatch(plain(root.textContent), /Umsatzsteuer 19/);
  });

  it("Schlussrechnung: anrechenbare Abschläge als Kästchen (vorbelegt), ohne Kunden ein Hinweis; Werkzeuge anderer Funktionen und das Fahrzeugfeld haben ihren Platz", async () => {
    const { DocumentForm } = await import("./document-form");
    view = await mountI18n(
      createElement(DocumentForm, {
        ...props,
        initial: { ...base, docType: "final" },
        candidates: [{ id: "p1", label: "2026-0004 vom 01.11.2026: 595,00 €", checked: true }, { id: "p2", label: "2026-0005 vom 05.11.2026: 100,00 €", checked: false }],
        vehicleField: createElement("div", { id: "vehicle-slot" }, "Fahrzeugfeld"),
        tools: createElement("div", { id: "tool-slot" }, "Artikel einfügen"),
      }),
    );
    const root = view.container;
    const boxes = [...root.querySelectorAll("input[name='deductPartialIds']")] as HTMLInputElement[];
    assert.deepEqual(boxes.map((b) => [b.value, b.checked]), [["p1", true], ["p2", false]]);
    assert.ok(root.querySelector("#vehicle-slot"));
    assert.ok(root.querySelector("#tool-slot"));
    await view.unmount();
    view = await mountI18n(createElement(DocumentForm, { ...props, initial: { ...base, docType: "final" } }));
    assert.equal(view.container.querySelector("input[name='deductPartialIds']"), null);
    assert.match(plain(view.container.textContent), /Kunde/);
  });

  it("ein neuer Eintrag im Editor ändert das Absendefeld (der Server liest nur die Eingaben)", async () => {
    const { DocumentForm } = await import("./document-form");
    view = await mountI18n(createElement(DocumentForm, { ...props, initial: { ...base, items: [] } }));
    const root = view.container;
    const add = [...root.querySelectorAll("button")].find((b) => /Position hinzufügen/.test(b.textContent ?? ""))!;
    assert.ok(add);
    await click(add);
    assert.equal(JSON.parse((root.querySelector("input[name='items']") as HTMLInputElement).value).length, 1);
  });
});
