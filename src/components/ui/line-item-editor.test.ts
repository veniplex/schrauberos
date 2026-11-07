import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { computeTotals, lineItemsInput, serializeDraft, createEditorState } from "@/lib/line-items";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { blur, byText, click, key, mountI18n, plain, type } from "@/test/ui";
import { DRAFT_STATE_EVENT } from "./form-draft";

/**
 * Positionen-Editor in einem echten Renderer: Eingabe, Summen (dieselbe Rechenregel wie der Server), Absendefeld, Tastatur, Entwurf, steuerfrei, Fehler des Servers.
 */
let dom: TestDom;
let view: MountedView | null = null;
before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

const ITEMS = [
  { description: "Bremsbeläge vorn", unit: "Satz", quantityMilli: 1000, unitCents: 8990, taxBp: 1900, discountBp: 500 },
  { description: "Arbeit", unit: "Std.", quantityMilli: 1500, unitCents: 8500, taxBp: 1900, discountBp: 0 },
  { description: "Altteilentsorgung", unit: "", quantityMilli: 1000, unitCents: 500, taxBp: 700, discountBp: 0 },
];

async function mountEditor(props: Record<string, unknown> = {}, locale: "de" | "en" = "de", onSubmit?: () => void) {
  const { LineItemEditor } = await import("./line-item-editor");
  view = await mountI18n(createElement("form", { onSubmit: (event: Event) => (event.preventDefault(), onSubmit?.()) }, createElement(LineItemEditor, { initialItems: ITEMS, ...props } as never)), locale);
  const root = view.container;
  return {
    root,
    form: root.querySelector("form") as HTMLFormElement,
    rows: () => Array.from(root.querySelectorAll<HTMLElement>("li[role='group']")),
    submitted: () => JSON.parse((root.querySelector("input[name='items']") as HTMLInputElement).value) as Array<Record<string, unknown>>,
    summary: () => plain(root.querySelector("dl")?.textContent),
    field: (row: HTMLElement, label: RegExp) => {
      const control = Array.from(row.querySelectorAll<HTMLElement>("div[data-field], div")).find((d) => d.querySelector("label") && label.test(d.querySelector("label")!.textContent ?? ""));
      return control?.querySelector("input, select") as HTMLInputElement | HTMLSelectElement;
    },
  };
}

describe("LineItemEditor", () => {
  it("zeigt die vorhandenen Positionen und rechnet die Summen wie der Server (Steuer je Satz auf der Summe)", async () => {
    const { rows, summary } = await mountEditor();
    assert.equal(rows().length, 3);
    // Netto: 89,90 − 5 % = 85,40 (4,495 → 4,50) + 127,50 + 5,00 = 217,90; Steuer 19 % auf 212,90 = 40,45; 7 % auf 5,00 = 0,35; Brutto 258,70
    assert.equal(computeTotals(ITEMS).grossCents, 25870, "dieselbe Regel wie auf dem Server");
    const text = summary();
    assert.match(text, /Nettos*217,90 €/);
    assert.match(text, /Umsatzsteuer 19 %s*40,45 €/);
    assert.match(text, /Umsatzsteuer 7 %s*0,35 €/);
    assert.match(text, /Bruttos*258,70 €/);
    assert.match(text, /Rabatts*[-−]4,50 €/);
  });

  it("eine Änderung der Menge rechnet sofort neu; zwei Änderungen in einem Zug verlieren keine (Rückrufe rechnen aus dem aktuellen Zustand)", async () => {
    const { rows, field, summary, submitted } = await mountEditor();
    const row = rows()[1];
    await act(async () => {
      const { setControlValue } = await import("./form-draft");
      setControlValue(field(row, /^Menge/) as HTMLInputElement, "2");
      setControlValue(field(row, /^Rabatt/) as HTMLInputElement, "10");
    });
    // 2 × 85,00 − 10 % = 153,00
    assert.equal(submitted()[1].quantityMilli, 2000);
    assert.equal(submitted()[1].discountBp, 1000);
    assert.match(summary(), /Nettos*243,40 €/);
  });

  it("Positionen hinzufügen (neue Zeile nimmt den Fokus und den Steuersatz der letzten), entfernen und verschieben", async () => {
    const { rows, root, submitted } = await mountEditor();
    await click(byText(root, "button", /Position hinzufügen/));
    assert.equal(rows().length, 4);
    assert.equal(submitted()[3].taxBp, 700, "Steuersatz der letzten Position übernommen");
    const description = rows()[3].querySelector("input") as HTMLInputElement;
    assert.equal(document.activeElement, description, "Fokus in der neuen Beschreibung");
    await click(root.querySelector("button[aria-label='Position 4 nach oben']"));
    assert.equal(rows()[2].querySelector("input")!.value, "", "die neue Zeile steht jetzt an dritter Stelle");
    await click(root.querySelector("button[aria-label='Position 1 entfernen']"));
    assert.equal(rows().length, 3);
    assert.equal(submitted()[0].description, "Arbeit");
    assert.equal((root.querySelector("button[aria-label='Position 1 nach oben']") as HTMLButtonElement).disabled, true);
  });

  it("das Absendefeld trägt Zahlen und wird vom Server-Schema gelesen; ungültige Felder sind null", async () => {
    const { submitted, root, rows, field } = await mountEditor();
    const text = (root.querySelector("input[name='items']") as HTMLInputElement).value;
    assert.deepEqual(lineItemsInput().parse(text)[0], { description: "Bremsbeläge vorn", unit: "Satz", quantityMilli: 1000, unitCents: 8990, taxBp: 1900, discountBp: 500 });
    await type(field(rows()[0], /Einzelpreis/) as HTMLInputElement, "kaputt");
    assert.equal(submitted()[0].unitCents, null);
    assert.equal(lineItemsInput().safeParse((root.querySelector("input[name='items']") as HTMLInputElement).value).success, false);
    assert.match(plain(root.textContent), /Bitte die markierten Angaben prüfen/);
    assert.match(plain(rows()[0].textContent), /Ungültige Angabe/);
  });

  it("Eingabetaste springt zum nächsten Feld, sendet das Formular nicht ab und legt nach dem letzten Feld eine neue Position an", async () => {
    let sent = 0;
    const { rows, root } = await mountEditor({}, "de", () => sent++);
    const first = rows()[0].querySelector("input") as HTMLInputElement;
    await act(() => first.focus());
    assert.equal(await key(first, "Enter"), true, "Standardverhalten (Absenden) verhindert");
    assert.notEqual(document.activeElement, first);
    assert.equal(rows().length, 3);
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type='hidden']), select"));
    const last = inputs.at(-1) as HTMLInputElement; // Rabatt der letzten Zeile
    await act(() => last.focus());
    await key(last, "Enter");
    assert.equal(rows().length, 4, "nach dem letzten Feld entsteht eine neue Position");
    assert.equal(sent, 0);
  });

  it("steuerfrei (Kleinunternehmer): fester Satz 0, kein Steuerbetrag, Hinweis im Summenblock", async () => {
    const { submitted, summary, rows, field } = await mountEditor({ exempt: true });
    assert.ok(submitted().every((item) => item.taxBp === 0));
    assert.match(summary(), /Steuerfrei, keine Umsatzsteuer/);
    assert.doesNotMatch(summary(), /Umsatzsteuer 19/);
    assert.equal((field(rows()[0], /Steuersatz/) as HTMLSelectElement).disabled, true);
    const gross = /Brutto ([\d.,]+) €/.exec(summary())?.[1];
    const net = /Netto ([\d.,]+) €/.exec(summary())?.[1];
    assert.equal(gross, net);
  });

  it("Entwurf: der Rahmen schickt den gemerkten Zustand an das Zustandsfeld, die Zeilen kommen zurück; der Text des Feldes ist danach derselbe", async () => {
    const { root, rows, submitted } = await mountEditor({ initialItems: [] });
    assert.equal(rows().length, 0);
    const draft = serializeDraft(createEditorState([{ description: "Wiederhergestellt", quantity: "3", unit: "Stk", unitPrice: "12,50", taxRate: "19", discount: "" }, { description: "Zweite", quantity: "1", unit: "", unitPrice: "1,00", taxRate: "7", discount: "5" }]).rows);
    const stateField = root.querySelector("input[data-draft-state='items']") as HTMLInputElement;
    await act(() => void stateField.dispatchEvent(new window.CustomEvent(DRAFT_STATE_EVENT, { bubbles: true, detail: draft })));
    assert.equal(rows().length, 2);
    assert.equal(stateField.value, draft, "Voraussetzung dafür, dass die Wiederherstellung fertig ist");
    assert.equal(submitted()[0].quantityMilli, 3000);
    assert.equal(submitted()[1].discountBp, 500);
    // das Zustandsfeld hat keinen Namen: es geht nie mit dem Formular zum Server
    assert.equal(stateField.getAttribute("name"), null);
    // Unlesbares wird zur leeren Liste, nicht zum Absturz
    await act(() => void stateField.dispatchEvent(new window.CustomEvent(DRAFT_STATE_EVENT, { bubbles: true, detail: "kaputt" })));
    assert.equal(rows().length, 0);
  });

  it("Fehler des Servers erscheinen an Zeile und Feld (items.1.unitCents → Position 2, Einzelpreis)", async () => {
    const { rows } = await mountEditor({ errors: { "1.unitPrice": "Zu hoch." } });
    assert.match(plain(rows()[1].textContent), /Zu hoch\./);
    assert.doesNotMatch(plain(rows()[0].textContent), /Zu hoch/);
  });

  it("mit `kinds`: je Position eine Auswahl „Art“, die erste ist die Vorgabe und steht im Absendefeld", async () => {
    const kinds = [{ value: "labor", label: "Arbeit" }, { value: "part", label: "Teil" }];
    const { rows, field, submitted } = await mountEditor({ kinds, initialItems: [{ ...ITEMS[0], kind: "part" }, ITEMS[1]] });
    const select = field(rows()[0], /Art/) as HTMLSelectElement;
    assert.equal(select.value, "part");
    assert.equal((field(rows()[1], /Art/) as HTMLSelectElement).value, "labor", "ohne Angabe gilt die erste Art");
    assert.deepEqual(submitted().map((item) => item.kind), ["part", "labor"]);
    await act(() => void select.dispatchEvent(new window.Event("change", { bubbles: true })));
    // ohne `kinds` gibt es weder Auswahl noch Feld
    await view?.unmount();
    const plainEditor = await mountEditor();
    assert.equal(plainEditor.root.querySelectorAll("select").length, 3, "nur die Steuersätze");
    assert.ok(plainEditor.submitted().every((item) => !("kind" in item)));
  });

  it("fremde Funktionen fügen Positionen über das Ereignis ein (mit Verweis); ein Ereignis für ein anderes Feld wird ignoriert", async () => {
    const { LINE_ITEM_ADD_EVENT } = await import("@/lib/line-items");
    const { rows, submitted } = await mountEditor({ initialItems: [], kinds: [{ value: "labor", label: "Arbeit" }, { value: "part", label: "Teil" }] });
    await act(() => void window.dispatchEvent(new window.CustomEvent(LINE_ITEM_ADD_EVENT, { detail: { name: "items", row: { description: "Ölfilter", unit: "Stk", unitPrice: "12,50", taxRate: "19", kind: "part", refType: "article", refId: "a1" } } })));
    await act(() => void window.dispatchEvent(new window.CustomEvent(LINE_ITEM_ADD_EVENT, { detail: { name: "anderes", row: { description: "Fremd" } } })));
    assert.equal(rows().length, 1);
    assert.deepEqual([submitted()[0].description, submitted()[0].kind, submitted()[0].refType, submitted()[0].refId, submitted()[0].unitCents], ["Ölfilter", "part", "article", "a1", 1250]);
  });

  it("mapLineItemErrors bildet die Pfade des Servers auf Zeile und Feld ab", async () => {
    const { mapLineItemErrors } = await import("./line-item-editor");
    assert.deepEqual(mapLineItemErrors({ "items.1.unitCents": "a", "items.0.description": "b", "2.taxBp": "c", "items.1.quantityMilli": "d", andere: "x", "items.x.unitCents": "y" }, "items"), {
      "1.unitPrice": "a",
      "0.description": "b",
      "2.taxRate": "c",
      "1.quantity": "d",
    });
  });

  it("Handy: je Position eine Karte mit sichtbaren Beschriftungen, klebende Summenleiste; breit: Beschriftungen nur für Hilfstechnik", async () => {
    const { root, rows } = await mountEditor();
    assert.ok(root.querySelector(".\\@container"), "Container-Abfrage am Editor");
    const row = rows()[0];
    const labels = Array.from(row.querySelectorAll("label")).map((l) => l.className);
    assert.ok(labels.length >= 6 && labels.every((c) => c.includes("@5xl:sr-only")), "Beschriftungen sind nur in der Tabellenzeile unsichtbar");
    assert.match(row.className, /grid-cols-2/);
    assert.match(row.className, /@lg:grid-cols-4/);
    const bar = Array.from(root.querySelectorAll("div")).find((d) => d.className.includes("sticky") && d.className.includes("md:hidden"));
    assert.ok(bar, "Summenleiste klebt unter md");
    assert.match(bar.className, /bottom-\[var\(--toast-lift,0px\)\]/);
    assert.match(plain(bar.textContent), /3 Positionen/);
    assert.match(plain(bar.textContent), /Brutto 258,70 €/);
  });

  it("Knöpfe haben zugängliche Namen mit der Positionsnummer, Eingabefelder sind Touch-tauglich (Zahlenfelder mit Zehnerblock)", async () => {
    const { root, rows, field } = await mountEditor();
    for (const label of ["Position 1 entfernen", "Position 1 nach unten", "Position 3 nach oben"]) assert.ok(root.querySelector(`button[aria-label='${label}']`), label);
    assert.equal(field(rows()[0], /^Menge/).getAttribute("inputmode"), "decimal");
    assert.equal(field(rows()[0], /Einzelpreis/).getAttribute("inputmode"), "decimal");
    await blur(field(rows()[0], /^Menge/) as HTMLInputElement);
  });

  it("englisch: Summenblock und Zahlen in der Sprache der Oberfläche", async () => {
    const { summary } = await mountEditor({}, "en");
    assert.match(summary(), /Net/);
    assert.match(summary(), /VAT 19 %/);
    assert.match(summary(), /Gross/);
  });
});
