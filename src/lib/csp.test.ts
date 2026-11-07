import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig from "../../next.config";
import { config as proxyConfig } from "../proxy";
import {
  API_CONTENT_SECURITY_POLICY,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  PDF_CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  contentSecurityPolicy,
  createNonce,
  cspKind,
  requestPolicy,
} from "./csp";

const parse = (policy: string) => Object.fromEntries(policy.split("; ").map((part) => { const [name, ...values] = part.split(" "); return [name, values]; }));
const NONCE = "dGVzdG5vbmNlMTIzNDU2Nw==";

describe("Content-Security-Policy der Seiten", () => {
  const prod = parse(contentSecurityPolicy({ dev: false, nonce: NONCE }));
  const dev = parse(contentSecurityPolicy({ dev: true, nonce: NONCE }));

  it("alles ist standardmäßig auf die eigene Herkunft beschränkt", () => {
    assert.deepEqual(prod["default-src"], ["'self'"]);
    for (const name of ["connect-src", "frame-src", "worker-src", "manifest-src", "font-src", "media-src"]) assert.deepEqual(prod[name], ["'self'"], name);
    assert.deepEqual(prod["img-src"], ["'self'", "data:", "blob:"]);
  });

  it("verbietet Plugins, <base> und fremde Formularziele, und erlaubt Einbetten nur der eigenen Herkunft", () => {
    assert.deepEqual(prod["object-src"], ["'none'"]);
    assert.deepEqual(prod["base-uri"], ["'none'"]);
    assert.deepEqual(prod["form-action"], ["'self'"]);
    assert.deepEqual(prod["frame-ancestors"], ["'self'"]);
  });

  it("Skripte nur mit Nonce (und strict-dynamic) – kein 'unsafe-inline', kein eval im Betrieb, keine fremde Herkunft", () => {
    assert.deepEqual(prod["script-src"], ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    const text = contentSecurityPolicy({ dev: false, nonce: NONCE });
    assert.equal(text.includes("unsafe-eval"), false);
    assert.equal(/\*|https?:/.test(text), false);
    assert.equal(prod["script-src"].includes("'unsafe-inline'"), false);
  });

  it("Stile: Elemente nur mit Nonce, Stilattribute (style=\"…\" von React) bewusst erlaubt", () => {
    assert.deepEqual(prod["style-src"], ["'self'", `'nonce-${NONCE}'`]);
    assert.deepEqual(prod["style-src-attr"], ["'unsafe-inline'"]);
    assert.equal(prod["style-src"].includes("'unsafe-inline'"), false);
  });

  it("ohne Nonce (Statik, Service Worker): Skripte nur von der eigenen Herkunft, nirgends 'unsafe-inline'", () => {
    const plain = parse(contentSecurityPolicy({ dev: false }));
    assert.deepEqual(plain["script-src"], ["'self'"]);
    assert.deepEqual(plain["style-src"], ["'self'"]);
  });

  it("kein upgrade-insecure-requests (die App läuft im LAN auch über HTTP)", () => {
    assert.equal(contentSecurityPolicy({ dev: false, nonce: NONCE }).includes("upgrade-insecure-requests"), false);
  });

  it("nur in der Entwicklung kommen eval (React-Fehlerstapel) und WebSocket (Entwicklungsserver) hinzu", () => {
    assert.ok(dev["script-src"].includes("'unsafe-eval'"));
    assert.ok(dev["connect-src"].includes("ws:"));
    assert.equal(prod["connect-src"].includes("ws:"), false);
  });

  it("ist eine gültige Kopfzeile: keine Zeilenumbrüche, jede Direktive nur einmal", () => {
    const text = contentSecurityPolicy({ dev: false, nonce: NONCE });
    assert.equal(/[\r\n]/.test(text), false);
    const names = text.split("; ").map((part) => part.split(" ")[0]);
    assert.equal(new Set(names).size, names.length);
  });

  it("Next findet den Nonce im Kopf: das Muster, mit dem Next ihn liest, trifft genau unseren Wert", async () => {
    const { getScriptNonceFromHeader } = await import("next/dist/server/app-render/get-script-nonce-from-header");
    assert.equal(getScriptNonceFromHeader(contentSecurityPolicy({ dev: false, nonce: NONCE })), NONCE);
    const generated = createNonce();
    assert.equal(getScriptNonceFromHeader(contentSecurityPolicy({ dev: true, nonce: generated })), generated);
  });
});

describe("Nonce", () => {
  it("128 Bit, Base64, bei jedem Aufruf neu", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createNonce()));
    assert.equal(seen.size, 50);
    for (const nonce of seen) {
      assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
      assert.equal(Buffer.from(nonce, "base64").length, 16);
    }
  });
});

describe("Richtlinie je Pfad", () => {
  it("Dateirouten setzen ihre CSP selbst, JSON-/Feed-Routen bekommen default-src 'none', alles andere die Seiten-Richtlinie", () => {
    for (const p of ["/api/invoices/abc/file", "/api/docs/images/xyz"]) assert.equal(cspKind(p), "route", p);
    for (const p of ["/api/v1", "/api/v1/customers", "/api/ical/abc.ics"]) assert.equal(cspKind(p), "api", p);
    for (const p of ["/", "/login", "/vehicles/1", "/api/search", "/api/backups/schrauberos-x", "/api/invoices/abc", "/api/invoices/abc/file/x", "/api/docs/images", "/api/v10/x", "/api/icalx"]) assert.equal(cspKind(p), "page", p);
  });

  it("jede Anfrage durch den Proxy bekommt einen eigenen Nonce; Dateirouten bekommen keine Richtlinie vom Proxy", () => {
    const a = requestPolicy("/vehicles", { dev: false, mode: "enforce" })!;
    const b = requestPolicy("/vehicles", { dev: false, mode: "enforce" })!;
    assert.notEqual(a.nonce, b.nonce);
    assert.ok(a.value.includes(`'nonce-${a.nonce}'`) && !a.value.includes(b.nonce));
    assert.equal(requestPolicy("/api/invoices/abc/file", { dev: false, mode: "enforce" }), null);
    assert.equal(requestPolicy("/api/docs/images/abc", { dev: false, mode: "report-only" }), null);
  });

  it("die Programmschnittstelle bekommt default-src 'none' (nur dort)", () => {
    assert.equal(requestPolicy("/api/v1/customers", { dev: false, mode: "enforce" })!.value, API_CONTENT_SECURITY_POLICY);
    assert.match(requestPolicy("/vehicles", { dev: false, mode: "enforce" })!.value, /default-src 'self'/);
    assert.doesNotMatch(requestPolicy("/vehicles", { dev: false, mode: "enforce" })!.value, /default-src 'none'/);
  });

  it("der Notschalter wechselt nur den Namen des Kopfes: erzwungen oder Report-Only, mit demselben Inhalt", () => {
    const nonce = "AAAAAAAAAAAAAAAAAAAAAA==";
    const enforce = requestPolicy("/x", { dev: false, mode: "enforce", nonce })!;
    const report = requestPolicy("/x", { dev: false, mode: "report-only", nonce })!;
    assert.equal(enforce.headerName, CSP_HEADER);
    assert.equal(report.headerName, CSP_REPORT_ONLY_HEADER);
    assert.equal(enforce.value, report.value);
  });

  it("die PDF-Richtlinie enthält weder sandbox noch object-src noch default-src (der PDF-Betrachter des Browsers verträgt sie nicht)", () => {
    assert.equal(PDF_CONTENT_SECURITY_POLICY, "frame-ancestors 'self'");
  });

  it("Permissions-Policy: Kamera für die eigene Herkunft (Foto aufnehmen), kein pauschales camera=()", () => {
    assert.match(PERMISSIONS_POLICY, /camera=\(self\)/);
    assert.doesNotMatch(PERMISSIONS_POLICY, /camera=\(\)/);
    assert.match(PERMISSIONS_POLICY, /microphone=\(\)/);
  });
});

/**
 * ZP3-S-F9: Genau eine Stelle setzt die CSP einer Antwort. Next hängt die Kopfzeile einer Route nur an, wenn der Server den Namen nicht schon gesetzt hat (`sendResponse`), und
 * zwei CSP-Köpfe verschärfen sich im Browser gegenseitig. Also: Pfade außerhalb des Proxys bekommen sie von `next.config`, Pfade im Proxy vom Proxy – und Dateirouten
 * von sich selbst; keiner mehr als einmal, keiner gar nicht.
 */
describe("Zuständigkeit für die CSP (ZP3-S-F9)", () => {
  const PATHS = [
    "/", "/login", "/login/recover", "/setup", "/appointments", "/appointments/abc123/edit", "/admin/users", "/forbidden", "/does-not-exist",
    "/api/health", "/api/v1/customers", "/api/ical/abc.ics", "/api/search", "/api/backups/status", "/api/backups/schrauberos-20260101T000000Z-manual", "/api/backups/upload", "/api/setup/restore",
    "/api/invoices/xyz/file", "/api/docs/images/abc",
    "/_next/static/chunks/a.js", "/_next/image", "/sw.js", "/manifest.webmanifest", "/favicon.ico", "/icons/192.png", "/icon.png", "/apple-icon.png",
  ];
  const proxyMatcher = new RegExp(`^${proxyConfig.matcher[0]}$`);

  it("jeder Pfad hat genau eine Quelle: Proxy, Konfiguration oder die Route selbst", async () => {
    const rules = await nextConfig.headers!();
    const configHasCsp = (p: string) => rules.some((rule) => pathToRegexp(rule.source).test(p) && rule.headers.some((h) => h.key.toLowerCase() === "content-security-policy"));
    for (const p of PATHS) {
      const sources: string[] = [];
      if (proxyMatcher.test(p) && cspKind(p) !== "route") sources.push("proxy");
      if (configHasCsp(p)) sources.push("config");
      if (proxyMatcher.test(p) && cspKind(p) === "route") sources.push("route");
      assert.equal(sources.length, 1, `${p}: ${sources.join(" + ") || "keine Quelle"}`);
    }
  });

  it("die Konfiguration setzt für alles außerhalb des Proxys eine Richtlinie ohne Nonce und ohne 'unsafe-inline' für Skripte und Stilelemente", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules.flatMap((r) => r.headers).filter((h) => h.key === CSP_HEADER);
    assert.ok(csp.length > 0);
    for (const header of csp) {
      const directives = parse(header.value);
      assert.doesNotMatch(header.value, /nonce/);
      for (const name of ["script-src", "style-src"]) assert.equal(directives[name].includes("'unsafe-inline'"), false, name);
      assert.equal(directives["script-src"][0], "'self'");
    }
  });

  it("jede Route, die Dateien über deliveryHeaders ausliefert, ist als Dateiroute eingetragen (sonst ginge ihre CSP verloren)", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : name === "route.ts" ? [full] : [];
    });
    const root = path.resolve(process.cwd(), "src/app");
    const routes = walk(path.join(root, "api")).filter((file) => readFileSync(file, "utf8").includes("deliveryHeaders("));
    assert.ok(routes.length >= 2, "es gibt mindestens den Rechnungsbeleg und die Doku-Bilder");
    for (const file of routes) {
      // `/api/invoices/[id]/file/route.ts` → `/api/invoices/x/file`
      const url = "/" + path.relative(root, path.dirname(file)).split(path.sep).join("/").replace(/\[[^\]]+\]/g, "x");
      assert.equal(cspKind(url), "route", `${url} liefert Dateien aus und muss in ROUTE_OWNED_PATHS (lib/csp.ts) stehen`);
    }
  });
});
