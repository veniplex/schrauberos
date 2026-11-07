import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, it } from "node:test";
import { CACHE_PREFIX } from "./sw-client";

/**
 * Service Worker (`public/sw.js`, P3-5): **dieselbe Datei**, die ausgeliefert wird, läuft hier in einem nachgebauten `ServiceWorkerGlobalScope` (Zwischenspeicher im Speicher, Netz als
 * Funktion). Geprüft wird, was ihn gefährlich machen könnte: Er darf nichts außer der Offline-Seite und gehashten Programmdateien speichern und muss alles andere
 * (PDF-Vorschau, Downloads, iCal, Dateien, Teilanfragen, Formulare, fremde Herkünfte) unberührt lassen.
 */
const SOURCE = readFileSync(path.resolve(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://werkstatt.example";

type Exports = {
  classify(request: unknown, origin: string): "navigation" | "static" | "pass";
  isCacheableStatic(response: unknown): boolean;
  isOfflinePage(response: unknown): boolean;
  versionOf(href: string): string;
  cacheNames(): { static: string; offline: string };
  OFFLINE_PATH: string;
  MAX_STATIC_ENTRIES: number;
};

const urlOf = (request: unknown) => new URL(typeof request === "string" ? request : (request as { url: string }).url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();
  async match(request: unknown) {
    return this.entries.get(urlOf(request))?.clone();
  }
  async put(request: unknown, response: Response) {
    this.entries.set(urlOf(request), response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request: unknown) {
    return this.entries.delete(urlOf(request));
  }
}
class FakeCaches {
  store = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.store.has(name)) this.store.set(name, new FakeCache());
    return this.store.get(name)!;
  }
  async keys() {
    return [...this.store.keys()];
  }
  async delete(name: string) {
    return this.store.delete(name);
  }
}

const OFFLINE_HTML = "<!doctype html><title>Offline</title>";
const html = (body = OFFLINE_HTML, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
/** Antwort derselben Herkunft (`type: "basic"`), wie sie `fetch` im Service Worker liefert. */
const basic = (response: Response) => Object.defineProperty(response, "type", { value: "basic" });

type FetchCall = { input: unknown; init?: Record<string, unknown> };
type Setup = ReturnType<typeof setup>;

function setup(version = "1.2.3+abc") {
  const caches = new FakeCaches();
  const calls: FetchCall[] = [];
  const state = { online: true, claimed: 0, skipped: 0, routes: new Map<string, () => Response>() };
  const listeners = new Map<string, (event: unknown) => void>();
  const scope = {
    location: new URL(`${ORIGIN}/sw.js?v=${encodeURIComponent(version)}`),
    caches,
    clients: { claim: async () => void state.claimed++ },
    skipWaiting: () => void state.skipped++,
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    fetch: async (input: unknown, init?: Record<string, unknown>) => {
      calls.push({ input, init });
      if (!state.online) throw new TypeError("Failed to fetch");
      const route = state.routes.get(new URL(urlOf(input)).pathname);
      return route ? route() : basic(new Response("nicht gefunden", { status: 404 }));
    },
  };
  const sandboxModule = { exports: {} as Exports };
  vm.runInNewContext(SOURCE, { self: scope, URL, Response, module: sandboxModule, Promise }, { filename: "sw.js" });
  const exported = sandboxModule.exports;

  /** Ereignis auslösen und alles abwarten, was der Service Worker mit `waitUntil` verlangt. */
  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    const event = { ...extra, waitUntil: (p: Promise<unknown>) => void waits.push(Promise.resolve(p)), respondWith: (p: Promise<Response>) => void (responded = Promise.resolve(p)) };
    listeners.get(type)!(event);
    await Promise.all(waits);
    return { responded, response: responded ? await responded : undefined };
  }
  const request = (url: string, extra: Record<string, unknown> = {}) => ({ url: url.startsWith("http") ? url : `${ORIGIN}${url}`, method: "GET", mode: "cors", destination: "", headers: new Headers(), ...extra });
  const navigate = (url: string, extra: Record<string, unknown> = {}) => request(url, { mode: "navigate", destination: "document", ...extra });
  return { scope, caches, calls, state, exported, dispatch, request, navigate, listeners };
}

describe("Service Worker: classify (welche Anfrage berührt er?)", () => {
  let sw: Setup;
  beforeEach(() => void (sw = setup()));
  const kind = (request: unknown) => sw.exported.classify(request, ORIGIN);

  it("Seitenaufruf (navigate + document) und gehashte Programmdateien: ja", () => {
    assert.equal(kind(sw.navigate("/customers")), "navigation");
    assert.equal(kind(sw.navigate("/")), "navigation");
    assert.equal(kind(sw.request("/_next/static/chunks/abc123.js")), "static");
    assert.equal(kind(sw.request("/_next/static/media/font.woff2", { destination: "font" })), "static");
  });

  it("alles unter /api bleibt unberührt – PDF-Vorschau (iframe) und Download (Seitenaufruf), iCal, Dateien, Suche, Health", () => {
    for (const url of ["/api/invoices/abc/file", "/api/invoices/abc/file?download=1", "/api/docs/images/abc", "/api/ical/token.ics", "/api/v1/customers", "/api/search?q=a", "/api/health", "/api/backups/x", "/api/logo", "/api"]) {
      assert.equal(kind(sw.navigate(url)), "pass", `${url} (Seitenaufruf, z. B. Download)`);
      assert.equal(kind(sw.request(url, { destination: "iframe", mode: "navigate" })), "pass", `${url} (iframe)`);
      assert.equal(kind(sw.request(url)), "pass", `${url} (fetch)`);
    }
  });

  it("eingebettete Rahmen, Formular-Absenden, Server Actions, Teilanfragen, fremde Herkunft und andere Methoden: nein", () => {
    assert.equal(kind(sw.request("/customers", { mode: "navigate", destination: "iframe" })), "pass");
    assert.equal(kind(sw.request("/customers", { mode: "navigate", destination: "frame" })), "pass");
    assert.equal(kind(sw.request("/customers", { mode: "navigate", destination: "object" })), "pass");
    assert.equal(kind(sw.navigate("/customers", { method: "POST" })), "pass");
    assert.equal(kind(sw.request("/customers", { method: "POST", headers: new Headers({ "next-action": "x" }) })), "pass");
    assert.equal(kind(sw.navigate("/customers/x/edit", { method: "PUT" })), "pass");
    assert.equal(kind(sw.navigate("/vehicles/print", { headers: new Headers({ range: "bytes=0-99" }) })), "pass");
    assert.equal(kind(sw.request("/_next/static/chunks/a.js", { headers: new Headers({ range: "bytes=0-9" }) })), "pass");
    assert.equal(kind(sw.navigate("https://fremd.example/customers")), "pass");
    assert.equal(kind(sw.request("https://fremd.example/_next/static/a.js")), "pass");
    assert.equal(kind(sw.request("/manifest.webmanifest")), "pass");
    assert.equal(kind(sw.request("/icons/icon-192.png", { destination: "image" })), "pass");
    assert.equal(kind(sw.request("/customers", { destination: "" })), "pass", "ein fetch() der Seite selbst (kein Seitenaufruf)");
    assert.equal(kind({ url: "kein url", method: "GET", headers: new Headers() }), "pass");
  });

  it("Pfade, die nur so aussehen: /apixyz ist eine Seite, /_next/static ohne Schrägstrich keine Datei", () => {
    assert.equal(kind(sw.navigate("/apixyz")), "navigation");
    assert.equal(kind(sw.request("/_next/staticfoo/a.js")), "pass");
    assert.equal(kind(sw.request("/x/_next/static/a.js")), "pass");
  });
});

describe("Service Worker: Version und Zwischenspeicher", () => {
  it("die Version stammt aus ?v= der Adresse; die Namen der Zwischenspeicher tragen sie und das Präfix der App", () => {
    const sw = setup("1.2.3+abc");
    assert.deepEqual({ ...sw.exported.cacheNames() }, { static: "sos-static-1.2.3+abc", offline: "sos-offline-1.2.3+abc" });
    for (const name of Object.values(sw.exported.cacheNames())) assert.ok(name.startsWith(CACHE_PREFIX));
    assert.equal(setup("0.0.0-dev").exported.cacheNames().static, "sos-static-0.0.0-dev");
  });

  it("fehlende oder unsaubere Version: feste Ersatzwerte, keine Sonderzeichen im Namen", () => {
    assert.equal(setup("").exported.versionOf(`${ORIGIN}/sw.js`), "dev");
    assert.equal(setup().exported.versionOf(`${ORIGIN}/sw.js?v=a/b c%0A"x`), "a_b_c__x");
    assert.equal(setup().exported.versionOf(`${ORIGIN}/sw.js?v=${"x".repeat(200)}`).length, 64);
  });

  it("nur vollständige, erfolgreiche Antworten derselben Herkunft sind speicherbar; Offline-Seite nur als HTML ohne Weiterleitung", () => {
    const { exported } = setup();
    assert.equal(exported.isCacheableStatic(basic(new Response("x"))), true);
    assert.equal(exported.isCacheableStatic(basic(new Response("x", { status: 404 }))), false);
    assert.equal(exported.isCacheableStatic(basic(new Response(null, { status: 206 }))), false, "Teilantwort");
    assert.equal(exported.isCacheableStatic(new Response("x")), false, "nicht „basic“ (fremd/undurchsichtig)");
    assert.equal(exported.isCacheableStatic(undefined), false);
    assert.equal(exported.isOfflinePage(html()), true);
    assert.equal(exported.isOfflinePage(html("x", { status: 503 })), false);
    assert.equal(exported.isOfflinePage(new Response("{}", { headers: { "content-type": "application/json" } })), false);
    const redirected = html();
    Object.defineProperty(redirected, "redirected", { value: true });
    assert.equal(exported.isOfflinePage(redirected), false, "eine Weiterleitung (z. B. auf die Anmeldung) ist nicht die Offline-Seite");
  });
});

describe("Service Worker: install, Offline-Seite", () => {
  it("lädt die Offline-Seite ohne Cookie und am HTTP-Zwischenspeicher vorbei und speichert sie unter dem Namen dieser Version", async () => {
    const sw = setup();
    sw.state.routes.set("/offline", () => basic(html()));
    await sw.dispatch("install");
    assert.equal(sw.calls.length, 1);
    assert.equal(sw.calls[0].input, "/offline");
    assert.deepEqual({ ...sw.calls[0].init }, { credentials: "omit", cache: "reload", redirect: "error" });
    assert.deepEqual([...sw.caches.store.keys()], ["sos-offline-1.2.3+abc"]);
    assert.equal(await (await sw.caches.store.get("sos-offline-1.2.3+abc")!.match("/offline"))!.text(), OFFLINE_HTML);
    assert.equal(sw.state.skipped, 0, "kein skipWaiting beim Installieren: die Seite entscheidet über den Wechsel");
  });

  it("ist die Offline-Seite schon da, lädt er sie nicht noch einmal", async () => {
    const sw = setup();
    sw.state.routes.set("/offline", () => basic(html()));
    await sw.dispatch("install");
    await sw.dispatch("install");
    assert.equal(sw.calls.length, 1);
  });

  it("scheitert das Laden (Netz weg, Server startet: 503, Weiterleitung, falscher Typ), schlägt die Installation nicht fehl und es wird nichts gespeichert", async () => {
    const sw = setup();
    sw.state.online = false;
    await sw.dispatch("install");
    sw.state.online = true;
    for (const bad of [() => basic(html("x", { status: 503 })), () => basic(new Response("{}", { headers: { "content-type": "application/json" } }))]) {
      sw.state.routes.set("/offline", bad);
      await sw.dispatch("install");
    }
    const cache = sw.caches.store.get("sos-offline-1.2.3+abc");
    assert.equal(cache?.entries.size ?? 0, 0);
  });
});

describe("Service Worker: fetch", () => {
  let sw: Setup;
  beforeEach(async () => {
    sw = setup();
    sw.state.routes.set("/offline", () => basic(html()));
    await sw.dispatch("install");
    sw.calls.length = 0;
  });

  it("Seitenaufruf mit Netz: die Antwort des Servers, nichts wird gespeichert", async () => {
    sw.state.routes.set("/customers", () => basic(html("<h1>Kunden</h1>")));
    const { response } = await sw.dispatch("fetch", { request: sw.navigate("/customers") });
    assert.equal(await response!.text(), "<h1>Kunden</h1>");
    assert.deepEqual([...sw.caches.store.keys()], ["sos-offline-1.2.3+abc"]);
    assert.deepEqual([...sw.caches.store.get("sos-offline-1.2.3+abc")!.entries.keys()], [`${ORIGIN}/offline`], "es gibt genau eine gespeicherte Seite: die Offline-Seite");
  });

  it("Seitenaufruf ohne Netz: die gespeicherte Offline-Seite", async () => {
    sw.state.online = false;
    const { response } = await sw.dispatch("fetch", { request: sw.navigate("/customers/abc") });
    assert.equal(response!.status, 200);
    assert.equal(await response!.text(), OFFLINE_HTML);
  });

  it("Seitenaufruf ohne Netz und ohne gespeicherte Offline-Seite: kurze Textantwort 503 statt eines Fehlers", async () => {
    const bare = setup();
    bare.state.online = false;
    const { response } = await bare.dispatch("fetch", { request: bare.navigate("/") });
    assert.equal(response!.status, 503);
    assert.equal(response!.headers.get("cache-control"), "no-store");
  });

  it("ein Serverfehler (500, 403, Weiterleitung) bleibt ein Serverfehler – die Offline-Seite gibt es nur bei einem Netzfehler", async () => {
    sw.state.routes.set("/boom", () => basic(new Response("kaputt", { status: 500 })));
    const { response } = await sw.dispatch("fetch", { request: sw.navigate("/boom") });
    assert.equal(response!.status, 500);
  });

  it("PDF-Vorschau (iframe) und Download laufen unberührt: der Service Worker antwortet nicht und fragt nicht selbst nach", async () => {
    for (const request of [
      sw.request("/api/invoices/abc/file", { mode: "navigate", destination: "iframe" }),
      sw.navigate("/api/invoices/abc/file?download=1"),
      sw.request("/api/invoices/abc/file", { headers: new Headers({ range: "bytes=0-1023" }) }),
      sw.navigate("/api/ical/t.ics"),
      sw.request("/api/docs/images/abc", { destination: "image" }),
      sw.request("/customers", { method: "POST", headers: new Headers({ "next-action": "abc" }) }),
      sw.navigate("/vehicles/print", { headers: new Headers({ range: "bytes=0-9" }) }),
    ]) {
      const { responded } = await sw.dispatch("fetch", { request });
      assert.equal(responded, undefined, `${request.method} ${request.url}`);
    }
    assert.equal(sw.calls.length, 0);
    sw.state.online = false;
    assert.equal((await sw.dispatch("fetch", { request: sw.navigate("/api/invoices/abc/file") })).responded, undefined, "auch ohne Netz: kein Ersatz für Downloads");
  });

  it("gehashte Datei: erster Abruf übers Netz und gespeichert, jeder weitere aus dem Zwischenspeicher", async () => {
    sw.state.routes.set("/_next/static/chunks/a1b2.js", () => basic(new Response("console.log(1)", { headers: { "content-type": "text/javascript" } })));
    const first = await sw.dispatch("fetch", { request: sw.request("/_next/static/chunks/a1b2.js", { destination: "script" }) });
    assert.equal(await first.response!.text(), "console.log(1)");
    assert.equal(sw.calls.length, 1);
    assert.ok(sw.caches.store.get("sos-static-1.2.3+abc")!.entries.has(`${ORIGIN}/_next/static/chunks/a1b2.js`));
    sw.state.online = false;
    const second = await sw.dispatch("fetch", { request: sw.request("/_next/static/chunks/a1b2.js", { destination: "script" }) });
    assert.equal(await second.response!.text(), "console.log(1)");
    assert.equal(sw.calls.length, 1, "kein zweiter Abruf");
  });

  it("Fehlantworten und Teilantworten werden nicht gespeichert", async () => {
    sw.state.routes.set("/_next/static/chunks/missing.js", () => basic(new Response("nein", { status: 404 })));
    sw.state.routes.set("/_next/static/chunks/part.js", () => basic(new Response("teil", { status: 206 })));
    for (const name of ["missing", "part"]) {
      const { response } = await sw.dispatch("fetch", { request: sw.request(`/_next/static/chunks/${name}.js`) });
      assert.ok(response);
    }
    assert.equal(sw.caches.store.get("sos-static-1.2.3+abc")?.entries.size ?? 0, 0);
  });

  it("der Zwischenspeicher der Programmdateien ist begrenzt", async () => {
    const limit = sw.exported.MAX_STATIC_ENTRIES;
    sw.state.routes.set("/_next/static/chunks/n.js", () => basic(new Response("x")));
    const cache = await sw.caches.open("sos-static-1.2.3+abc");
    for (let i = 0; i < limit + 5; i++) await cache.put(`/_next/static/chunks/old${i}.js`, new Response("x"));
    await sw.dispatch("fetch", { request: sw.request("/_next/static/chunks/n.js") });
    assert.equal(cache.entries.size, limit);
    assert.ok(cache.entries.has(`${ORIGIN}/_next/static/chunks/n.js`), "der neueste Eintrag bleibt");
  });
});

describe("Service Worker: activate", () => {
  it("löscht die Zwischenspeicher älterer Versionen, behält die der eigenen und fasst fremde nicht an; übernimmt die offenen Seiten", async () => {
    const sw = setup("2.0.0");
    for (const name of ["sos-static-1.9.0", "sos-offline-1.9.0", "sos-static-2.0.0", "sos-offline-2.0.0", "fremd-cache"]) await sw.caches.open(name);
    await sw.dispatch("activate");
    assert.deepEqual([...sw.caches.store.keys()].sort(), ["fremd-cache", "sos-offline-2.0.0", "sos-static-2.0.0"]);
    assert.equal(sw.state.claimed, 1);
  });
});

describe("Service Worker: Nachrichten der Seite", () => {
  let sw: Setup;
  beforeEach(async () => {
    sw = setup();
    sw.state.routes.set("/offline", () => basic(html()));
    sw.state.routes.set("/_next/static/chunks/a.js", () => basic(new Response("x")));
    await sw.dispatch("install");
    await sw.dispatch("fetch", { request: sw.request("/_next/static/chunks/a.js") });
  });

  it("SKIP_WAITING aktiviert den wartenden Service Worker", async () => {
    await sw.dispatch("message", { data: { type: "SKIP_WAITING" } });
    assert.equal(sw.state.skipped, 1);
  });

  it("CLEAR (Abmelden): alle Zwischenspeicher dieser App sind leer – auch die anderer Versionen; fremde bleiben", async () => {
    await sw.caches.open("sos-static-0.9.0");
    await sw.caches.open("fremd-cache");
    await sw.dispatch("message", { data: { type: "CLEAR" } });
    assert.deepEqual([...sw.caches.store.keys()], ["fremd-cache"]);
  });

  it("nach CLEAR stellt WARM die Offline-Seite wieder her (beim nächsten Seitenaufruf, z. B. der Anmeldeseite); Programmdateien kommen von selbst wieder", async () => {
    await sw.dispatch("message", { data: { type: "CLEAR" } });
    sw.calls.length = 0;
    await sw.dispatch("message", { data: { type: "WARM" } });
    assert.equal(sw.calls.length, 1);
    assert.equal(sw.calls[0].input, "/offline");
    assert.deepEqual([...sw.caches.store.get("sos-offline-1.2.3+abc")!.entries.keys()], [`${ORIGIN}/offline`]);
  });

  it("unbekannte, fehlerhafte und fremdartige Nachrichten tun nichts", async () => {
    const before = [...sw.caches.store.keys()];
    for (const data of [undefined, null, "CLEAR", 42, {}, { type: 1 }, { type: "FORMAT_C" }]) await sw.dispatch("message", { data });
    assert.deepEqual([...sw.caches.store.keys()], before);
    assert.equal(sw.state.skipped, 0);
  });
});

describe("Service Worker: Datei", () => {
  it("braucht keine Build-Stufe und keine Importe (klassische Skriptdatei, `use strict`, keine Cookies, kein Zugriff auf Sitzungsdaten)", () => {
    assert.match(SOURCE, /^\/\*[\s\S]*?\*\/\s*"use strict";/);
    assert.doesNotMatch(SOURCE, /^\s*(import|export)\s/m);
    assert.doesNotMatch(SOURCE, /document\.cookie|cookies|localStorage|indexedDB/);
    // jede Abfrage der Offline-Seite läuft ohne Zugangsdaten
    assert.match(SOURCE, /credentials: "omit"/);
  });

  it("das Präfix der Zwischenspeicher stimmt mit dem der Seite überein (Abmelden löscht dort per Namen)", () => {
    assert.match(SOURCE, new RegExp(`var PREFIX = "${CACHE_PREFIX}";`));
  });
});
