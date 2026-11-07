import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain, type } from "@/test/ui";
import { PNG_DATA_URL, parseSignatureValue, type SignatureSurface } from "@/lib/signature";
import { takeSnapshot } from "./form-draft";

/**
 * Unterschrift: Zeichnen über Pointer Events (Fingerabdruck der Bedienung: Touch, Stift, Maus), Umrechnung auf die Zeichenfläche, Ergebnis als PNG im versteckten Feld, Namensweg als
 * barrierefreie Alternative. Die Zeichenfläche ist eine Attrappe (happy-dom hat kein Canvas); die Logik der Striche testet `lib/signature.test.ts`.
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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30, 7)]);

function fakeEngine() {
  const created: Array<SignatureSurface & { ops: string[] }> = [];
  const make = (width: number, height: number) => {
    const ops: string[] = [];
    const surface = {
      width,
      height,
      ops,
      clear: () => void (ops.length = 0),
      line: (a: { x: number; y: number }, b: { x: number; y: number }) => void ops.push(`line ${Math.round(a.x)},${Math.round(a.y)}-${Math.round(b.x)},${Math.round(b.y)}`),
      dot: (p: { x: number; y: number }) => void ops.push(`dot ${Math.round(p.x)},${Math.round(p.y)}`),
      toPng: () => PNG_DATA_URL + PNG.toString("base64"),
    };
    created.push(surface);
    return surface;
  };
  return { engine: { display: (canvas: HTMLCanvasElement) => make(canvas.width, canvas.height), offscreen: make }, created };
}

async function mountSignature(props: Record<string, unknown> = {}) {
  const { Signature } = await import("./signature");
  const fake = fakeEngine();
  const changes: unknown[] = [];
  view = await mountI18n(createElement("form", null, createElement(Signature, { name: "signature", engine: fake.engine, onChange: (v: unknown) => changes.push(v), ...props } as never)));
  const root = view.container;
  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  // Das Feld ist 300 px breit angezeigt (halb so groß wie die Zeichenfläche 600 × 200)
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 100, right: 310, bottom: 120, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect;
  const hidden = () => (root.querySelector(`input[name='${props.name ?? "signature"}']`) as HTMLInputElement).value;
  const pointer = (name: string, x: number, y: number, init: PointerEventInit = {}) =>
    act(() => void canvas.dispatchEvent(new window.PointerEvent(name, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", clientX: x, clientY: y, button: 0, ...init })));
  const stroke = async () => {
    await pointer("pointerdown", 20, 40);
    for (let i = 1; i <= 12; i++) await pointer("pointermove", 20 + i * 12, 40 + (i % 3) * 8);
    await pointer("pointerup", 164, 40);
  };
  return { root, canvas, hidden, pointer, stroke, fake, changes };
}

describe("Signature: Zeichnen", () => {
  it("das Feld ist für Zeigereingabe gebaut: touch-action none, Pointer Events, benannt, mit Erklärung des Alternativwegs", async () => {
    const { canvas, root } = await mountSignature();
    assert.equal(canvas.style.touchAction, "none");
    assert.equal(canvas.width, 600);
    assert.equal(canvas.height, 200);
    assert.match(canvas.getAttribute("aria-label") ?? "", /Namen tippen/);
    assert.match(plain(root.textContent), /Mit dem Finger oder einem Stift/);
  });

  it("Finger/Stift/Maus: Fensterkoordinaten werden auf die Zeichenfläche umgerechnet, nach dem Abheben liegt das PNG im Formularfeld", async () => {
    const { stroke, hidden, fake, changes } = await mountSignature();
    assert.equal(hidden(), "");
    await stroke();
    const display = fake.created[0];
    // (20 − 10) / 300 × 600 = 20; (40 − 20) / 100 × 200 = 40
    assert.equal(display.ops[0], "dot 20,40");
    assert.ok(display.ops.length > 5);
    assert.ok(hidden().startsWith(PNG_DATA_URL));
    assert.deepEqual(parseSignatureValue(hidden())?.kind, "drawn");
    assert.equal((changes.at(-1) as { kind: string }).kind, "drawn");
  });

  it("während des Striches ändert sich das Feld nicht; ein anderer Zeiger stört nicht; die rechte Maustaste zeichnet nicht", async () => {
    const { pointer, hidden, fake } = await mountSignature();
    await pointer("pointerdown", 20, 40, { pointerType: "mouse", button: 2 });
    await pointer("pointermove", 80, 80);
    assert.equal(fake.created[0].ops.length, 0);
    await pointer("pointerdown", 20, 40);
    await pointer("pointermove", 100, 80, { pointerId: 2 });
    await pointer("pointermove", 60, 60);
    assert.equal(hidden(), "", "erst beim Abheben");
    assert.equal(fake.created[0].ops.length, 2, "Punkt + eine Linie vom eigenen Zeiger");
    await pointer("pointercancel", 60, 60);
  });

  it("ein Antippen ist keine Unterschrift; Löschen und Rückgängig", async () => {
    const { pointer, stroke, hidden, root } = await mountSignature();
    await pointer("pointerdown", 40, 50);
    await pointer("pointerup", 40, 50);
    assert.equal(hidden(), "");
    assert.equal((byText(root, "button", /Löschen/) as HTMLButtonElement).disabled, true);
    await stroke();
    assert.ok(hidden().startsWith(PNG_DATA_URL));
    await click(byText(root, "button", /Rückgängig/));
    assert.equal(hidden(), "", "der einzige Strich ist weg");
    await stroke();
    await click(byText(root, "button", /Löschen/));
    assert.equal(hidden(), "");
    assert.match(plain(root.textContent), /Noch keine Unterschrift/);
  });

  it("ist das PNG zu groß, bleibt das Feld leer und eine Meldung sagt es", async () => {
    const { Signature } = await import("./signature");
    const big = { display: fakeEngine().engine.display, offscreen: () => ({ width: 1, height: 1, clear() {}, line() {}, dot() {}, toPng: () => PNG_DATA_URL + Buffer.alloc(200_000, 1).toString("base64") }) };
    view = await mountI18n(createElement("form", null, createElement(Signature, { name: "signature", engine: big, maxBytes: 1000 } as never)));
    const canvas = view.container.querySelector("canvas") as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200 }) as DOMRect;
    const send = (name: string, x: number) => act(() => void canvas.dispatchEvent(new window.PointerEvent(name, { bubbles: true, pointerId: 1, clientX: x, clientY: 50, button: 0 })));
    await send("pointerdown", 10);
    for (let x = 30; x < 200; x += 20) await send("pointermove", x);
    await send("pointerup", 200);
    assert.equal((view.container.querySelector("input[name='signature']") as HTMLInputElement).value, "");
    assert.match(plain(view.container.textContent), /Unterschrift ist zu groß/);
  });
});

describe("Signature: Namensweg und Formular", () => {
  it("Namen tippen und bestätigen ergibt typed:<Name>; ohne Bestätigung oder bei Änderung des Namens nichts", async () => {
    const { root, hidden, changes } = await mountSignature();
    await click(root.querySelector("[role='radio']:last-child"));
    const input = root.querySelector("input:not([type])") as HTMLInputElement;
    const box = root.querySelector("input[type='checkbox']") as HTMLInputElement;
    assert.equal(box.disabled, true, "ohne Namen gibt es nichts zu bestätigen");
    await type(input, "Erika Mustermann");
    assert.equal(hidden(), "");
    await click(box);
    assert.equal(hidden(), "typed:Erika Mustermann");
    assert.deepEqual(changes.at(-1), { kind: "typed", name: "Erika Mustermann" });
    await type(input, "Erika Musterfrau");
    assert.equal(hidden(), "", "ein geänderter Name muss neu bestätigt werden");
    assert.deepEqual(parseSignatureValue("typed:Erika Mustermann"), { kind: "typed", name: "Erika Mustermann" });
  });

  it("der Umschalter wechselt zwischen den Wegen, ohne den gezeichneten Strich zu verlieren; das Feld gehört dem gewählten Weg", async () => {
    const { root, stroke, hidden } = await mountSignature();
    await stroke();
    const drawn = hidden();
    assert.ok(drawn.startsWith(PNG_DATA_URL));
    const radios = Array.from(root.querySelectorAll("[role='radio']"));
    await click(radios[1]);
    assert.equal(hidden(), "", "im Namensweg gilt nur der bestätigte Name");
    await click(radios[0]);
    assert.equal(hidden(), drawn, "der Strich ist noch da");
    assert.equal(radios.length, 2);
  });

  it("eine Unterschrift geht nie in einen Formularentwurf (data-no-draft) und das Feld hat den verlangten Namen", async () => {
    const { root, stroke, hidden } = await mountSignature({ name: "customerSignature" });
    await stroke();
    assert.ok(root.querySelector("input[name='customerSignature']")?.hasAttribute("data-no-draft"));
    const snapshot = JSON.stringify(takeSnapshot(root.querySelector("form")));
    assert.equal(snapshot.includes(hidden().slice(0, 40)), false);
    assert.equal(snapshot.includes("Erika"), false);
    assert.ok(root.querySelector("input:not([type])")?.hasAttribute("data-no-draft"));
  });

  it("englisch", async () => {
    const { Signature } = await import("./signature");
    view = await mountI18n(createElement(Signature, { name: "s", engine: fakeEngine().engine } as never), "en");
    assert.match(plain(view.container.textContent), /Draw/);
    assert.match(plain(view.container.textContent), /Type name/);
    assert.match(view.container.querySelector("canvas")?.getAttribute("aria-label") ?? "", /Signature field/);
  });
});
