import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";
import { setCspModeInProcess } from "./lib/csp-mode";
import { startupState } from "./server/startup-state";

// Frisch gestartet ist der Zustand „starting“ (der Proxy sperrt dann alles) – die Tests unten prüfen den Normalbetrieb, die Sperre hat einen eigenen Abschnitt
before(() => {
  startupState().status = "ready";
});

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
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/icon.png", "/apple-icon.png", "/icons/192.png", "/api/health", "/api/backups/upload"]) {
      assert.equal(matched(path), false, `${path} darf nicht durch den Proxy laufen`);
    }
  });

  it("/api/backups/upload läuft nicht durch den Proxy (Next puffert und kappt dort den Body bei 10 MiB), ähnliche Pfade schon", () => {
    assert.equal(matched("/api/backups/upload"), false);
    for (const path of ["/api/backups/upload/x", "/api/backups/uploads", "/api/setup/restore/x", "/api/setup", "/api/backups/status", "/api/backups/schrauberos-1", "/api/docs/images"]) {
      assert.equal(matched(path), true, `${path} muss durch den Proxy laufen`);
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

describe("Proxy: Start läuft noch (Migrationen)", () => {
  const withStarting = async (fn: () => void | Promise<void>) => {
    const state = startupState();
    const before = state.status;
    state.status = "starting";
    try {
      await fn();
    } finally {
      state.status = before;
    }
  };

  it("beantwortet jeden Pfad mit 503 – keine Anfrage erreicht die noch nicht migrierte Datenbank", async () => {
    await withStarting(async () => {
      for (const path of ["/", "/login", "/setup", "/customers/abc", "/api/customers/search", "/api/v1/customers", "/api/ical/x.ics", "/api/backups/download"]) {
        for (const cookie of [undefined, "so_session=abc"]) {
          const res = proxy(request(path, cookie));
          assert.equal(res.status, 503, `${path}: ${res.status}`);
          assert.equal(res.headers.get("x-middleware-next"), null);
          assert.equal(res.headers.get("cache-control"), "no-store");
        }
      }
      const action = proxy(new NextRequest("http://localhost:3000/customers", { method: "POST", headers: { "next-action": "abc", cookie: "so_session=abc" } }));
      assert.equal(action.status, 503);
      assert.deepEqual(await action.json(), { status: "starting" });
    });
  });

  it("Browser bekommen eine kurze Seite, die sich selbst neu lädt; der Health-Check liegt außerhalb des Proxys", async () => {
    await withStarting(async () => {
      const page = proxy(request("/", undefined, { accept: "text/html" }));
      assert.equal(page.status, 503);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      assert.ok(page.headers.get("retry-after"));
      const html = await page.text();
      assert.match(html, /http-equiv="refresh"/);
      assert.match(html, /startet/);
      assert.equal(matched("/api/health"), false);
    });
  });

  it("die Gesamtprüfung: nach dem Start (ready) läuft wieder alles durch", async () => {
    assert.ok(passes(proxy(request("/appointments", "so_session=abc"))));
  });
});

describe("Proxy: Content-Security-Policy und Sicherheits-Köpfe", () => {
  const csp = (res: Response) => res.headers.get("content-security-policy");
  const nonceOf = (value: string | null) => /'nonce-([^']+)'/.exec(value ?? "")?.[1];
  /** Was Next als Kopf der Anfrage an die Seite weitergibt (`NextResponse.next({ request })` kodiert es als `x-middleware-request-*`). */
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it("Seiten: erzwungene Richtlinie mit frischem Nonce je Anfrage; derselbe Wert geht als Kopf der Anfrage an Next (daraus liest Next den Nonce)", () => {
    const first = proxy(request("/appointments", "so_session=abc"));
    const second = proxy(request("/appointments", "so_session=abc"));
    const nonce = nonceOf(csp(first));
    assert.ok(nonce, "Nonce in der Richtlinie");
    assert.notEqual(nonce, nonceOf(csp(second)), "bei jeder Anfrage ein neuer Nonce");
    assert.equal(forwarded(first, "x-nonce"), nonce);
    assert.equal(forwarded(first, "content-security-policy"), csp(first));
    assert.match(csp(first)!, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    assert.equal(first.headers.get("content-security-policy-report-only"), null);
  });

  it("ein von außen mitgeschickter CSP-/Nonce-Kopf der Anfrage wird überschrieben, nicht übernommen", () => {
    const res = proxy(request("/appointments", "so_session=abc", { "content-security-policy": "script-src 'nonce-fremd'", "content-security-policy-report-only": "script-src 'nonce-fremd2'", "x-nonce": "fremd" }));
    assert.notEqual(forwarded(res, "x-nonce"), "fremd");
    assert.doesNotMatch(forwarded(res, "content-security-policy") ?? "", /fremd/);
    assert.equal(forwarded(res, "content-security-policy-report-only"), null);
    assert.equal((res.headers.get("x-middleware-override-headers") ?? "").split(",").includes("content-security-policy-report-only"), false);
  });

  it("Notschalter „nur melden“: derselbe Inhalt unter dem Namen Report-Only (Antwort und Anfrage), nichts wird erzwungen", () => {
    setCspModeInProcess("report-only");
    try {
      const res = proxy(request("/appointments", "so_session=abc"));
      assert.equal(csp(res), null);
      const value = res.headers.get("content-security-policy-report-only");
      assert.match(value ?? "", /script-src 'self' 'nonce-/);
      assert.equal(forwarded(res, "content-security-policy-report-only"), value);
      assert.equal(forwarded(res, "content-security-policy"), null);
      assert.equal(nonceOf(value), forwarded(res, "x-nonce"));
    } finally {
      setCspModeInProcess("enforce");
    }
    assert.ok(csp(proxy(request("/appointments", "so_session=abc"))), "danach wieder erzwungen");
  });

  it("Programmierschnittstelle (/api/v1): default-src 'none'; Dateirouten: der Proxy setzt nichts (die Route hat ihre eigene Richtlinie)", () => {
    assert.equal(csp(proxy(request("/api/v1/customers"))), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(csp(proxy(request("/api/v1"))), "default-src 'none'; frame-ancestors 'none'");
    for (const path of ["/api/invoices/abc/file", "/api/docs/images/abc"]) {
      const res = proxy(request(path, "so_session=abc"));
      assert.ok(passes(res), path);
      assert.equal(csp(res), null, path);
      assert.equal(res.headers.get("content-security-policy-report-only"), null, path);
    }
  });

  it("auch Weiterleitung, 401 und die 503-Seiten tragen die Richtlinie; die 503-Seite kennzeichnet ihr Stilelement mit dem Nonce", async () => {
    assert.ok(csp(proxy(request("/appointments"))), "Weiterleitung auf /login");
    assert.ok(csp(proxy(request("/api/customers/search"))), "401");
    const state = startupState();
    for (const status of ["starting", "reinstall"] as const) {
      state.status = status;
      try {
        const res = proxy(request("/", undefined, { accept: "text/html" }));
        const nonce = nonceOf(csp(res));
        assert.ok(nonce, status);
        assert.ok((await res.text()).includes(`<style nonce="${nonce}">`), status);
      } finally {
        state.status = "ready";
      }
    }
  });

  it("HSTS nur bei erkanntem HTTPS", () => {
    const hsts = (res: Response) => res.headers.get("strict-transport-security");
    assert.equal(hsts(proxy(request("/appointments", "so_session=abc"))), null);
    assert.equal(hsts(proxy(request("/login", undefined, { "x-forwarded-proto": "http" }))), null);
    assert.match(hsts(proxy(request("/appointments", "__Host-so_session=abc", HTTPS))) ?? "", /^max-age=\d+$/);
    assert.match(hsts(proxy(request("/api/v1/customers", undefined, HTTPS))) ?? "", /^max-age=\d+$/);
    assert.ok(hsts(proxy(request("/appointments", undefined, HTTPS))), "auch die Weiterleitung");
  });
});
