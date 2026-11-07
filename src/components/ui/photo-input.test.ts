import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import type { ImageEngine, OutputType } from "@/lib/image-resize";
import { act, installDom, mount, type MountedView, type TestDom } from "@/test/dom";

/**
 * Foto-Baustein (`FileInput variant="photo"`) in einem echten Renderer: Die Datei im Feld ist nach der Wahl die verkleinerte (so sendet ein Formular mit Server Action sie),
 * `maxBytes` gilt für das Ergebnis, ein Foto in HEIC bekommt eine Erklärung, während der Verarbeitung lässt sich nicht absenden, und die Kamera legt ihr Foto ins Feld.
 * Die Skalierung selbst ist eine Fake-Engine (Canvas gibt es hier nicht) – die Entscheidungen testet `image-resize.test.ts`.
 */
const MB = 1024 * 1024;
let dom: TestDom;
let view: MountedView | null = null;

// happy-dom nimmt in `DataTransfer` nur eigene Dateien an (der Browser hat nur eine Art `File`/`Blob`): für diesen Test gelten die des DOM
const nodeTypes = { File: globalThis.File, Blob: globalThis.Blob };
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

const jpegHead = [0xff, 0xd8, 0xff, 0xe0];
function photo(name: string, size: number, head: number[] = jpegHead) {
  const body = new Uint8Array(size);
  body.set(head);
  return new File([body], name, { type: "image/jpeg" });
}

function engine(options: { scaledBytes?: number; fail?: boolean; failIf?: (file: File) => boolean; gate?: Promise<void> } = {}): ImageEngine & { encoded: number } {
  const e = {
    encoded: 0,
    async decode(file: Blob) {
      await options.gate;
      if (options.fail || options.failIf?.(file as File)) throw new Error("kein Dekoder");
      return { width: 4000, height: 3000 };
    },
    async encode(_r: unknown, _w: number, _h: number, type: OutputType) {
      e.encoded++;
      return new Blob([new Uint8Array(options.scaledBytes ?? 900 * 1024)], { type });
    },
  };
  return e;
}

/** Wie das Dateifenster: Das Feld bekommt Dateien und meldet `change`; `files` lässt sich – wie im Browser – neu setzen. */
async function choose(input: HTMLInputElement, files: File[]) {
  let current: File[] = files;
  Object.defineProperty(input, "files", {
    configurable: true,
    get: () => current,
    set: (next: Iterable<File>) => {
      current = Array.from(next);
    },
  });
  await act(() => void input.dispatchEvent(new window.Event("change", { bubbles: true })));
  // die Verarbeitung ist asynchron
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
}

async function mountPhoto(props: Record<string, unknown> = {}, extra: ReactElement[] = []) {
  const { FileInput } = await import("./form");
  const { I18nProvider } = await import("@/i18n/client");
  const { ToastProvider } = await import("./toast");
  const { de } = await import("@/i18n/messages/de");
  const changes: File[][] = [];
  const submitted: number[] = [];
  view = await mount(
    createElement(
      I18nProvider,
      { locale: "de", messages: de } as never,
      createElement(
        ToastProvider,
        null,
        createElement(
          "form",
          { onSubmit: (event: Event) => (event.preventDefault(), submitted.push(1)) },
          createElement(FileInput, { name: "file", variant: "photo", onChange: (e: { target: HTMLInputElement }) => changes.push(Array.from(e.target.files ?? [])), ...props } as never),
          ...extra,
        ),
      ),
    ),
  );
  const root = view.container;
  const main = root.querySelector("input[type='file'][name='file']") as HTMLInputElement;
  const camera = root.querySelector("input[capture]") as HTMLInputElement | null;
  return { root, main, camera, changes, submitted, form: root.querySelector("form") as HTMLFormElement, text: () => root.textContent ?? "" };
}

describe("FileInput variant=photo", () => {
  it("ein simuliertes 6-MB-Foto wird mit unter 2 MB angenommen: das Feld enthält die verkleinerte Datei, onChange meldet sie", async () => {
    const e = engine({ scaledBytes: 900 * 1024 });
    const { main, changes, text } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: e });
    await choose(main, [photo("IMG_0042.JPG", 6 * MB)]);
    assert.equal(e.encoded, 1);
    const sent = Array.from(main.files ?? []);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].size < 2 * MB, `Größe im Feld ${sent[0].size}`);
    assert.equal(sent[0].name, "IMG_0042.jpg");
    assert.equal(sent[0].type, "image/jpeg");
    assert.equal(changes.length, 1, "onChange genau einmal, mit der verkleinerten Datei");
    assert.equal(changes[0][0].size, sent[0].size);
    assert.doesNotMatch(text(), /zu groß/);
    assert.equal(main.getAttribute("aria-invalid"), null);
  });

  it("maxBytes gilt für das Ergebnis: ist auch das verkleinerte Foto zu groß, wird es abgelehnt und das Feld geleert", async () => {
    const e = engine({ scaledBytes: 3 * MB });
    const { main, changes, text } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: e });
    await choose(main, [photo("a.jpg", 9 * MB)]);
    assert.match(text(), /Datei zu groß \(max\. 2 MB\)/);
    assert.equal(changes.length, 0);
    assert.equal(main.getAttribute("aria-invalid"), "true");
  });

  it("PDF bleibt unverändert und wird nicht verarbeitet", async () => {
    const e = engine();
    const { main, changes } = await mountPhoto({ maxBytes: 10 * MB, imageEngine: e });
    const pdf = new File([new Uint8Array(3 * MB)], "rechnung.pdf", { type: "application/pdf" });
    await choose(main, [pdf]);
    assert.equal(e.encoded, 0);
    assert.equal(Array.from(main.files ?? [])[0], pdf);
    assert.equal(changes.length, 1);
  });

  it("ein HEIC-Foto, das der Browser nicht dekodiert, bekommt eine verständliche Erklärung und das Feld wird geleert", async () => {
    const e = engine({ fail: true });
    const { main, changes, text } = await mountPhoto({ maxBytes: 10 * MB, imageEngine: e });
    await choose(main, [new File([new Uint8Array(4 * MB)], "IMG_1.HEIC", { type: "image/heic" })]);
    assert.match(text(), /HEIC/);
    assert.match(text(), /JPEG/);
    assert.equal(changes.length, 0);
  });

  it("onReject bekommt den Grund (das Dateifeld des Doku-Editors zeigt die Meldung selbst)", async () => {
    const reasons: Array<string | undefined> = [];
    const { main, text } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: engine({ scaledBytes: 3 * MB }), onReject: (_f: File, reason?: string) => reasons.push(reason) });
    await choose(main, [photo("a.jpg", 9 * MB)]);
    assert.deepEqual(reasons, ["tooLarge"]);
    assert.doesNotMatch(text(), /zu groß/, "keine eigene Meldung, wenn der Aufrufer meldet");
  });

  it("während das Foto verkleinert wird, lässt sich das Formular nicht absenden (sonst ginge das Original hoch); danach schon", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { main, form, submitted, root } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: engine({ gate }) });
    await act(() => {
      Object.defineProperty(main, "files", { configurable: true, get: () => [photo("a.jpg", 6 * MB)], set: () => undefined });
      main.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.match(root.querySelector("[role='status']")?.textContent ?? "", /Foto wird verkleinert/);
    await act(() => void form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(submitted.length, 0, "Absenden blockiert");
    await act(async () => {
      release();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(root.querySelector("[role='status']")?.textContent, "", "Hinweis weg");
    await act(() => void form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(submitted.length, 1, "danach lässt es sich absenden");
  });

  it("Kamera: ein eigenes Feld mit capture; das Foto landet verkleinert im eigentlichen Feld und wird dort wie jede Auswahl gemeldet", async () => {
    const e = engine({ scaledBytes: 800 * 1024 });
    const { main, camera, changes, root } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: e });
    assert.ok(camera, "Kamerafeld vorhanden");
    assert.equal(camera.getAttribute("capture"), "environment");
    assert.equal(camera.getAttribute("accept"), "image/*");
    assert.ok([...root.querySelectorAll("button")].some((b) => /Foto aufnehmen/.test(b.textContent ?? "")), "Knopf „Foto aufnehmen“");
    // das eigentliche Feld muss `files` setzen können
    let mainFiles: File[] = [];
    Object.defineProperty(main, "files", { configurable: true, get: () => mainFiles, set: (next: Iterable<File>) => void (mainFiles = Array.from(next)) });
    await choose(camera, [photo("kamera.jpg", 5 * MB)]);
    assert.equal(mainFiles.length, 1);
    assert.ok(mainFiles[0].size < 2 * MB);
    assert.equal(changes.length, 1, "genau eine Meldung");
    assert.equal(e.encoded, 1, "nicht doppelt verkleinert");
  });

  it("Mehrfachauswahl: eine HEIC-Datei, die nicht zu dekodieren ist, hält die übrigen nicht auf – sie bleiben im Feld, ein Hinweis nennt den Grund", async () => {
    const e = engine({ scaledBytes: 500 * 1024, failIf: (f) => /.heic$/i.test(f.name) });
    const { main, changes, text } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: e, multiple: true });
    await choose(main, [photo("a.jpg", 5 * MB), new File([new Uint8Array(3 * MB)], "b.HEIC", { type: "image/heic" }), photo("c.jpg", 4 * MB)]);
    const current = () => Array.from(main.files ?? []);
    assert.deepEqual(current().map((f) => f.name), ["a.jpg", "c.jpg"], "die HEIC-Datei ist aussortiert, die anderen verkleinert");
    assert.ok(current().every((f) => f.size < 2 * MB));
    assert.equal(changes.length, 1);
    assert.match(text(), /HEIC/);
  });

  it("Mehrfachauswahl: zu große Dateien fallen einzeln weg, bleibt nichts übrig, wird abgelehnt und das Feld geleert", async () => {
    const e = engine({ scaledBytes: 500 * 1024 });
    const { main, changes, text } = await mountPhoto({ maxBytes: 2 * MB, imageEngine: e, multiple: true });
    const pdf = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
    await choose(main, [pdf("klein.pdf", MB), pdf("riesig.pdf", 5 * MB)]);
    assert.deepEqual(Array.from(main.files ?? []).map((f) => f.name), ["klein.pdf"]);
    assert.equal(changes.length, 1);
    assert.match(text(), /Datei zu groß \(max\. 2 MB\)/);
    await choose(main, [pdf("riesig1.pdf", 5 * MB), pdf("riesig2.pdf", 6 * MB)]);
    assert.equal(changes.length, 1, "nichts übrig: abgelehnt");
  });

  it("camera={false} lässt den Kamera-Knopf weg; die normale Variante verarbeitet nichts und hat keine Kamera", async () => {
    const { FileInput } = await import("./form");
    const { I18nProvider } = await import("@/i18n/client");
    const { de } = await import("@/i18n/messages/de");
    const none = await mountPhoto({ camera: false, imageEngine: engine() });
    assert.equal(none.camera, null);
    await view?.unmount();
    view = await mount(createElement(I18nProvider, { locale: "de", messages: de } as never, createElement(FileInput, { name: "file", maxBytes: 10 * MB })));
    assert.equal(view.container.querySelector("input[capture]"), null);
    assert.equal(view.container.querySelector("[role='status']"), null);
  });
});
