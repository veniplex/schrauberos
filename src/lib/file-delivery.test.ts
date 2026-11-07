import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asciiFileName, contentDisposition, deliveryHeaders, truncateName } from "./file-delivery";

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

describe("Dateinamen mit Emoji und Ersatzzeichen (ZP3-S-F4)", () => {
  it("truncateName kürzt nach Zeichen, schneidet kein Ersatzpaar durch und ersetzt einzelne Ersatzzeichen", () => {
    const emoji = "😀";
    const name = `${"a".repeat(119)}${emoji}.pdf`; // das Emoji liegt auf den UTF-16-Einheiten 119/120: slice(0, 120) schnitte es entzwei
    const cut = truncateName(name);
    assert.equal([...cut].length, 120);
    assert.ok(cut.endsWith(emoji), "ganzes Zeichen oder gar nicht");
    assert.equal(cut, cut.toWellFormed());
    assert.equal(truncateName("\ud83d allein"), "� allein", "einzelnes Ersatzzeichen wird ersetzt");
    assert.equal(truncateName("kurz.pdf"), "kurz.pdf");
  });

  it("contentDisposition wirft bei Emoji-Namen nie – auch nicht an der Kürzungsgrenze oder mit einzelnem Ersatzzeichen (sonst wäre der Beleg dauerhaft nicht auslieferbar)", () => {
    for (const name of [`${"a".repeat(119)}😀.pdf`, `${"a".repeat(118)}😀😀.pdf`, "\ud83d.pdf", `${"b".repeat(119)}\ud83d`, "😀".repeat(200)]) {
      const header = contentDisposition("attachment", name);
      assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
      assert.doesNotThrow(() => decodeURIComponent(header.split("UTF-8''")[1]), name);
    }
    // gespeicherte Namen aus früheren Versionen (bereits mitten im Ersatzpaar abgeschnitten) bleiben auslieferbar
    assert.doesNotThrow(() => deliveryHeaders({ mime: "application/pdf", name: `${"a".repeat(119)}\ud83d` }));
  });
});
