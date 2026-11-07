import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain, rerenderI18n, wait } from "@/test/ui";
import { takeSnapshot } from "./form-draft";

/** Geheimnisfeld, Codeblock und Kopieren: Klartext nur bei Bedarf im DOM, einmalige Anzeige, Kopieren auch ohne HTTPS. */
let dom: TestDom;
let view: MountedView | null = null;
const SECRET = "sos_live_4f9a1c77e2b0d8836a5f";

before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

function stubClipboard(behaviour: "ok" | "denied") {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => (behaviour === "ok" ? void written.push(text) : Promise.reject(new Error("verweigert"))) },
  });
  return written;
}

async function mountSecret(props: Record<string, unknown> = {}) {
  const { SecretField } = await import("./secret-field");
  view = await mountI18n(createElement("form", null, createElement(SecretField, { value: SECRET, label: "API-Token", ...props } as never)));
  const input = () => view!.container.querySelector("input") as HTMLInputElement;
  return { input, root: view.container, status: () => plain(view!.container.querySelector("p[role='status']")?.textContent) };
}

describe("SecretField", () => {
  it("verborgen: der Klartext ist nirgends im DOM (weder Wert noch Attribute), die Länge verrät nichts", async () => {
    const { input, root } = await mountSecret();
    assert.equal(input().value, "Verborgen");
    assert.equal(root.innerHTML.includes(SECRET), false);
    assert.equal(input().readOnly, true);
    assert.equal(input().getAttribute("aria-label"), "API-Token");
  });

  it("Anzeigen schreibt den Klartext ins Feld, Verbergen nimmt ihn wieder heraus", async () => {
    const { input, root } = await mountSecret();
    const show = byText(root, "button", /^Anzeigen$/);
    assert.equal(show?.getAttribute("aria-pressed"), "false");
    await click(show);
    assert.equal(input().value, SECRET);
    assert.equal(byText(root, "button", /^Verbergen$/)?.getAttribute("aria-pressed"), "true");
    await click(byText(root, "button", /^Verbergen$/));
    assert.equal(input().value, "Verborgen");
    assert.equal(root.innerHTML.includes(SECRET), false);
  });

  it("das Feld geht nie in einen Formularentwurf und nie zum Server: kein name, data-no-draft, nicht im Schnappschuss", async () => {
    const { input, root } = await mountSecret();
    await click(byText(root, "button", /^Anzeigen$/));
    assert.equal(input().getAttribute("name"), null);
    assert.equal(input().hasAttribute("data-no-draft"), true);
    const snapshot = takeSnapshot(root.querySelector("form"));
    assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
    assert.equal(new FormData(root.querySelector("form") as HTMLFormElement).get("") === SECRET, false);
  });

  it("Kopieren übergibt den Klartext an die Zwischenablage (auch wenn er verborgen ist) und meldet es", async () => {
    const written = stubClipboard("ok");
    const { root, status } = await mountSecret();
    await click(byText(root, "button", /Kopieren/));
    await wait();
    assert.deepEqual(written, [SECRET]);
    assert.equal(status(), "Kopiert.");
    assert.equal(root.innerHTML.includes(SECRET), false, "Kopieren zeigt nichts an");
  });

  it("Kopieren ohne Zwischenablage-Schnittstelle (HTTP im LAN): Rückfall über ein verstecktes Textfeld; geht auch das nicht, steht eine Meldung da", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); // kein sicherer Kontext: es gibt keine Zwischenablage-Schnittstelle
    (document as unknown as { execCommand: (name: string) => boolean }).execCommand = (name: string) => {
      copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? document.querySelector("textarea")?.value ?? "";
      return name === "copy";
    };
    const { root, status } = await mountSecret();
    await click(byText(root, "button", /Kopieren/));
    await wait();
    assert.equal(copied, SECRET);
    assert.equal(status(), "Kopiert.");
    assert.equal(document.querySelector("textarea"), null, "das Hilfsfeld ist wieder weg");

    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await click(byText(root, "button", /Kopieren/));
    await wait();
    assert.match(status(), /Kopieren nicht möglich/);
  });

  it("einmalige Anzeige: Hinweis, „Ausblenden“ wirft den Klartext weg und ruft onDismiss", async () => {
    let dismissed = 0;
    const { input, root } = await mountSecret({ once: true, onDismiss: () => dismissed++ });
    assert.match(plain(root.textContent), /Wird nur einmal angezeigt/);
    await click(byText(root, "button", /^Anzeigen$/));
    assert.equal(input().value, SECRET);
    await click(byText(root, "button", /Ausblenden/));
    assert.equal(dismissed, 1);
    assert.equal(root.querySelector("input"), null);
    assert.equal(root.innerHTML.includes(SECRET), false);
    assert.match(plain(root.textContent), /Ausgeblendet/);
  });

  it("einmalige Anzeige blendet sich nach der Frist von selbst aus", async () => {
    let dismissed = 0;
    const { root } = await mountSecret({ once: true, autoHideSeconds: 0.03, onDismiss: () => dismissed++ });
    await click(byText(root, "button", /^Anzeigen$/));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 80)));
    assert.equal(dismissed, 1);
    assert.equal(root.querySelector("input"), null);
    assert.equal(root.innerHTML.includes(SECRET), false);
  });

  it("ein neues Geheimnis von außen ersetzt das alte und beginnt wieder verborgen; ohne Wert wird nichts gezeigt", async () => {
    const { SecretField } = await import("./secret-field");
    const { input, root } = await mountSecret();
    await click(byText(root, "button", /^Anzeigen$/));
    assert.equal(input().value, SECRET);
    await rerenderI18n(view!, createElement(SecretField, { value: "anderes-geheimnis", label: "API-Token" } as never));
    assert.equal(input().value, "Verborgen");
    await rerenderI18n(view!, createElement(SecretField, { value: null, label: "API-Token" } as never));
    assert.equal(root.querySelector("input"), null);
  });
});

describe("CodeBlock", () => {
  it("zeigt den Text unverändert (kein HTML), kopiert ihn und meldet das; bei verweigerter Zwischenablage mit Rückfall und Meldung", async () => {
    const { CodeBlock } = await import("./code-block");
    const code = `curl -H "Authorization: Bearer <TOKEN>" https://werkstatt.example/api/v1/customers?q=<script>`;
    const written = stubClipboard("ok");
    view = await mountI18n(createElement(CodeBlock, { code, language: "Shell" } as never));
    assert.equal(view.container.querySelector("code")?.textContent, code);
    assert.equal(view.container.querySelector("script"), null);
    assert.equal(view.container.querySelector("figcaption")?.textContent?.includes("Shell"), true);
    await click(byText(view.container, "button", /Kopieren/));
    await wait();
    assert.deepEqual(written, [code]);
    assert.equal(plain(view.container.querySelector("p[role='status']")?.textContent), "Kopiert.");

    stubClipboard("denied");
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await click(byText(view.container, "button", /Kopieren/));
    await wait();
    assert.match(plain(view.container.querySelector("p[role='status']")?.textContent), /Kopieren nicht möglich/);
  });
});
