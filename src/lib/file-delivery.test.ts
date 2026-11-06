import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asciiFileName, contentDisposition, deliveryHeaders } from "./file-delivery";

describe("Auslieferungs-Kopfzeilen je Dateityp", () => {
  const h = (mime: string, extra: Partial<Parameters<typeof deliveryHeaders>[0]> = {}) => deliveryHeaders({ mime, name: "Datei.bin", ...extra });

  it("PDF: inline, nosniff, ohne sandbox (der PDF-Betrachter verträgt sie nicht)", () => {
    const headers = h("application/pdf");
    assert.equal(headers["Content-Type"], "application/pdf");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.match(headers["Content-Disposition"], /^inline;/);
    assert.equal("Content-Security-Policy" in headers, false);
  });

  it("Bilder: inline mit sandbox und default-src 'none'", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      const headers = h(mime);
      assert.equal(headers["Content-Security-Policy"], "sandbox; default-src 'none'", mime);
      assert.equal(headers["X-Content-Type-Options"], "nosniff");
      assert.match(headers["Content-Disposition"], /^inline;/);
    }
  });

  it("XML wird immer als Download geliefert – auch ohne ?download und mit sandbox", () => {
    const headers = h("application/xml", { download: false });
    assert.match(headers["Content-Disposition"], /^attachment;/);
    assert.equal(headers["Content-Security-Policy"], "sandbox; default-src 'none'");
    assert.equal(headers["Content-Type"], "application/xml");
  });

  it("SVG und unbekannte Typen (zum Beispiel ein manipulierter Datenbankeintrag text/html) gelten als Download von „application/octet-stream“", () => {
    for (const mime of ["image/svg+xml", "text/html", "application/javascript", "", "image/png; charset=x"]) {
      const headers = h(mime);
      assert.equal(headers["Content-Type"], "application/octet-stream", mime);
      assert.match(headers["Content-Disposition"], /^attachment;/, mime);
      assert.equal(headers["Content-Security-Policy"], "sandbox; default-src 'none'");
      assert.equal(headers["X-Content-Type-Options"], "nosniff");
    }
  });

  it("download erzwingt attachment auch für PDF und Bilder; Länge und Zwischenspeicher-Regel werden gesetzt", () => {
    assert.match(h("application/pdf", { download: true })["Content-Disposition"], /^attachment;/);
    const headers = h("image/png", { size: 1234, cacheControl: "private, max-age=86400, immutable" });
    assert.equal(headers["Content-Length"], "1234");
    assert.equal(headers["Cache-Control"], "private, max-age=86400, immutable");
    assert.equal(h("image/png")["Cache-Control"], "private, no-store");
  });
});

describe("Content-Disposition: Dateiname", () => {
  it("ASCII-Name ohne Anführungszeichen, Backslash, Pfadtrenner und Steuerzeichen; UTF-8-Variante kodiert", () => {
    const header = contentDisposition("attachment", 'Beleg "Ä"\\../x.pdf');
    assert.equal(/filename="([^"]*)"/.exec(header)?.[1], "Beleg ____.._x.pdf");
    assert.ok(header.includes("filename*=UTF-8''Beleg%20%22%C3%84%22%5C..%2Fx.pdf"), header);
  });

  it("Zeilenumbrüche und andere Steuerzeichen schleusen keine Kopfzeilen ein", () => {
    const header = contentDisposition("inline", 'a.pdf"\r\nSet-Cookie: x=1\r\nX-Evil: 1');
    assert.equal(/[\r\n]/.test(header), false);
    assert.equal(header.includes('"Set-Cookie'), false);
    assert.equal(header.split(";").length, 3, "nur die drei Teile: Art, filename, filename*");
    assert.equal(/\0/.test(contentDisposition("inline", "a\0b")), false);
  });

  it("kodiert auch Zeichen, die RFC 5987 nicht erlaubt (Hochkomma, Klammern, Stern); leere oder versteckte Namen bekommen einen Ersatz", () => {
    assert.ok(contentDisposition("inline", "it's (1)*.pdf").includes("it%27s%20%281%29%2A.pdf"));
    assert.equal(asciiFileName(""), "datei");
    assert.equal(asciiFileName("...."), "datei");
    assert.equal(asciiFileName(".htaccess"), "htaccess");
    assert.equal(asciiFileName("a".repeat(500)).length, 120);
  });
});
