/*
 * SchrauberOS – Service Worker (P3-5). Bewusst klein; Beschreibung und Regeln: README „Installierbare App (PWA)“.
 *
 * Er tut genau zwei Dinge:
 *   1. Die Offline-Seite (`/offline`): Scheitert das Laden einer **Seite** (nur `mode === "navigate"` mit `destination === "document"`) am Netz, antwortet er mit der Offline-Seite.
 *      Das ist die ausdrückliche Ausnahme von „keine Seiten zwischenspeichern“: gespeichert wird *nur* diese eine öffentliche, statische Seite (ohne Cookie geladen) – nie eine
 *      Antwort der Anwendung. Seiten selbst laufen immer übers Netz.
 *   2. Gehashte Dateien unter `/_next/static/` werden beim ersten Abruf gespeichert und danach von dort geliefert (ihr Name enthält den Inhalts-Hash, sie ändern sich nie).
 * Alles andere läuft unberührt am Service Worker vorbei: `/api/*` (PDF-Vorschau, Downloads, iCal, Dateien, Suche), Anfragen mit `Range`, alles außer `GET`, fremde Herkünfte,
 * eingebettete Rahmen (`destination` `iframe`), Formular-Absenden und Server Actions (`POST`).
 *
 * Die Zwischenspeicher heißen `sos-…-<Version>`; die Version steckt in der Adresse (`/sw.js?v=…`, vom Server aus `version.json`). Ein Web-Update ändert die Adresse, der Browser
 * installiert einen neuen Service Worker (er wartet, bis die Seite „Neu laden“ meldet: Nachricht `SKIP_WAITING`), `activate` löscht die alten Zwischenspeicher.
 * Nachrichten der Seite: `WARM` (Offline-Seite sicherstellen), `CLEAR` (alle Zwischenspeicher leeren – beim Abmelden), `SKIP_WAITING`.
 *
 * Die Entscheidungen (`classify`, `isCacheableStatic`, `cacheNames`) sind reine Funktionen; `src/lib/sw.test.ts` lädt genau diese Datei in einen nachgebauten
 * `ServiceWorkerGlobalScope` und prüft sie samt Ereignissen. Keine Build-Stufe: Die Datei wird so ausgeliefert, wie sie hier steht.
 */
"use strict";

(function (scope) {
  var PREFIX = "sos-";
  var OFFLINE_PATH = "/offline";
  var STATIC_PREFIX = "/_next/static/";
  var MAX_STATIC_ENTRIES = 300;

  /** Kennung aus `?v=` der Adresse dieses Service Workers; nur unbedenkliche Zeichen (sie landet im Namen der Zwischenspeicher). */
  function versionOf(href) {
    var value = new URL(href).searchParams.get("v") || "dev";
    return value.replace(/[^0-9A-Za-z._+-]/g, "_").slice(0, 64);
  }

  var VERSION = versionOf(scope.location.href);
  var STATIC_CACHE = PREFIX + "static-" + VERSION;
  var OFFLINE_CACHE = PREFIX + "offline-" + VERSION;

  function cacheNames() {
    return { static: STATIC_CACHE, offline: OFFLINE_CACHE };
  }

  /**
   * Was geschieht mit dieser Anfrage?
   *   "navigation": Seitenaufruf – übers Netz, bei Netzfehler die Offline-Seite.
   *   "static":     gehashte Datei von `/_next/static/` – Zwischenspeicher zuerst.
   *   "pass":       nichts davon – der Browser behandelt sie, als gäbe es keinen Service Worker.
   * `request` braucht nur `url`, `method`, `mode`, `destination` und `headers.get` (im Test ein einfaches Objekt: Node kann keine Anfrage mit `mode: "navigate"` bauen).
   */
  function classify(request, origin) {
    if (request.method !== "GET") return "pass";
    var url;
    try {
      url = new URL(request.url);
    } catch {
      return "pass";
    }
    if (url.origin !== origin) return "pass";
    // Teilanfragen (PDF-Betrachter, Medien) laufen nie durch uns: ein Zwischenspeicher dürfte nur ganze Antworten liefern
    if (request.headers && request.headers.get("range")) return "pass";
    // Programmierschnittstelle, Dateien, PDF, iCal, Suche, Health: alles unter /api
    if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return "pass";
    if (url.pathname.indexOf(STATIC_PREFIX) === 0) return "static";
    if (request.mode === "navigate" && request.destination === "document") return "navigation";
    return "pass";
  }

  /** Nur vollständige, erfolgreiche Antworten derselben Herkunft kommen in den Zwischenspeicher. */
  function isCacheableStatic(response) {
    return Boolean(response) && response.status === 200 && response.type === "basic";
  }

  function isOfflinePage(response) {
    var type = (response && response.headers && response.headers.get("content-type")) || "";
    return Boolean(response) && response.status === 200 && !response.redirected && /^text\/html/i.test(type);
  }

  /** Offline-Seite sicherstellen: ohne Cookie und am HTTP-Zwischenspeicher vorbei laden; schlägt es fehl (Server startet gerade), bleibt es beim nächsten Versuch (`WARM`). */
  function warm() {
    return scope.caches.open(OFFLINE_CACHE).then(function (cache) {
      return cache.match(OFFLINE_PATH).then(function (hit) {
        if (hit) return;
        return scope
          .fetch(OFFLINE_PATH, { credentials: "omit", cache: "reload", redirect: "error" })
          .then(function (response) {
            if (isOfflinePage(response)) return cache.put(OFFLINE_PATH, response);
          })
          .catch(function () {});
      });
    });
  }

  function offlineResponse() {
    return scope.caches.open(OFFLINE_CACHE).then(function (cache) {
      return cache.match(OFFLINE_PATH).then(function (hit) {
        return (
          hit ||
          new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
        );
      });
    });
  }

  function trim(cache) {
    return cache.keys().then(function (keys) {
      var excess = keys.length - MAX_STATIC_ENTRIES;
      return Promise.all(keys.slice(0, Math.max(0, excess)).map(function (key) { return cache.delete(key); }));
    });
  }

  function fromCacheOrNetwork(request, event) {
    return scope.caches.open(STATIC_CACHE).then(function (cache) {
      return cache.match(request).then(function (hit) {
        if (hit) return hit;
        return scope.fetch(request).then(function (response) {
          if (isCacheableStatic(response)) {
            event.waitUntil(cache.put(request, response.clone()).then(function () { return trim(cache); }).catch(function () {}));
          }
          return response;
        });
      });
    });
  }

  /** Alle Zwischenspeicher dieser App löschen (jeder Version). */
  function clearAll() {
    return scope.caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) { return name.indexOf(PREFIX) === 0; }).map(function (name) { return scope.caches.delete(name); }));
    });
  }

  scope.addEventListener("install", function (event) {
    // Kein `skipWaiting`: Ein neuer Service Worker wartet, bis die Seite „Neu laden“ meldet – sonst wechselte er mitten in einer Eingabe die Dateien unter der Seite
    event.waitUntil(warm());
  });

  scope.addEventListener("activate", function (event) {
    event.waitUntil(
      scope.caches
        .keys()
        .then(function (names) {
          var keep = [STATIC_CACHE, OFFLINE_CACHE];
          return Promise.all(names.filter(function (name) { return name.indexOf(PREFIX) === 0 && keep.indexOf(name) < 0; }).map(function (name) { return scope.caches.delete(name); }));
        })
        .then(function () {
          return scope.clients.claim();
        }),
    );
  });

  scope.addEventListener("fetch", function (event) {
    var kind = classify(event.request, scope.location.origin);
    if (kind === "navigation") {
      event.respondWith(
        scope.fetch(event.request).catch(function () {
          return offlineResponse();
        }),
      );
    } else if (kind === "static") {
      event.respondWith(fromCacheOrNetwork(event.request, event));
    }
  });

  scope.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "SKIP_WAITING") scope.skipWaiting();
    else if (data.type === "WARM") event.waitUntil(warm());
    else if (data.type === "CLEAR") event.waitUntil(clearAll());
  });

  // Für den Test (`src/lib/sw.test.ts`): im echten Service Worker gibt es kein `module`
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { classify: classify, isCacheableStatic: isCacheableStatic, isOfflinePage: isOfflinePage, versionOf: versionOf, cacheNames: cacheNames, OFFLINE_PATH: OFFLINE_PATH, MAX_STATIC_ENTRIES: MAX_STATIC_ENTRIES };
  }
})(self);
