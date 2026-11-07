import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { logoSrc, parseLogoDataUrl } from "./logo";

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`;
const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
const at = new Date("2026-11-07T10:00:00Z");

describe("Logo (P3-5)", () => {
  it("erkennt die Rasterformate und liefert Typ und Bytes", () => {
    const parsed = parseLogoDataUrl(png);
    assert.equal(parsed?.mime, "image/png");
    assert.deepEqual([...parsed!.data], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(parseLogoDataUrl(`data:image/webp;base64,AAAA`)?.mime, "image/webp");
    assert.equal(parseLogoDataUrl(`data:image/jpeg;base64,AAAA`)?.mime, "image/jpeg");
  });

  it("SVG, fremde Typen, Unsinn und leere Daten sind kein Logo", () => {
    for (const bad of [svg, "data:text/html;base64,PGI+", "data:image/png;base64,", "javascript:alert(1)", "", null, undefined]) assert.equal(parseLogoDataUrl(bad), null, String(bad));
  });

  it("die Adresse trägt die Änderungszeit; ohne (zugelassenes) Logo gibt es keine", () => {
    assert.equal(logoSrc({ logoDataUrl: png, updatedAt: at }), `/api/logo?v=${at.getTime()}`);
    assert.equal(logoSrc({ logoDataUrl: svg, updatedAt: at }), null, "ein früher gespeichertes SVG wird nicht mehr angezeigt");
    assert.equal(logoSrc({ logoDataUrl: null, updatedAt: at }), null);
  });
});
