import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

/** Der Proxy ist nur die schnelle Vorprüfung (Cookie vorhanden?) – die echte Prüfung macht jede Seite selbst. */
const request = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);
const location = (res: Response) => res.headers.get("location");
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

/** Der statische Matcher als Regex – so wie Next ihn auswertet (ein Pfad-Ausdruck mit negativem Lookahead). */
const matcher = new RegExp(`^${config.matcher[0]}$`);
const matched = (path: string) => matcher.test(path);

describe("Proxy: Anmeldeseite und Weiterleitungen", () => {
  it("leitet /login nie auf / um – auch nicht mit totem Cookie (Redirect-Schleife)", () => {
    for (const cookie of ["so_session=abgelaufen", "__Host-so_session=abgelaufen"]) {
      const res = proxy(request("/login", cookie));
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

  it("kennt beide Cookie-Namen (Klartext im HTTP-LAN, __Host- bei HTTPS)", () => {
    assert.ok(passes(proxy(request("/appointments", "so_session=abc"))));
    assert.ok(passes(proxy(request("/appointments", "__Host-so_session=abc"))));
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
  it("nimmt Statik, Manifest, Service Worker, Icons, Health, /api/v1 und den iCal-Feed aus", () => {
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/icon.png", "/apple-icon.png", "/icons/192.png", "/api/health", "/api/v1/customers", "/api/ical/abc123.ics"]) {
      assert.equal(matched(path), false, `${path} darf nicht durch den Proxy laufen`);
    }
  });

  it("schützt alles andere, auch ähnlich klingende Pfade", () => {
    for (const path of ["/", "/login", "/appointments", "/api/customers/search", "/api/v10/x", "/api/healthz", "/admin/users", "/settings", "/icons-secret", "/swx.js"]) {
      assert.equal(matched(path), true, `${path} muss durch den Proxy laufen`);
    }
  });
});
