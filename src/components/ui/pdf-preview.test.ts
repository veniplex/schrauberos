import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain } from "@/test/ui";

/** PDF-Baustein: Öffnen, Teilen (nur wo das Gerät Dateien teilen kann), Herunterladen; nie `<object>`/`<embed>`; Vorschau nur am Rechner und erst nach Klick. */
let dom: TestDom;
let view: MountedView | null = null;
const realFetch = globalThis.fetch;
before(() => {
  dom = installDom();
});
after(async () => {
  globalThis.fetch = realFetch;
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  globalThis.fetch = realFetch;
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

const labels = { show: "Vorschau anzeigen", hide: "Vorschau ausblenden", mobile: "Die Vorschau gibt es nur am Computer." };

async function mountPdf(props: Record<string, unknown> = {}) {
  const { PdfPreview } = await import("./pdf-preview");
  view = await mountI18n(createElement(PdfPreview, { src: "/api/invoices/abc/file", title: "Rechnung RE-2026-0001", labels, ...props } as never));
  return view.container;
}

describe("PdfPreview", () => {
  it("Öffnen (neuer Tab) und Herunterladen als normale Verweise; ohne Teilen-Unterstützung kein Teilen-Knopf", async () => {
    const root = await mountPdf();
    const open = byText(root, "a", /Öffnen/);
    assert.equal(open?.getAttribute("href"), "/api/invoices/abc/file");
    assert.equal(open?.getAttribute("target"), "_blank");
    assert.match(open?.getAttribute("rel") ?? "", /noreferrer/);
    const download = byText(root, "a", /Herunterladen/);
    assert.equal(download?.getAttribute("href"), "/api/invoices/abc/file?download=1");
    assert.equal(download?.hasAttribute("download"), true);
    assert.equal(byText(root, "button", /Teilen/), undefined);
    assert.equal(root.querySelector("object, embed"), null, "nie inline per <object>/<embed>");
  });

  it("eine Adresse mit Abfrage bekommt den Download-Parameter angehängt", async () => {
    const root = await mountPdf({ src: "/api/documents/x?format=a4" });
    assert.equal(byText(root, "a", /Herunterladen/)?.getAttribute("href"), "/api/documents/x?format=a4&download=1");
  });

  it("Teilen erscheint, wo das Gerät Dateien teilen kann, holt das PDF und übergibt es als Datei mit .pdf im Namen", async () => {
    const shared: Array<{ files: File[]; title: string }> = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: { files: File[]; title: string }) => void shared.push(data) });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data: { files?: File[] }) => (data.files?.length ?? 0) > 0 });
    const requested: string[] = [];
    globalThis.fetch = (async (url: string) => (requested.push(url), new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "Content-Type": "application/pdf" } }))) as typeof fetch;
    const root = await mountPdf({ fileName: "Rechnung RE-2026-0001" });
    const share = byText(root, "button", /Teilen/);
    assert.ok(share, "Teilen-Knopf");
    await click(share);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
    assert.deepEqual(requested, ["/api/invoices/abc/file"]);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].files[0].name, "Rechnung RE-2026-0001.pdf");
    assert.equal(shared[0].files[0].type, "application/pdf");
    assert.equal(shared[0].title, "Rechnung RE-2026-0001");
    assert.equal(plain(root.querySelector("[role='status']")?.textContent), "");
  });

  it("„Abbrechen“ im Teilen-Dialog ist keine Störung; ein anderer Fehler (Netz, 403) nennt den Weg über „Herunterladen“", async () => {
    let behaviour: "abort" | "fail" = "abort";
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        if (behaviour === "abort") throw new DOMException("abgebrochen", "AbortError");
      },
    });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    globalThis.fetch = (async () => new Response(new Uint8Array([1]))) as typeof fetch;
    const root = await mountPdf();
    await click(byText(root, "button", /Teilen/));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
    assert.equal(plain(root.querySelector("[role='status']")?.textContent), "");
    behaviour = "fail";
    globalThis.fetch = (async () => new Response("nein", { status: 403 })) as typeof fetch;
    await click(byText(root, "button", /Teilen/));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
    assert.match(plain(root.querySelector("[role='status']")?.textContent), /Bitte herunterladen/);
    assert.equal((byText(root, "button", /Teilen/) as HTMLButtonElement).disabled, false, "danach wieder bedienbar");
  });

  it("Vorschau nur am Rechner (ab lg) und erst nach Klick eingehängt; unter lg steht der Hinweis statt des Knopfes", async () => {
    const root = await mountPdf();
    assert.equal(root.querySelector("iframe"), null, "ohne Klick wird nichts geladen");
    const toggle = byText(root, "button", /Vorschau anzeigen/) as HTMLButtonElement;
    assert.match(toggle.parentElement?.className ?? "", /max-lg:hidden/, "unter lg ausgeblendet");
    assert.match(plain(root.textContent), /nur am Computer/);
    await click(toggle);
    const frame = root.querySelector("iframe");
    assert.equal(frame?.getAttribute("src"), "/api/invoices/abc/file");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    await click(toggle);
    assert.equal(root.querySelector("iframe"), null);
  });

  it("ohne Vorschau (preview=false) bleiben nur die drei Wege", async () => {
    const root = await mountPdf({ preview: false });
    assert.equal(byText(root, "button", /Vorschau/), undefined);
    assert.ok(byText(root, "a", /Öffnen/));
  });
});
