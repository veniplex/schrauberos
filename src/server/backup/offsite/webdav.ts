import { Readable, Transform } from "node:stream";
import type { RemoteEntry } from "@/lib/offsite/target";
import { OffsiteError, type OffsiteTransport } from "./transport";

/**
 * WebDAV-Ziel mit dem eingebauten `fetch` (kein Zusatzpaket): PROPFIND (Auflisten), PUT (Hochladen, gestreamt), GET, DELETE, MKCOL und MOVE (Umbenennen).
 *
 * Sicherheit: Die Adresse kommt von einem Administrator (`normalizeWebdavUrl`: HTTPS, ohne Zugangsdaten; Klartext nur für den eigenen Rechner). **Weiterleitungen werden nie verfolgt**
 * (`redirect: "manual"`; 3xx ist ein Fehler) – das Ziel kann die Anfrage samt Zugangsdaten also nicht auf einen anderen Host lenken. Zeitlimits: kurze Anfragen höchstens
 * `requestMs`, Übertragungen brechen ab, wenn `idleMs` lang keine Daten fließen.
 */
export type WebdavOptions = {
  fetchImpl?: typeof fetch;
  requestMs?: number;
  idleMs?: number;
};

const MULTISTATUS_MAX = 16 * 1024 * 1024;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Einträge einer Multistatus-Antwort (PROPFIND). Ohne XML-Bibliothek: nur die drei gebrauchten Eigenschaften, namensraumunabhängig; es werden keine Entitäten oder DTDs ausgewertet. */
export function parseMultistatus(xml: string): Array<{ href: string; collection: boolean; size: number; modifiedAt: Date | null }> {
  const entries: Array<{ href: string; collection: boolean; size: number; modifiedAt: Date | null }> = [];
  for (const block of xml.matchAll(/<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/gi)) {
    const body = block[1];
    const href = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i.exec(body)?.[1]?.trim();
    if (!href) continue;
    const length = /<(?:\w+:)?getcontentlength\b[^>]*>\s*(\d+)\s*</i.exec(body)?.[1];
    const modified = /<(?:\w+:)?getlastmodified\b[^>]*>([\s\S]*?)</i.exec(body)?.[1]?.trim();
    const date = modified ? new Date(modified) : null;
    entries.push({
      href: decode(href.replace(/&amp;/g, "&")),
      collection: /<(?:\w+:)?resourcetype\b[^>]*>[\s\S]*?<(?:\w+:)?collection\b/i.test(body),
      size: length ? Number(length) : 0,
      modifiedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    });
  }
  return entries;
}

export class WebdavTransport implements OffsiteTransport {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly requestMs: number;
  private readonly idleMs: number;
  private readonly authorization: string | null;

  constructor(baseUrl: string, credentials: { username: string; password?: string }, options: WebdavOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetchImpl ?? fetch;
    this.requestMs = options.requestMs ?? 30_000;
    this.idleMs = options.idleMs ?? 120_000;
    this.authorization = credentials.password ? `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64")}` : null;
  }

  private url(name?: string): string {
    return name === undefined ? this.base : `${this.base}/${encodeURIComponent(name)}`;
  }

  /** Eine Anfrage; Netzwerkfehler und Statuscodes werden zu `OffsiteError`. Wer den Rumpf nicht braucht, bekommt ihn verworfen. */
  private async request(method: string, url: string, init: { headers?: Record<string, string>; body?: ReadableStream | string; signal?: AbortSignal; timeoutMs?: number | null } = {}): Promise<Response> {
    const signals = [init.signal, init.timeoutMs === null ? undefined : AbortSignal.timeout(init.timeoutMs ?? this.requestMs)].filter((s): s is AbortSignal => !!s);
    const headers: Record<string, string> = { ...(this.authorization ? { Authorization: this.authorization } : {}), ...init.headers };
    let response: Response;
    try {
      response = await this.doFetch(url, {
        method,
        headers,
        body: init.body,
        redirect: "manual",
        signal: signals.length ? AbortSignal.any(signals) : undefined,
        ...(init.body && typeof init.body !== "string" ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new OffsiteError("timeout", method);
      const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
      throw new OffsiteError("connect", cause?.code ?? cause?.message ?? (error as Error)?.message ?? "fetch");
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new OffsiteError("server", `Weiterleitung (${response.status}) wird nicht verfolgt`);
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new OffsiteError("auth", String(response.status));
    }
    return response;
  }

  private async expect(response: Response, ok: readonly number[], what: string): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
    if (!ok.includes(response.status)) throw new OffsiteError(response.status === 404 ? "notFound" : "server", `${what}: ${response.status}`);
  }

  /** Das Verzeichnis gibt es? Sonst anlegen (eine Ebene; liegt der übergeordnete Ordner nicht vor, ist das ein Fehler des Ziels). */
  private async ensureCollection(signal?: AbortSignal): Promise<void> {
    const probe = await this.request("PROPFIND", this.url(), { headers: { Depth: "0", "Content-Type": "application/xml" }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>', signal });
    await probe.body?.cancel().catch(() => undefined);
    if (probe.status === 207 || probe.status === 200) return;
    if (probe.status !== 404) throw new OffsiteError("server", `PROPFIND: ${probe.status}`);
    await this.expect(await this.request("MKCOL", this.url(), { signal }), [200, 201, 204], "MKCOL");
  }

  async list(signal?: AbortSignal): Promise<RemoteEntry[]> {
    await this.ensureCollection(signal);
    const response = await this.request("PROPFIND", this.url(), {
      headers: { Depth: "1", "Content-Type": "application/xml" },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>',
      signal,
    });
    if (response.status !== 207) {
      await response.body?.cancel().catch(() => undefined);
      throw new OffsiteError("server", `PROPFIND: ${response.status}`);
    }
    const xml = await readLimited(response, MULTISTATUS_MAX);
    const basePath = decode(new URL(this.base).pathname).replace(/\/+$/, "");
    const out: RemoteEntry[] = [];
    for (const entry of parseMultistatus(xml)) {
      if (entry.collection) continue;
      let path = entry.href;
      try {
        path = decode(new URL(entry.href, this.base).pathname);
      } catch {
        /* relative Angabe wie geliefert */
      }
      if (!path.startsWith(`${basePath}/`)) continue;
      const name = path.slice(basePath.length + 1);
      if (!name || name.includes("/")) continue;
      out.push({ name, size: entry.size, modifiedAt: entry.modifiedAt });
    }
    return out;
  }

  async put(name: string, data: Readable, signal?: AbortSignal): Promise<void> {
    await this.ensureCollection(signal);
    const part = `${name}.part`;
    const guard = new AbortController();
    const body = Readable.toWeb(guarded(data, this.idleMs, () => guard.abort())) as ReadableStream;
    try {
      const put = await this.request("PUT", this.url(part), { headers: { "Content-Type": "application/octet-stream" }, body, signal: signal ? AbortSignal.any([signal, guard.signal]) : guard.signal, timeoutMs: null });
      await this.expect(put, [200, 201, 204], "PUT");
      const move = await this.request("MOVE", this.url(part), { headers: { Destination: this.url(name), Overwrite: "T" }, signal });
      await this.expect(move, [200, 201, 204], "MOVE");
    } catch (error) {
      data.destroy();
      await this.request("DELETE", this.url(part)).then((r) => r.body?.cancel(), () => undefined);
      throw error;
    }
  }

  async get(name: string, signal?: AbortSignal): Promise<Readable> {
    const guard = new AbortController();
    const response = await this.request("GET", this.url(name), { signal: signal ? AbortSignal.any([signal, guard.signal]) : guard.signal, timeoutMs: null });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new OffsiteError("notFound", name);
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new OffsiteError("server", `GET: ${response.status}`);
    }
    return guarded(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), this.idleMs, () => guard.abort());
  }

  async remove(name: string): Promise<void> {
    const response = await this.request("DELETE", this.url(name));
    await this.expect(response, [200, 202, 204, 404], "DELETE");
  }

  async close(): Promise<void> {
    /* verbindungslos */
  }
}

/** Leitet `source` durch einen Wächter gegen hängende Übertragungen; Fehler der Quelle erreichen den Empfänger (kein ewiges Warten). */
function guarded(source: Readable, ms: number, onIdle: () => void): Transform {
  const guard = idleGuard(ms, onIdle);
  source.once("error", (error) => guard.destroy(error));
  return source.pipe(guard);
}

/** Durchlauf-Strom, der `onIdle` auslöst, wenn `ms` lang keine Daten kommen (hängende Übertragung). */
export function idleGuard(ms: number, onIdle: () => void): Transform {
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, ms);
    timer.unref();
  };
  arm();
  return new Transform({
    transform(chunk, _encoding, callback) {
      arm();
      callback(null, chunk);
    },
    flush(callback) {
      clearTimeout(timer);
      callback();
    },
    destroy(error, callback) {
      clearTimeout(timer);
      callback(error);
    },
  });
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new OffsiteError("server", "Antwort zu groß");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
