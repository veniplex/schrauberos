import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";
import { startupState } from "./server/startup-state";

/** Der Proxy ist nur die schnelle Vorprüfung (Cookie vorhanden?) – die echte Prüfung macht jede Seite selbst. */
const request = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, cookie || Object.keys(headers).length ? { headers: { ...(cookie ? { cookie } : {}), ...headers } } : undefined);
const HTTPS = { "x-forwarded-proto": "https" };
const location = (res: Response) => res.headers.get("location");
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

/** Der statische Matcher als Regex – so wie Next ihn auswertet (ein Pfad-Ausdruck mit negativem Lookahead). */
const matcher = new RegExp(`^${config.matcher[0]}$`);
const matched = (path: string) => matcher.test(path);

describe("Proxy: Anmeldeseite und Weiterleitungen", () => {
  it("leitet /login nie auf / um – auch nicht mit totem Cookie (Redirect-Schleife)", () => {
    for (const [cookie, headers] of [["so_session=abgelaufen", {}], ["__Host-so_session=abgelaufen", HTTPS]] as const) {
      const res = proxy(request("/login", cookie, headers));
      assert.ok(passes(res), `/login mit ${cookie} muss durchgelassen werden, war: ${location(res)}`);
    }
  });

  it("ohne Cookie: Seiten leiten auf /login (mit next), die Startseite ohne next", () => {
    assert.equal(new URL(location(proxy(request("/")))!).pathname + new URL(location(proxy(request("/")))!).search, "/login");
    const res = proxy(request("/appointments?view=day"));
    const to = new URL(location(res)!);
    assert.equal(to.pathname, "/login");
    assert.equal(to.searchParams.get("next"), "/appointments?view=day");
  });

  it("kennt den Cookie-Namen des Übertragungswegs: Klartext im HTTP-LAN, __Host- bei HTTPS – und nur den", () => {
    assert.ok(passes(proxy(request("/appointments", "so_session=abc"))));
    assert.ok(passes(proxy(request("/appointments", "__Host-so_session=abc", HTTPS))));
    // Cookie Tossing: unter HTTPS zählt ein untergeschobenes Klartext-Cookie nicht (und umgekehrt)
    assert.ok(!passes(proxy(request("/appointments", "so_session=abc", HTTPS))));
    assert.ok(!passes(proxy(request("/appointments", "__Host-so_session=abc"))));
  });

  it("API-Pfade ohne Cookie antworten mit 401 statt Weiterleitung", async () => {
    const res = proxy(request("/api/customers/search?q=a"));
    assert.equal(res.status, 401);
    assert.equal(location(res), null);
  });

  it("/setup bleibt ohne Cookie erreichbar", () => {
    assert.ok(passes(proxy(request("/setup"))));
  });
});

describe("Proxy: Matcher", () => {
  it("nimmt Statik, Manifest, Service Worker, Icons und Health aus", () => {
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/icon.png", "/apple-icon.png", "/icons/192.png", "/api/health"]) {
      assert.equal(matched(path), false, `${path} darf nicht durch den Proxy laufen`);
    }
  });

  it("schützt alles andere, auch ähnlich klingende Pfade", () => {
    for (const path of ["/", "/login", "/appointments", "/api/customers/search", "/api/v1/customers", "/api/ical/abc123.ics", "/api/v10/x", "/api/healthz", "/admin/users", "/settings", "/icons-secret", "/swx.js"]) {
      assert.equal(matched(path), true, `${path} muss durch den Proxy laufen`);
    }
  });
});

describe("Notzugang", () => {
  it("/login/recover ist ohne Sitzung erreichbar (öffentlich wie /login)", () => {
    assert.ok(passes(proxy(request("/login/recover"))));
  });
});

describe("Proxy: Programmierschnittstelle und iCal-Feed", () => {
  it("brauchen kein Sitzungs-Cookie (eigene Anmeldung), laufen aber durch den Proxy", () => {
    for (const path of ["/api/v1/customers", "/api/v1", "/api/ical/abc123.ics"]) assert.ok(passes(proxy(request(path))), path);
    // ähnlich klingende Pfade gehören nicht dazu
    assert.equal(proxy(request("/api/v10/x")).status, 401);
    assert.equal(proxy(request("/api/icalendar")).status, 401);
  });
});

describe("Proxy: Neuinstallation nötig (fremde Datenbank)", () => {
  const withState = async (status: "reinstall" | "ready", fn: () => void | Promise<void>) => {
    const state = startupState();
    const before = state.status;
    state.status = status;
    try {
      await fn();
    } finally {
      state.status = before;
    }
  };

  it("beantwortet jeden Pfad mit 503 – Seiten, Server Actions, Route Handler, Programmierschnittstelle, auch mit Sitzungs-Cookie", async () => {
    await withState("reinstall", async () => {
      for (const path of ["/", "/login", "/setup", "/customers/abc", "/api/customers/search", "/api/v1/customers", "/api/ical/x.ics", "/api/backups/download"]) {
        for (const cookie of [undefined, "so_session=abc"]) {
          const res = proxy(request(path, cookie));
          assert.equal(res.status, 503, `${path}: ${res.status}`);
          assert.equal(res.headers.get("x-middleware-next"), null);
        }
      }
      // Server Action (POST mit Next-Action-Kopf)
      const action = proxy(new NextRequest("http://localhost:3000/customers", { method: "POST", headers: { "next-action": "abc", cookie: "so_session=abc" } }));
      assert.equal(action.status, 503);
      assert.deepEqual(await action.json(), { status: "reinstall" });
    });
  });

  it("Browser bekommen eine kurze zweisprachige Seite, Programme JSON; /api/health liegt außerhalb des Proxys", async () => {
    await withState("reinstall", async () => {
      const page = proxy(request("/", undefined, { accept: "text/html,application/xhtml+xml" }));
      assert.equal(page.status, 503);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const html = await page.text();
      assert.match(html, /Neuinstallation nötig/);
      assert.match(html, /Reinstallation required/);
      assert.equal(matched("/api/health"), false);
    });
  });

  it("im Normalbetrieb bleibt alles wie zuvor", async () => {
    await withState("ready", () => {
      assert.ok(passes(proxy(request("/appointments", "so_session=abc"))));
    });
  });
});
