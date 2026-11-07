import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { canonicalHost, isAllowedAddress, isForbiddenHost } from "@/lib/offsite/host-policy";
import { OffsiteError } from "./transport";

/**
 * Namensauflösung vor dem Verbinden (ZP5-6): Der Host wird **aufgelöst, alle Antworten werden gegen die Richtlinie geprüft** (`lib/offsite/host-policy.ts`), und verbunden wird mit der
 * **geprüften Adresse** – nicht noch einmal mit dem Namen. So kann ein Name, der zwischen Prüfung und Verbindung auf eine andere Adresse zeigt (DNS-Rebinding), nichts mehr umlenken.
 * Gilt für jede Verbindung (jeden Lauf, jeden Test, jede Hostschlüssel-Abfrage), nicht nur beim Speichern der Einstellungen.
 */
export type PinnedAddress = { address: string; family: 4 | 6 };

const LOOKUP_MS = 10_000;

type Lookup = (name: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;

/** `lookupImpl`: nur für Tests (Antworten der Namensauflösung vorgeben, etwa für DNS-Rebinding). */
export async function resolvePinned(host: string, lookupImpl: Lookup = lookup as Lookup): Promise<PinnedAddress> {
  const canonical = canonicalHost(host);
  if (!canonical) throw new OffsiteError("config", "Adresse");
  if (isForbiddenHost(host)) throw new OffsiteError("forbiddenHost");
  if (canonical.kind === "ip") return { address: canonical.ip, family: isIP(canonical.ip) as 4 | 6 };

  let timer: NodeJS.Timeout | undefined;
  try {
    const addresses = await Promise.race([
      lookupImpl(canonical.name, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new OffsiteError("timeout", "Namensauflösung")), LOOKUP_MS))),
    ]);
    if (addresses.length === 0) throw new OffsiteError("connect", "ENOTFOUND");
    // Jede Antwort muss erlaubt sein: ein Name mit einer erlaubten und einer verbotenen Adresse wäre ein Umlenkversuch
    if (addresses.some((entry) => !isAllowedAddress(entry.address))) throw new OffsiteError("forbiddenHost");
    return { address: addresses[0].address, family: addresses[0].family as 4 | 6 };
  } catch (error) {
    if (error instanceof OffsiteError) throw error;
    const code = (error as { code?: string }).code;
    throw new OffsiteError("connect", typeof code === "string" ? code : "Namensauflösung");
  } finally {
    clearTimeout(timer);
  }
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * `fetch`-Ersatz, der **nur die geprüfte Adresse** verbindet (`lookup` ist festgelegt), den Namen aber für SNI und Zertifikatsprüfung beibehält (HTTPS bleibt vollständig
 * geprüft). Umfang: das, was das WebDAV-Ziel braucht – Methode, Kopfzeilen, Rumpf als Text oder Strom, Abbruchsignal, keine Weiterleitungen. Fehler haben die Form von `fetch`
 * (`TypeError: fetch failed` mit `cause`), damit `WebdavTransport` sie wie bisher abbildet.
 */
export function pinnedFetch(pin: PinnedAddress): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const client = url.protocol === "https:" ? https : http;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    return new Promise<Response>((resolve, reject) => {
      const fail = (error: unknown) => {
        const name = (error as Error)?.name;
        if (name === "AbortError" || name === "TimeoutError") return reject(error);
        reject(Object.assign(new TypeError("fetch failed"), { cause: error }));
      };
      const request = client.request(
        url,
        {
          method: init.method ?? "GET",
          headers,
          agent: false,
          signal: init.signal ?? undefined,
          lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
            options?.all ? callback(null, [{ address: pin.address, family: pin.family }]) : callback(null, pin.address, pin.family)) as never,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const responseHeaders = new Headers();
          for (let i = 0; i + 1 < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          resolve(new Response(NULL_BODY.has(status) ? null : (Readable.toWeb(response) as unknown as ReadableStream), { status, statusText: response.statusMessage, headers: responseHeaders }));
        },
      );
      request.on("error", fail);
      const body = init.body;
      if (body === undefined || body === null) request.end();
      else if (typeof body === "string") request.end(body);
      else {
        const source = Readable.fromWeb(body as never);
        source.on("error", (error) => request.destroy(error));
        source.pipe(request);
      }
    });
  }) as typeof fetch;
}
