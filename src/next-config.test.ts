import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { Readable } from "node:stream";
import bytes from "next/dist/compiled/bytes";
import { getCloneableBody } from "next/dist/server/body-streams";
import nextConfig, { PROXY_BODY_LIMIT, SECURITY_HEADERS, SERVER_ACTION_BODY_LIMIT } from "../next.config";

/**
 * Die Basis-Header aus `next.config.ts`. Geprüft wird nicht nur der Inhalt der Konfiguration, sondern mit dem Mustervergleich, den auch
 * Next selbst benutzt (path-to-regexp), dass die Regel für **jeden** Pfad gilt – Seiten, API, Statik, Service Worker, Dateien.
 *
 * Nicht geprüft wird hier die tatsächliche HTTP-Antwort eines laufenden Servers: Das bräuchte `next build` + `next start` (Minuten, eine
 * Datenbank) und gehört in die Browser-CI (Paket P1a-6b), die die Header jeder Route der Inventur an der echten Antwort prüft.
 */
const PATHS = ["/", "/login", "/login/recover", "/setup", "/appointments", "/appointments/abc123/edit", "/admin/users", "/api/health", "/api/v1/customers", "/api/ical/abc.ics", "/api/files/invoice/xyz", "/_next/static/chunks/a.js", "/_next/image", "/sw.js", "/manifest.webmanifest", "/favicon.ico", "/icons/192.png"];

describe("next.config: Basis-Header", () => {
  it("setzt nosniff, Referrer-Policy, X-Frame-Options SAMEORIGIN und eine erzwungene Content-Security-Policy", () => {
    const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;
    assert.equal(header("X-Content-Type-Options"), "nosniff");
    assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(header("X-Frame-Options"), "SAMEORIGIN");
    assert.match(header("Content-Security-Policy") ?? "", /default-src 'self'.*frame-ancestors 'self'/);
    assert.equal(SECURITY_HEADERS.some((h) => h.key.toLowerCase().includes("report-only")), false, "die Richtlinie wird erzwungen, nicht nur gemeldet");
  });

  it("die Regel gilt für alle Pfade (Seiten, API, Statik, Dateien), und keine andere Regel überschreibt die Header", async () => {
    const rules = await nextConfig.headers!();
    const matching = (path: string) => rules.filter((rule) => pathToRegexp(rule.source).test(path));
    for (const path of PATHS) {
      const rulesForPath = matching(path);
      assert.equal(rulesForPath.length, 1, `${path}: genau eine Regel erwartet, waren ${rulesForPath.length}`);
      for (const expected of SECURITY_HEADERS) {
        assert.equal(rulesForPath[0].headers.find((h) => h.key === expected.key)?.value, expected.value, `${path}: ${expected.key}`);
      }
      assert.ok(!rulesForPath[0].has && !rulesForPath[0].missing, `${path}: die Regel hat keine Bedingung`);
    }
  });

  it("verbietet das Einbetten von außen und die Typerkennung, ohne die PDF-Vorschau derselben Herkunft zu sperren", () => {
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")!.value;
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /frame-ancestors 'none'/);
  });
});

describe("next.config: Größe der Anfrage-Bodies (ZP2-A-F1)", () => {
  const limit = (value: string | number | undefined) => (typeof value === "string" ? (bytes.parse(value) as number) : (value ?? 0));
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
      const cloneable = getCloneableBody(body(), sizeLimit);
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
});
