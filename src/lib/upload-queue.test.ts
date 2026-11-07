import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUploadQueue, UploadError, xhrUploader, type Uploader } from "./upload-queue";

const file = (name: string, size = 100) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });

/** Uploader, den der Test von Hand steuert: jeder Aufruf bleibt offen, bis `finish`/`fail` kommt. */
function manual() {
  const calls: Array<{ file: File; attempt: number; progress: (f: number) => void; signal: AbortSignal; finish: (value?: unknown) => void; fail: (error?: unknown) => void }> = [];
  const uploader: Uploader = (f, ctx) =>
    new Promise((resolve, reject) => {
      calls.push({ file: f, attempt: ctx.attempt, progress: ctx.onProgress, signal: ctx.signal, finish: (value) => resolve(value ?? { ok: true }), fail: (error) => reject(error ?? new Error("kaputt")) });
    });
  return { calls, uploader };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Upload-Warteschlange", () => {
  it("höchstens zwei Dateien gleichzeitig; die nächste startet, sobald eine fertig ist", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader, concurrency: 2 });
    queue.add([file("a.jpg"), file("b.jpg"), file("c.jpg")]);
    assert.deepEqual(queue.items().map((i) => i.status), ["uploading", "uploading", "queued"]);
    assert.equal(calls.length, 2);
    calls[0].finish();
    await tick();
    assert.deepEqual(queue.items().map((i) => i.status), ["done", "uploading", "uploading"]);
    assert.equal(calls.length, 3);
    calls[1].finish();
    calls[2].finish();
    await queue.idle();
    assert.ok(queue.items().every((i) => i.status === "done" && i.progress === 1));
  });

  it("Fortschritt wächst nur, wird auf 0…1 begrenzt und gilt nur für laufende Uploads", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader });
    queue.add([file("a.jpg")]);
    calls[0].progress(0.4);
    calls[0].progress(0.2);
    assert.equal(queue.items()[0].progress, 0.4);
    calls[0].progress(7);
    assert.equal(queue.items()[0].progress, 1);
    calls[0].progress(-1);
    assert.equal(queue.items()[0].progress, 1);
    calls[0].finish();
    await queue.idle();
  });

  it("Fehler bleibt sichtbar (Code), die anderen Dateien laufen weiter; Wiederholen nimmt es neu auf", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader, concurrency: 1 });
    queue.add([file("a.jpg"), file("b.jpg")]);
    calls[0].fail(new UploadError("http_413"));
    await tick();
    assert.equal(queue.items()[0].status, "error");
    assert.equal(queue.items()[0].error, "http_413");
    assert.equal(queue.items()[1].status, "uploading", "die zweite Datei läuft trotz des Fehlers");
    calls[1].finish();
    await queue.idle();
    queue.retry(queue.items()[0].id);
    assert.equal(queue.items()[0].status, "uploading");
    assert.equal(queue.items()[0].attempts, 2);
    assert.equal(calls[2].attempt, 2);
    calls[2].finish({ id: "x1" });
    await queue.idle();
    assert.deepEqual(queue.items()[0].response, { id: "x1" });
    assert.equal(queue.items()[0].error, undefined);
  });

  it("unbekannte Fehler (kein UploadError) heißen „failed“ – keine Meldung aus dem Fehler selbst", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader });
    queue.add([file("a.jpg")]);
    calls[0].fail(new Error("geheime Pfade /data/files/…"));
    await tick();
    assert.equal(queue.items()[0].error, "failed");
  });

  it("Abbrechen löst das Signal aus, gilt sofort als abgebrochen und ein späteres Ergebnis ändert nichts mehr; Wiederholen geht", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader });
    queue.add([file("a.jpg")]);
    queue.cancel(queue.items()[0].id);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(queue.items()[0].status, "cancelled");
    calls[0].finish(); // die Antwort kam doch noch
    await tick();
    assert.equal(queue.items()[0].status, "cancelled");
    queue.retry(queue.items()[0].id);
    assert.equal(queue.items()[0].status, "uploading");
    calls[1].finish();
    await queue.idle();
    assert.equal(queue.items()[0].status, "done");
  });

  it("eine wartende Datei lässt sich abbrechen und startet dann nie", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader, concurrency: 1 });
    queue.add([file("a.jpg"), file("b.jpg")]);
    queue.cancel(queue.items()[1].id);
    calls[0].finish();
    await queue.idle();
    assert.equal(calls.length, 1);
    assert.deepEqual(queue.items().map((i) => i.status), ["done", "cancelled"]);
  });

  it("Entfernen nur für beendete Einträge", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader });
    queue.add([file("a.jpg")]);
    const id = queue.items()[0].id;
    queue.remove(id);
    assert.equal(queue.items().length, 1, "ein laufender Upload bleibt");
    calls[0].finish();
    await queue.idle();
    queue.remove(id);
    assert.equal(queue.items().length, 0);
  });

  it("lehnt vor dem Einreihen ab: zu groß, falscher Typ, zu viele – und reiht den Rest ein", () => {
    const { uploader } = manual();
    const queue = createUploadQueue({ uploader, maxBytes: 1000, maxFiles: 2, accept: (f) => f.type.startsWith("image/") });
    const result = queue.add([file("a.jpg", 10), file("big.jpg", 5000), new File(["x"], "x.pdf", { type: "application/pdf" }), file("b.jpg", 10), file("c.jpg", 10)]);
    assert.equal(result.added.length, 2);
    assert.deepEqual(result.rejected, [
      { name: "big.jpg", problem: "tooLarge" },
      { name: "x.pdf", problem: "type" },
      { name: "c.jpg", problem: "tooMany" },
    ]);
  });

  it("subscribe meldet jede Änderung (neuer Verweis auf die Liste) und lässt sich beenden", async () => {
    const { calls, uploader } = manual();
    const queue = createUploadQueue({ uploader });
    let count = 0;
    const stop = queue.subscribe(() => count++);
    const before = queue.items();
    queue.add([file("a.jpg")]);
    assert.notEqual(queue.items(), before);
    calls[0].progress(0.5);
    calls[0].finish();
    await queue.idle();
    const seen = count;
    assert.ok(seen >= 4);
    stop();
    queue.add([file("b.jpg")]);
    assert.equal(count, seen);
  });
});

describe("xhrUploader", () => {
  function fakeXhr(behaviour: (xhr: ReturnType<typeof create>) => void) {
    function create() {
      const sent: { method?: string; url?: string; headers: Record<string, string>; body?: FormData } = { headers: {} };
      const xhr = {
        sent,
        upload: { onprogress: null as null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) },
        onload: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        ontimeout: null as null | (() => void),
        timeout: 0,
        status: 0,
        responseText: "",
        open(method: string, url: string) {
          sent.method = method;
          sent.url = url;
        },
        setRequestHeader(name: string, value: string) {
          sent.headers[name] = value;
        },
        send(body: FormData) {
          sent.body = body;
          queueMicrotask(() => behaviour(xhr));
        },
        abort() {
          xhr.onabort?.();
        },
      };
      return xhr;
    }
    return create;
  }

  const ctx = (signal = new AbortController().signal, onProgress: (f: number) => void = () => {}) => ({ onProgress, signal, attempt: 1 });

  it("sendet Multipart mit Feld, Zusatzfeldern und dem Herkunftskopf; meldet Fortschritt; liefert die JSON-Antwort", async () => {
    let made: ReturnType<ReturnType<typeof fakeXhr>> | undefined;
    const create = fakeXhr((xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      xhr.status = 201;
      xhr.responseText = '{"id":"p1"}';
      xhr.onload?.();
    });
    const progress: number[] = [];
    const upload = xhrUploader("/api/files/orders/o1", { fields: { kind: "photo" }, createXhr: () => (made = create()) });
    const result = await upload(file("a.jpg", 20), ctx(undefined, (f) => progress.push(f)));
    assert.deepEqual(result, { id: "p1" });
    assert.deepEqual(progress, [0.5]);
    assert.equal(made!.sent.method, "POST");
    assert.equal(made!.sent.url, "/api/files/orders/o1");
    assert.equal(made!.sent.headers["X-Requested-With"], "schrauberos");
    assert.equal(made!.sent.body!.get("kind"), "photo");
    assert.equal((made!.sent.body!.get("file") as File).name, "a.jpg");
  });

  it("Statuscodes außerhalb 2xx, Netzwerkfehler und Zeitüberschreitung werden zu Fehlercodes", async () => {
    const run = (behave: (x: { status: number; onload: (() => void) | null; onerror: (() => void) | null; ontimeout: (() => void) | null }) => void) =>
      xhrUploader("/x", { createXhr: () => fakeXhr(behave as never)() as never })(file("a.jpg"), ctx());
    await assert.rejects(run((x) => { x.status = 413; x.onload?.(); }), (e: unknown) => e instanceof UploadError && e.code === "http_413");
    await assert.rejects(run((x) => x.onerror?.()), (e: unknown) => e instanceof UploadError && e.code === "network");
    await assert.rejects(run((x) => x.ontimeout?.()), (e: unknown) => e instanceof UploadError && e.code === "timeout");
  });

  it("Abbrechen bricht die Anfrage ab", async () => {
    const controller = new AbortController();
    const create = fakeXhr(() => {
      /* bleibt offen */
    });
    const promise = xhrUploader("/x", { createXhr: () => create() as never })(file("a.jpg"), ctx(controller.signal));
    controller.abort();
    await assert.rejects(promise, (e: unknown) => e instanceof UploadError && e.code === "aborted");
  });

  it("bereits abgebrochen: es wird gar nicht gesendet", async () => {
    const controller = new AbortController();
    controller.abort();
    let created = false;
    await assert.rejects(xhrUploader("/x", { createXhr: () => ((created = true), fakeXhr(() => {})() as never) })(file("a.jpg"), ctx(controller.signal)));
    assert.equal(created, false);
  });
});
