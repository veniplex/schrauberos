import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { config as proxyConfig } from "@/proxy";
import { evalColor, readTokens } from "@/lib/color-contrast";
import manifest from "@/app/manifest";
import { GET as offlineRoute } from "@/app/offline/route";
import { decodePng, ICONS, renderIcon } from "../../scripts/lib/pwa-icons.mjs";
import { OFFLINE_TEXT, offlineHtml } from "./offline-text";
import { PWA_APPLE_ICON, PWA_BACKGROUND_COLOR, PWA_ICONS, PWA_THEME_COLOR } from "./pwa";

/** Installierbare App (P3-5): Manifest, Symbole, Farben aus den Tokens, Offline-Seite, Zuständigkeit von Proxy und Konfiguration. */
const ROOT = process.cwd();
const pub = (file: string) => path.join(ROOT, "public", file);
const tokens = readTokens(readFileSync(path.join(ROOT, "src/app/tokens.css"), "utf8"));
const hex = (name: string, theme: "light" | "dark") => {
  const { r, g, b } = evalColor(`var(${name})`, theme, tokens);
  return "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
};

describe("Manifest", () => {
  const m = manifest();

  it("installierbar: Name, Start im Geltungsbereich, eigenständiges Fenster, Symbole 192 und 512 (auch maskierbar)", () => {
    assert.equal(m.name, "SchrauberOS");
    assert.ok(m.short_name && m.short_name.length <= 12, "Kurzname passt unter das Symbol");
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "/");
    assert.equal(m.scope, "/");
    assert.equal(m.id, "/");
    const sizes = (purpose: string) => m.icons!.filter((i) => i.purpose === purpose).map((i) => i.sizes);
    assert.ok(sizes("any").includes("192x192") && sizes("any").includes("512x512"));
    assert.ok(sizes("maskable").includes("512x512"));
  });

  it("die Symbole gibt es, sind PNG in der angegebenen Größe und liegen unter /icons (außerhalb des Proxys)", () => {
    for (const icon of m.icons!) {
      const file = pub(icon.src!.replace(/^\//, ""));
      assert.ok(existsSync(file), icon.src);
      const png = readFileSync(file);
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
      assert.equal(size, icon.sizes, icon.src);
      assert.equal(icon.type, "image/png");
    }
    assert.ok(existsSync(pub("icons/apple-touch-icon.png")));
    assert.equal(PWA_APPLE_ICON, "/icons/apple-touch-icon.png");
  });

  it("die Symbole sind genau das, was scripts/gen-pwa-icons.mjs erzeugt (Bildpunkte; kein von Hand verändertes Bild)", () => {
    for (const icon of ICONS) {
      const decoded = decodePng(readFileSync(pub(`icons/${icon.file}`)));
      assert.equal(decoded.size, icon.size, icon.file);
      assert.ok(decoded.rgba.equals(renderIcon(icon)), `${icon.file} entspricht nicht dem Verfahren – node scripts/gen-pwa-icons.mjs`);
    }
    assert.deepEqual([...ICONS.filter((i) => i.purpose !== "apple").map((i) => `/icons/${i.file}`)].sort(), PWA_ICONS.map((i) => i.src).sort());
  });

  it("randlose Symbole haben keine durchsichtigen Ecken (maskable, iOS), das runde schon", () => {
    const corner = (file: string) => decodePng(readFileSync(pub(`icons/${file}`))).rgba[3];
    assert.equal(corner("icon-maskable-512.png"), 255);
    assert.equal(corner("apple-touch-icon.png"), 255);
    assert.equal(corner("icon-512.png"), 0);
  });

  it("die Farben sind die der Design-Tokens (Kopfzeilenfläche, Seitenhintergrund) und die Akzentfarbe der Symbole die Standard-Akzentfarbe", () => {
    assert.equal(PWA_THEME_COLOR.light, hex("--surface", "light"));
    assert.equal(PWA_THEME_COLOR.dark, hex("--surface", "dark"));
    assert.equal(PWA_BACKGROUND_COLOR, hex("--bg", "light"));
    assert.equal(m.theme_color, PWA_THEME_COLOR.light);
    assert.equal(m.background_color, PWA_BACKGROUND_COLOR);
    const corner = decodePng(readFileSync(pub("icons/icon-maskable-512.png"))).rgba;
    assert.equal("#" + [...corner.subarray(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join(""), hex("--accent", "light"));
  });

  it("die Kopfzeilen der Seiten verweisen darauf: theme-color je Hell/Dunkel, Symbol für iOS, viewport-fit=cover", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    assert.match(layout, /themeColor: \[\s*\{ media: "\(prefers-color-scheme: light\)", color: PWA_THEME_COLOR\.light \},\s*\{ media: "\(prefers-color-scheme: dark\)", color: PWA_THEME_COLOR\.dark \},?\s*\]/);
    assert.match(layout, /icons: \{ apple: PWA_APPLE_ICON \}/);
    assert.match(layout, /appleWebApp: \{ capable: true/);
    assert.match(layout, /viewportFit: "cover"/);
    assert.match(layout, /<ServiceWorkerRegistrar version=\{appVersion\(\)\} \/>/);
  });

  it("Manifest, Symbole und Service Worker liegen außerhalb des Proxys (statisch, ohne Datenbank); die Offline-Seite und das Logo laufen durch ihn", () => {
    const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);
    for (const p of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"]) assert.equal(matcher.test(p), false, p);
    for (const p of ["/offline", "/api/logo"]) assert.equal(matcher.test(p), true, p);
  });
});

describe("Offline-Seite", () => {
  it("antwortet ohne Anmeldung mit einer eigenständigen HTML-Seite: beide Sprachen, ohne Skript, ohne Cookie, mit Weg zurück", async () => {
    const res = offlineRoute();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.match(res.headers.get("cache-control") ?? "", /no-cache/);
    const body = await res.text();
    assert.ok(body.startsWith("<!doctype html>"));
    assert.ok(body.includes(OFFLINE_TEXT.de.text) && body.includes(OFFLINE_TEXT.en.text));
    assert.ok(body.includes(OFFLINE_TEXT.de.retry) && body.includes(OFFLINE_TEXT.en.retry));
    assert.doesNotMatch(body, /<script|<style|<link|nonce|src=|onclick/i, "nichts, was ein Skript, einen Nonce oder fremde Dateien braucht");
    assert.match(body, /<a href="\/"/);
    assert.equal(body, offlineHtml());
  });

  it("der Service Worker lädt genau diese Adresse", () => {
    assert.match(readFileSync(pub("sw.js"), "utf8"), /var OFFLINE_PATH = "\/offline";/);
  });
});
