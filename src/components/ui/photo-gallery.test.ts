import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement } from "react";
import type { ImageEngine } from "@/lib/image-resize";
import { UploadError, type Uploader } from "@/lib/upload-queue";
import { act, installDom, type MountedView, type TestDom } from "@/test/dom";
import { byText, click, mountI18n, plain, rerenderI18n } from "@/test/ui";

/**
 * Foto-Galerie: Mehrfachauswahl, Warteschlange mit Fortschritt je Foto, Wiederholen bei Fehler, Abbrechen, Grenzen. Der Foto-Baustein darunter verkleinert mit einer Attrappe der Bildverarbeitung
 * (Canvas gibt es hier nicht); die Entscheidungen dort testen `photo-input.test.ts` und `image-resize.test.ts`.
 */
const nodeTypes = { File: globalThis.File, Blob: globalThis.Blob };
let dom: TestDom;
let view: MountedView | null = null;
before(() => {
  dom = installDom();
  Object.assign(globalThis, { File: dom.window.File, Blob: dom.window.Blob });
});
after(async () => {
  Object.assign(globalThis, nodeTypes);
  await dom.close();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
});

const jpeg = (name: string, size = 50_000) => {
  const body = new Uint8Array(size);
  body.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([body], name, { type: "image/jpeg" });
};
const small: ImageEngine = { decode: async () => ({ width: 800, height: 600 }), encode: async () => new Blob([new Uint8Array(1000)], { type: "image/jpeg" }) };

function manualUploader() {
  const calls: Array<{ file: File; progress: (f: number) => void; signal: AbortSignal; finish: (v?: unknown) => void; fail: (code?: string) => void }> = [];
  const uploader: Uploader = (file, ctx) =>
    new Promise((resolve, reject) => {
      calls.push({ file, progress: ctx.onProgress, signal: ctx.signal, finish: (v) => resolve(v ?? { id: file.name }), fail: (code = "network") => reject(new UploadError(code)) });
    });
  return { calls, uploader };
}

async function mountGallery(props: Record<string, unknown> = {}) {
  const { PhotoGallery } = await import("./photo-gallery");
  const upload = manualUploader();
  const uploaded: string[] = [];
  view = await mountI18n(createElement(PhotoGallery, { uploader: upload.uploader, imageEngine: small, onUploaded: (item: { file: File }) => uploaded.push(item.file.name), ...props } as never));
  const root = view.container;
  const input = root.querySelector("input[type='file'][multiple]") as HTMLInputElement;
  const choose = async (files: File[]) => {
    let current = files;
    Object.defineProperty(input, "files", { configurable: true, get: () => current, set: (next: Iterable<File>) => void (current = Array.from(next)) });
    Object.defineProperty(input, "value", { configurable: true, get: () => "", set: () => void (current = []) });
    await act(() => void input.dispatchEvent(new window.Event("change", { bubbles: true })));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
  };
  const rows = () => Array.from(root.querySelectorAll<HTMLElement>("li")).filter((li) => li.querySelector("[role='progressbar']"));
  const flush = (ms = 10) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return { root, input, choose, rows, flush, uploaded, ...upload };
}

describe("PhotoGallery", () => {
  it("Mehrfachauswahl: jedes Foto bekommt eine Zeile; zwei laufen gleichzeitig, das dritte wartet", async () => {
    const { choose, rows, calls } = await mountGallery();
    await choose([jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);
    assert.equal(rows().length, 3);
    assert.equal(calls.length, 2);
    assert.match(plain(rows()[0].textContent), /Wird hochgeladen, 0 %/);
    assert.match(plain(rows()[2].textContent), /Wartet/);
  });

  it("Fortschritt je Foto (Balken mit Wert und Name), danach „Hochgeladen“, das nächste startet, onUploaded meldet jedes Foto einmal", async () => {
    const { choose, rows, calls, flush, uploaded, root } = await mountGallery();
    await choose([jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);
    await act(() => calls[0].progress(0.4));
    const bar = rows()[0].querySelector("[role='progressbar']") as HTMLElement;
    assert.equal(bar.getAttribute("aria-valuenow"), "40");
    assert.match(bar.getAttribute("aria-label") ?? "", /Hochladen: a\.jpg/);
    assert.match(plain(rows()[0].textContent), /40 %/);
    await act(() => calls[0].finish());
    await flush();
    assert.match(plain(rows()[0].textContent), /Hochgeladen/);
    assert.equal(calls.length, 3, "die dritte Datei ist nachgerückt");
    await act(() => {
      calls[1].finish();
      calls[2].finish();
    });
    await flush();
    await flush();
    assert.deepEqual(uploaded.sort(), ["a.jpg", "b.jpg", "c.jpg"]);
    assert.match(plain(Array.from(root.querySelectorAll("p[role='status']")).at(-1)?.textContent), /3 von 3 Fotos hochgeladen/);
  });

  it("Fehler bleibt sichtbar mit verständlichem Grund; „Erneut versuchen“ lädt dasselbe Foto noch einmal; die anderen laufen weiter", async () => {
    const { choose, rows, calls, flush, root } = await mountGallery();
    await choose([jpeg("a.jpg"), jpeg("b.jpg")]);
    await act(() => calls[0].fail("network"));
    await flush();
    assert.match(plain(rows()[0].textContent), /Fehlgeschlagen: Keine Verbindung\./);
    assert.match(plain(rows()[1].textContent), /Wird hochgeladen/);
    const retry = root.querySelector("button[aria-label='a.jpg: erneut versuchen']");
    assert.ok(retry);
    await click(retry);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].file.name, "a.jpg");
    await act(() => calls[2].fail("http_413"));
    await flush();
    assert.match(plain(rows()[0].textContent), /Das Foto ist zu groß\./);
    await act(() => calls[1].finish());
  });

  it("Abbrechen bricht diesen Upload ab (Signal), die Zeile bleibt als „Abgebrochen“ und lässt sich wiederholen oder entfernen", async () => {
    const { choose, rows, calls, root, flush } = await mountGallery();
    await choose([jpeg("a.jpg")]);
    await click(root.querySelector("button[aria-label='a.jpg: abbrechen']"));
    assert.equal(calls[0].signal.aborted, true);
    assert.match(plain(rows()[0].textContent), /Abgebrochen/);
    await click(root.querySelector("button[aria-label='a.jpg: erneut versuchen']"));
    assert.equal(calls.length, 2);
    await act(() => calls[1].finish());
    await flush();
    await click(root.querySelector("button[aria-label='a.jpg: aus der Liste entfernen']"));
    assert.equal(rows().length, 0);
  });

  it("zu viele Fotos: nur der Rest bis zur Grenze kommt in die Liste, ein Hinweis nennt die Grenze; schon gespeicherte zählen mit", async () => {
    const { choose, rows, root } = await mountGallery({ maxFiles: 3, photos: [{ id: "p1", src: "/api/files/p1", name: "alt.jpg" }] });
    await choose([jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);
    assert.equal(rows().length, 2);
    assert.match(plain(root.querySelector("[role='alert']")?.textContent), /höchstens 3 Fotos/);
  });

  it("fertige Uploads zählen nicht doppelt: sobald die Seite sie als gespeicherte Fotos liefert, ist der Platz nur einmal belegt", async () => {
    const { PhotoGallery } = await import("./photo-gallery");
    const { choose, rows, calls, flush, uploader } = await mountGallery({ maxFiles: 3 });
    await choose([jpeg("a.jpg"), jpeg("b.jpg")]);
    await act(() => calls[0].finish());
    await act(() => calls[1].finish());
    await flush();
    // die Seite hat neu geladen und liefert die zwei Fotos als gespeicherte; die „fertig“-Zeilen stehen noch in der Liste
    const saved = [{ id: "p1", src: "/api/files/p1", name: "a.jpg" }, { id: "p2", src: "/api/files/p2", name: "b.jpg" }];
    await rerenderI18n(view!, createElement(PhotoGallery, { uploader, imageEngine: small, maxFiles: 3, photos: saved } as never));
    assert.equal(rows().length, 2);
    await choose([jpeg("c.jpg")]);
    assert.equal(rows().length, 3, "Platz für das dritte Foto (2 gespeichert + 1 neues = 3)");
    assert.equal(document.querySelector("[role='alert']"), null);
  });

  it("schon gespeicherte Fotos stehen als Bildliste vor den Uploads, mit Aktionen der Funktion; ohne Fotos der Leerhinweis", async () => {
    const { root } = await mountGallery({
      photos: [
        { id: "p1", src: "/api/files/p1", thumbSrc: "/api/files/p1?thumb=1", name: "Bremse links" },
        { id: "p2", src: "/api/files/p2", name: "Bremse rechts" },
      ],
      renderActions: (photo: { id: string }) => createElement("span", { "data-action": photo.id }, "Löschen"),
    });
    const images = Array.from(root.querySelectorAll("ul[aria-label='Fotos'] img"));
    assert.deepEqual(images.map((i) => i.getAttribute("alt")), ["Bremse links", "Bremse rechts"]);
    assert.equal(images[0].getAttribute("src"), "/api/files/p1?thumb=1");
    assert.deepEqual(Array.from(root.querySelectorAll("[data-action]")).map((a) => a.getAttribute("data-action")), ["p1", "p2"]);
    assert.equal(root.querySelector("a")?.getAttribute("target"), "_blank");
    await view?.unmount();
    const empty = await mountGallery();
    assert.match(plain(empty.root.textContent), /Noch keine Fotos/);
  });

  it("andere Dateien als Bilder werden nicht aufgenommen; das Eingabefeld ist für Mehrfachauswahl und Fotos gedacht (Kamera bei Touch)", async () => {
    const { choose, rows, input, root } = await mountGallery();
    assert.equal(input.accept, "image/*");
    assert.ok(root.querySelector("input[capture]"), "Kamera-Feld des Foto-Bausteins");
    await choose([new File(["x"], "notiz.pdf", { type: "application/pdf" })]);
    assert.equal(rows().length, 0);
  });

  it("der Server-Fehlertext des Aufrufers wird nie angezeigt: unbekannte Fehlercodes heißen „Das Hochladen hat nicht geklappt“", async () => {
    const { choose, rows, calls, flush } = await mountGallery();
    await choose([jpeg("a.jpg")]);
    await act(() => calls[0].fail("geheimer_pfad_/data/x"));
    await flush();
    assert.match(plain(rows()[0].textContent), /Fehlgeschlagen: Das Hochladen hat nicht geklappt\./);
    assert.doesNotMatch(plain(rows()[0].textContent), /geheimer_pfad/);
    assert.ok(byText(rows()[0], "button", /Erneut versuchen/));
  });
});
