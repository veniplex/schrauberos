/**
 * Warteschlange für Mehrfach-Uploads (Foto-Galerie am Auftrag und am Fahrzeug): jede Datei einzeln mit Fortschritt, höchstens `concurrency` gleichzeitig, **Wiederholen bei Fehler**
 * und **Abbrechen** je Datei. **Keine Dubletten:** jede Datei bekommt beim Einreihen einen Idempotenzschlüssel (`UploadItem.key`), der bei jedem Wiederholen derselbe bleibt und mit jedem Versuch an den Uploader geht
 * (`xhrUploader` sendet ihn als `Idempotency-Key`): ging die Antwort verloren, obwohl der Server das Foto schon abgelegt hat, erkennt die Upload-Route die Wiederholung – die Warteschlange selbst kann das nicht wissen.
 * Dieselbe Datei (Name, Größe, Änderungszeit) lässt sich nicht zweimal einreihen (`duplicate`). Reine Logik ohne DOM – das Hochladen selbst steckt hinter `Uploader` (im Browser `xhrUploader`, im Test eine Attrappe). Die Warteschlange glaubt dem Server nichts
 * und dem Browser nur das Nötigste: Größe und Zahl werden vor dem Einreihen geprüft, der Server prüft alles noch einmal (Magic Bytes, Pixelgrenzen, EXIF, Recht).
 */

export type UploadStatus = "queued" | "uploading" | "done" | "error" | "cancelled";
export type UploadProblem = "tooLarge" | "tooMany" | "type" | "duplicate";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  /** 0 … 1, wächst nur */
  progress: number;
  /** Idempotenzschlüssel dieser Datei: bleibt bei jedem Wiederholen gleich */
  key: string;
  /** Fehlercode des letzten Versuchs (`network`, `http_413`, `failed` …) */
  error?: string;
  /** Antwort des Servers nach Erfolg */
  response?: unknown;
  attempts: number;
};

export type UploadContext = { onProgress: (fraction: number) => void; signal: AbortSignal; attempt: number; idempotencyKey: string };
export type Uploader = (file: File, context: UploadContext) => Promise<unknown>;

export class UploadError extends Error {
  constructor(readonly code: string) {
    super(`Upload: ${code}`);
    this.name = "UploadError";
  }
}

export type UploadQueueOptions = {
  uploader: Uploader;
  concurrency?: number;
  /** höchstens so viele Dateien in der Liste; **fertige zählen nicht mit** (sie stehen beim Aufrufer längst in dessen Liste, sonst würden sie doppelt gerechnet) */
  maxFiles?: number;
  /** Größe je Datei in Bytes (nach dem Verkleinern) */
  maxBytes?: number;
  accept?: (file: File) => boolean;
};

export type UploadQueue = {
  add(files: readonly File[]): { added: string[]; rejected: Array<{ name: string; problem: UploadProblem }> };
  retry(id: string): void;
  cancel(id: string): void;
  /** nimmt einen beendeten Eintrag (fertig, Fehler, abgebrochen) aus der Liste */
  remove(id: string): void;
  items(): readonly UploadItem[];
  subscribe(listener: () => void): () => void;
  /** wartet, bis nichts mehr läuft oder wartet (für Tests und „Speichern erst nach dem Hochladen“) */
  idle(): Promise<void>;
};

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  let list: UploadItem[] = [];
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const waiters = new Set<() => void>();
  let counter = 0;
  const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2)}`;
  const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

  const emit = () => {
    for (const listener of listeners) listener();
    if (!list.some((item) => item.status === "queued" || item.status === "uploading")) for (const wake of [...waiters]) wake();
  };
  const patch = (id: string, change: Partial<UploadItem>) => {
    // neue Liste und neues Element: `useSyncExternalStore` erkennt die Änderung am Verweis
    list = list.map((item) => (item.id === id ? { ...item, ...change } : item));
    emit();
  };

  async function run(item: UploadItem) {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    patch(item.id, { status: "uploading", progress: 0, error: undefined, attempts: item.attempts + 1 });
    try {
      const response = await options.uploader(item.file, {
        attempt: item.attempts + 1,
        idempotencyKey: item.key,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (controller.signal.aborted) return;
          const current = list.find((i) => i.id === item.id);
          const next = Math.min(1, Math.max(0, fraction));
          if (current && current.status === "uploading" && next > current.progress) patch(item.id, { progress: next });
        },
      });
      if (controller.signal.aborted) return; // abgebrochen, während die Antwort unterwegs war: gilt als abgebrochen
      patch(item.id, { status: "done", progress: 1, response });
    } catch (error) {
      if (controller.signal.aborted) return;
      patch(item.id, { status: "error", error: error instanceof UploadError ? error.code : "failed" });
    } finally {
      // nur den eigenen Controller entfernen: ein neuer Lauf derselben Datei (Wiederholen nach Abbrechen) hat inzwischen einen eigenen
      if (controllers.get(item.id) === controller) controllers.delete(item.id);
      pump();
    }
  }

  function pump() {
    const running = list.filter((item) => item.status === "uploading").length;
    const free = concurrency - running;
    if (free <= 0) return;
    for (const item of list.filter((i) => i.status === "queued").slice(0, free)) void run(item);
  }

  return {
    add(files) {
      const added: string[] = [];
      const rejected: Array<{ name: string; problem: UploadProblem }> = [];
      for (const file of files) {
        let problem: UploadProblem | null = null;
        if (options.accept && !options.accept(file)) problem = "type";
        else if (options.maxBytes !== undefined && file.size > options.maxBytes) problem = "tooLarge";
        else if (list.some((item) => sameFile(item.file, file))) problem = "duplicate";
        else if (options.maxFiles !== undefined && list.filter((item) => item.status !== "done").length >= options.maxFiles) problem = "tooMany";
        if (problem) {
          rejected.push({ name: file.name, problem });
          continue;
        }
        const id = `u${++counter}`;
        list = [...list, { id, file, key: newKey(), status: "queued", progress: 0, attempts: 0 }];
        added.push(id);
      }
      if (added.length) {
        emit();
        pump();
      }
      return { added, rejected };
    },
    retry(id) {
      const item = list.find((i) => i.id === id);
      if (!item || (item.status !== "error" && item.status !== "cancelled")) return;
      patch(id, { status: "queued", progress: 0, error: undefined });
      pump();
    },
    cancel(id) {
      const item = list.find((i) => i.id === id);
      if (!item || (item.status !== "queued" && item.status !== "uploading")) return;
      controllers.get(id)?.abort();
      patch(id, { status: "cancelled" });
      pump();
    },
    remove(id) {
      const item = list.find((i) => i.id === id);
      if (!item || item.status === "queued" || item.status === "uploading") return;
      list = list.filter((i) => i.id !== id);
      emit();
    },
    items: () => list,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    idle() {
      if (!list.some((item) => item.status === "queued" || item.status === "uploading")) return Promise.resolve();
      return new Promise((resolve) => {
        const wake = () => {
          waiters.delete(wake);
          resolve();
        };
        waiters.add(wake);
      });
    },
  };
}

/* ------------------------------------------------------------------ Browser: XMLHttpRequest mit Fortschritt */

type XhrLike = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: FormData): void;
  abort(): void;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  timeout: number;
  status: number;
  responseText: string;
};

/**
 * Lädt eine Datei als Multipart-Formular hoch (`fetch` kennt keinen Fortschritt beim Senden). Dieselbe Herkunft, mit `X-Requested-With: schrauberos` (Upload-Routen verlangen es,
 * `src/server/request-guard.ts`). Erfolg (2xx) liefert die JSON-Antwort (sonst den Text); alles andere wirft `UploadError("http_<Status>")`, ein Netzwerkfehler `UploadError("network")`.
 * `Idempotency-Key` ist der Schlüssel der Datei (derselbe bei jedem Versuch): Die Upload-Route legt eine Datei mit bekanntem Schlüssel nicht noch einmal ab, sondern antwortet wie beim ersten Mal.
 * Der Server verlangt für Datei-Uploads `Content-Length` – ein `FormData`-Body bekommt sie vom Browser automatisch.
 */
export function xhrUploader(url: string, options: { field?: string; fields?: Record<string, string>; timeoutMs?: number; createXhr?: () => XhrLike } = {}): Uploader {
  return (file, { onProgress, signal, idempotencyKey }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new UploadError("aborted"));
      const xhr = options.createXhr ? options.createXhr() : (new XMLHttpRequest() as unknown as XhrLike);
      const form = new FormData();
      for (const [key, value] of Object.entries(options.fields ?? {})) form.append(key, value);
      form.append(options.field ?? "file", file, file.name);
      xhr.open("POST", url);
      xhr.setRequestHeader("X-Requested-With", "schrauberos");
      xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
      xhr.timeout = options.timeoutMs ?? 120_000;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
          } catch {
            resolve(xhr.responseText);
          }
        } else reject(new UploadError(`http_${xhr.status}`));
      };
      xhr.onerror = () => reject(new UploadError("network"));
      xhr.ontimeout = () => reject(new UploadError("timeout"));
      xhr.onabort = () => reject(new UploadError("aborted"));
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(form);
    });
}
