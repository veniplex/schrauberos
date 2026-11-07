import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { Readable } from "node:stream";
import { getCloneableBody } from "next/dist/server/body-streams";
import nextConfig, { CSP_FALLBACK_HEADERS, PROXY_BODY_LIMIT, SECURITY_HEADERS, SERVER_ACTION_BODY_LIMIT, SERVICE_WORKER_HEADERS } from "../next.config";

/**
 * Die Basis-Header aus `next.config.ts`. Geprüft wird nicht nur der Inhalt der Konfiguration, sondern mit dem Mustervergleich, den auch
 * Next selbst benutzt (path-to-regexp), dass die Regel für **jeden** Pfad gilt – Seiten, API, Statik, Service Worker, Dateien.
 *
 * Nicht geprüft wird hier die tatsächliche HTTP-Antwort eines laufenden Servers: Das bräuchte `next build` + `next start` (Minuten, eine
 * Datenbank) und gehört in die Browser-CI (Paket P1a-6b), die die Header jeder Route der Inventur an der echten Antwort prüft.
 */
const PATHS = ["/", "/login", "/login/recover", "/setup", "/appointments", "/appointments/abc123/edit", "/admin/users", "/api/health", "/api/v1/customers", "/api/ical/abc.ics", "/api/files/invoice/xyz", "/_next/static/chunks/a.js", "/_next/image", "/sw.js", "/manifest.webmanifest", "/favicon.ico", "/icons/192.png"];

describe("next.config: Basis-Header", () => {
  const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

  it("setzt nosniff, Referrer-Policy, X-Frame-Options SAMEORIGIN und eine Permissions-Policy mit Kamera für die eigene Herkunft", () => {
    assert.equal(header("X-Content-Type-Options"), "nosniff");
    assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(header("X-Frame-Options"), "SAMEORIGIN");
    assert.match(header("Permissions-Policy") ?? "", /camera=\(self\)/);
    assert.doesNotMatch(header("Permissions-Policy") ?? "", /camera=\(\)/);
  });

  it("die Content-Security-Policy steckt nicht in den Basis-Headern (sie kommt vom Proxy mit Nonce), und es gibt nie Report-Only", () => {
    assert.equal(SECURITY_HEADERS.some((h) => h.key.toLowerCase().includes("content-security-policy")), false);
    assert.equal(CSP_FALLBACK_HEADERS.some((h) => h.key.toLowerCase().includes("report-only")), false, "die Richtlinie wird erzwungen, nicht nur gemeldet");
  });

  it("die Basis-Header gelten für alle Pfade (Seiten, API, Statik, Dateien)", async () => {
    const rules = await nextConfig.headers!();
    for (const path of PATHS) {
      const base = rules.filter((rule) => pathToRegexp(rule.source).test(path) && rule.headers.some((h) => h.key === "X-Content-Type-Options"));
      assert.equal(base.length, 1, `${path}: genau eine Basis-Regel erwartet, waren ${base.length}`);
      for (const expected of SECURITY_HEADERS) assert.equal(base[0].headers.find((h) => h.key === expected.key)?.value, expected.value, `${path}: ${expected.key}`);
      assert.ok(!base[0].has && !base[0].missing, `${path}: die Regel hat keine Bedingung`);
    }
  });

  it("die Rückfall-CSP gilt genau für die Pfade außerhalb des Proxys – und für keinen Pfad, den der Proxy bedient", async () => {
    const rules = await nextConfig.headers!();
    const withCsp = (path: string) => rules.filter((rule) => pathToRegexp(rule.source).test(path) && rule.headers.some((h) => h.key === "Content-Security-Policy"));
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/sw.js", "/manifest.webmanifest", "/favicon.ico", "/icons/192.png", "/icon.png", "/apple-icon.png", "/api/health", "/api/backups/upload", "/api/setup/restore"]) {
      assert.equal(withCsp(path).length, 1, `${path}: genau eine Rückfall-Regel erwartet`);
    }
    for (const path of ["/", "/login", "/appointments", "/api/v1/customers", "/api/ical/abc.ics", "/api/invoices/xyz/file", "/api/docs/images/abc", "/api/backups/status", "/api/healthz", "/icons-secret"]) {
      assert.equal(withCsp(path).length, 0, `${path}: der Proxy (oder die Route) setzt die CSP, nicht die Konfiguration`);
    }
  });

  it("der Service Worker kommt nie aus einem Zwischenspeicher (no-cache) und als JavaScript; andere Pfade bekommen das nicht (P3-5)", async () => {
    const rules = await nextConfig.headers!();
    const forPath = (path: string) => rules.filter((rule) => pathToRegexp(rule.source).test(path) && rule.headers.some((h) => h.key === "Cache-Control"));
    assert.equal(forPath("/sw.js").length, 1);
    assert.deepEqual(forPath("/sw.js")[0].headers, SERVICE_WORKER_HEADERS);
    assert.equal(SERVICE_WORKER_HEADERS.find((h) => h.key === "Cache-Control")?.value, "no-cache");
    for (const path of ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/sw.json", "/_next/static/chunks/a.js"]) assert.equal(forPath(path).length, 0, path);
    // die CSP des Service Workers bleibt die Rückfall-Richtlinie ohne Nonce (er liegt außerhalb des Proxys)
    assert.ok(rules.some((rule) => pathToRegexp(rule.source).test("/sw.js") && rule.headers.some((h) => h.key === "Content-Security-Policy")));
  });

  it("verbietet das Einbetten von außen und die Typerkennung, ohne die PDF-Vorschau derselben Herkunft zu sperren", () => {
    const csp = CSP_FALLBACK_HEADERS[0].value;
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /frame-ancestors 'none'/);
  });
});

describe("next.config: Größe der Anfrage-Bodies (ZP2-A-F1)", () => {
  const limit = (value: string | number | undefined) => (typeof value === "string" ? Number(/^(\d+)mb$/i.exec(value)?.[1] ?? NaN) * 1024 * 1024 : (value ?? 0));
  const configured = () => limit(nextConfig.experimental?.proxyClientMaxBodySize);

  it("der Proxy-Puffer ist größer als das Limit der Server Actions (sonst kommt ein Beleg nahe 10 MB abgeschnitten an) und kleiner als ein Vielfaches", () => {
    assert.equal(nextConfig.experimental?.proxyClientMaxBodySize, PROXY_BODY_LIMIT);
    assert.equal(nextConfig.experimental?.serverActions?.bodySizeLimit, SERVER_ACTION_BODY_LIMIT);
    assert.ok(configured() > limit(SERVER_ACTION_BODY_LIMIT), "Proxy-Puffer muss größer sein als das Server-Action-Limit");
    assert.ok(configured() <= 32 * 1024 * 1024, "nicht global hoch: der Puffer liegt je Anfrage im Speicher");
    assert.ok(limit(SERVER_ACTION_BODY_LIMIT) > 10 * 1024 * 1024 + 1024 * 1024, "Rechnungsbeleg (10 MiB) plus Formularfelder passt hinein");
  });

  it("Next puffert für den Proxy mit genau diesem Limit: 12,5 MiB kommen vollständig an, mit dem Standard (10 MiB) würden sie gekappt", async () => {
    const total = 12 * 1024 * 1024 + 512 * 1024;
    const body = () => Readable.from((function* () { for (let sent = 0; sent < total; sent += 1024 * 1024) yield Buffer.alloc(Math.min(1024 * 1024, total - sent), 1); })());
    const read = async (sizeLimit: number | undefined) => {
      const cloneable = getCloneableBody(body() as never, sizeLimit);
      const warn = console.warn;
      console.warn = () => undefined;
      try {
        let received = 0;
        for await (const chunk of cloneable.cloneBodyStream()) received += (chunk as Buffer).length;
        return received;
      } finally {
        console.warn = warn;
      }
    };
    assert.equal(await read(configured()), total);
    assert.equal(await read(undefined), 10 * 1024 * 1024, "Standard von Next: stilles Kappen bei 10 MiB (genau das verhindert die Konfiguration)");
  });

  it("schreibt zur Laufzeit nicht in das Paketverzeichnis: keine Bildoptimierung (Cache unter .next/cache/images), kein Zurückschreiben von Cache-Einträgen", () => {
    assert.equal(nextConfig.images?.unoptimized, true, "/_next/image ist unauthentifiziert erreichbar und würde sonst Dateien in den Baum schreiben");
    assert.equal(nextConfig.experimental?.isrFlushToDisk, false);
  });
});
