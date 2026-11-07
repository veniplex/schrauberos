import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInternalHref, isLocalImageSrc } from "./markdown-url";

describe("Markdown: interne und externe Adressen", () => {
  it("Pfade der eigenen Herkunft und Anker sind intern", () => {
    for (const href of ["/help/vehicles", "/", "/docs/a/b?x=1#c", "#kapitel"]) assert.equal(isInternalHref(href), true, href);
  });

  it("protokollrelative Adressen (//host) und Varianten gelten als extern", () => {
    for (const href of ["//evil.example/x", "///evil.example", "/\\evil.example", "\\\\evil.example", "/\t/evil.example", "/\n/evil.example"]) assert.equal(isInternalHref(href), false, JSON.stringify(href));
  });

  it("vollständige Adressen, mailto, Schema-Tricks und leere Eingabe sind extern", () => {
    for (const href of ["https://example.org", "http://example.org", "mailto:a@b.de", "javascript:alert(1)", " /pfad", "relativ/pfad", "", undefined]) assert.equal(isInternalHref(href), false, String(href));
  });

  it("Bilder: nur Pfade der eigenen Herkunft; externe, protokollrelative und data:-Bilder nicht", () => {
    assert.equal(isLocalImageSrc("/api/docs/images/abc"), true);
    for (const src of ["https://example.org/a.png", "//example.org/a.png", "/\\example.org/a.png", "data:image/png;base64,AAAA", "a.png", "", undefined]) assert.equal(isLocalImageSrc(src), false, String(src));
  });
});
