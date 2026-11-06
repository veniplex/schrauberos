import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentSecurityPolicy } from "./csp";

const parse = (policy: string) => Object.fromEntries(policy.split("; ").map((part) => { const [name, ...values] = part.split(" "); return [name, values]; }));

describe("Content-Security-Policy (Grundlage)", () => {
  const prod = parse(contentSecurityPolicy({ dev: false }));
  const dev = parse(contentSecurityPolicy({ dev: true }));

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

  it("Skripte nur von der eigenen Herkunft, kein eval im Betrieb; nirgends ein Platzhalter oder eine fremde Herkunft", () => {
    assert.deepEqual(prod["script-src"], ["'self'", "'unsafe-inline'"]);
    assert.equal(contentSecurityPolicy({ dev: false }).includes("unsafe-eval"), false);
    assert.equal(/\*|https?:/.test(contentSecurityPolicy({ dev: false })), false);
  });

  it("kein upgrade-insecure-requests (die App läuft im LAN auch über HTTP)", () => {
    assert.equal(contentSecurityPolicy({ dev: false }).includes("upgrade-insecure-requests"), false);
  });

  it("nur in der Entwicklung kommen eval (React-Fehlerstapel) und WebSocket (Entwicklungsserver) hinzu", () => {
    assert.ok(dev["script-src"].includes("'unsafe-eval'"));
    assert.ok(dev["connect-src"].includes("ws:"));
    assert.equal(prod["connect-src"].includes("ws:"), false);
  });

  it("ist eine gültige Kopfzeile: keine Zeilenumbrüche, jede Direktive nur einmal", () => {
    const text = contentSecurityPolicy({ dev: false });
    assert.equal(/[\r\n]/.test(text), false);
    const names = text.split("; ").map((part) => part.split(" ")[0]);
    assert.equal(new Set(names).size, names.length);
  });
});
