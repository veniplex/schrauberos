import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalMime, checkUpload, sniffContentType } from "./upload-sniff";

const bytes = (...parts: Array<number[] | string>) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "utf8")] : p)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 0]);
const WEBP = bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ");
const GIF = bytes("GIF89a", [1, 0, 1, 0]);
const PDF = bytes("%PDF-1.7\n%âãÏÓ\n");

describe("Dateityp am Inhalt erkennen", () => {
  it("erkennt PNG, JPEG, WebP, GIF und PDF an den ersten Bytes", () => {
    assert.equal(sniffContentType(PNG), "image/png");
    assert.equal(sniffContentType(JPEG), "image/jpeg");
    assert.equal(sniffContentType(WEBP), "image/webp");
    assert.equal(sniffContentType(GIF), "image/gif");
    assert.equal(sniffContentType(bytes("GIF87a")), "image/gif");
    assert.equal(sniffContentType(PDF), "application/pdf");
  });

  it("erkennt XML nur mit Deklaration (auch mit BOM, Kommentar und Namensraum-Präfix) – XRechnung UBL und CII", () => {
    assert.equal(sniffContentType(bytes('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>')), "application/xml");
    assert.equal(sniffContentType(bytes([0xef, 0xbb, 0xbf], '<?xml version="1.0"?><!-- Rechnung --><rsm:CrossIndustryInvoice xmlns:rsm="urn:x"/>')), "application/xml");
    assert.equal(sniffContentType(bytes('<Invoice xmlns="x"/>')), null, "ohne Deklaration kein XML (könnte HTML-artig sein)");
  });

  it("HTML, Skripte und Formatvorlagen sind kein XML – auch nicht getarnt (XHTML, mit Deklaration, mit DOCTYPE)", () => {
    for (const evil of [
      "<!DOCTYPE html><html><script>alert(1)</script></html>",
      "<html><body onload=alert(1)>",
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>',
      '<?xml version="1.0"?><x:html xmlns:x="http://www.w3.org/1999/xhtml"/>',
      '<?xml version="1.0"?><xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>',
      "<script>alert(1)</script>",
      "   \n<HTML>",
      "GIF89 kein Bild",
      "%PDF kein pdf",
    ]) {
      assert.equal(sniffContentType(bytes(evil)), null, evil);
    }
  });

  it("XML nur mit Rechnungs-Wurzel (Positivliste UBL Invoice/CreditNote, CII CrossIndustryInvoice) und ohne DOCTYPE, Entitäten oder Formatvorlage (ZP3-S-F5)", () => {
    const decl = '<?xml version="1.0" encoding="UTF-8"?>';
    for (const ok of [`${decl}<Invoice xmlns="urn:x"/>`, `${decl}<ubl:CreditNote xmlns:ubl="urn:x"/>`, `${decl}<rsm:CrossIndustryInvoice xmlns:rsm="urn:x"/>`, `${decl}<!-- Kommentar --><INVOICE/>`]) {
      assert.equal(sniffContentType(bytes(ok)), "application/xml", ok);
    }
    for (const evil of [
      `${decl}<foo/>`, // beliebiges XML
      `${decl}<rss version="2.0"/>`,
      `${decl}<Invoice/>`.replace("<Invoice/>", '<?xml-stylesheet type="text/xsl" href="x.xsl"?><Invoice/>'),
      `${decl}<!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Invoice>&xxe;</Invoice>`,
      `${decl}<!DOCTYPE Invoice SYSTEM "http://evil.example/x.dtd"><Invoice/>`,
      `${decl}<!DOCTYPE Invoice [<!ENTITY a "aaaa">]><Invoice>&a;</Invoice>`,
      `${decl}<Invoice><?xml-stylesheet href="x"?></Invoice>`,
      `<Invoice xmlns="x"/>`,
    ]) {
      assert.equal(sniffContentType(bytes(evil)), null, evil);
    }
  });

  it("SVG wird als SVG erkannt (nur das Logo erlaubt es), nicht als XML", () => {
    assert.equal(sniffContentType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
    assert.equal(sniffContentType(bytes('<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg/>')), "image/svg+xml");
  });

  it("Binärmüll, leere Dateien und Textdateien werden nicht erkannt; Null-Bytes im Kopf verhindern XML/SVG", () => {
    assert.equal(sniffContentType(bytes()), null);
    assert.equal(sniffContentType(bytes("einfach Text")), null);
    assert.equal(sniffContentType(bytes([0, 1, 2, 3, 4, 5])), null);
    assert.equal(sniffContentType(bytes('<?xml version="1.0"?>', [0], "<a/>")), null);
  });
});

describe("Typen vergleichen", () => {
  it("canonicalMime vereinheitlicht Schreibweisen", () => {
    assert.equal(canonicalMime("Image/JPG"), "image/jpeg");
    assert.equal(canonicalMime("text/xml; charset=utf-8"), "application/xml");
    assert.equal(canonicalMime(" application/pdf "), "application/pdf");
  });

  const BILDER = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const BELEGE = ["application/pdf", "image/png", "image/jpeg", "image/webp", "application/xml"];

  it("HTML, das sich als PNG, JPEG oder PDF ausgibt, wird abgelehnt (Typ)", () => {
    const html = bytes("<html><script>alert(document.cookie)</script></html>");
    for (const declared of ["image/png", "image/jpeg", "application/pdf", "", "text/html"]) {
      assert.deepEqual(checkUpload(html, declared, BILDER), { ok: false, reason: "type" }, declared);
      assert.deepEqual(checkUpload(html, declared, BELEGE), { ok: false, reason: "type" }, declared);
    }
  });

  it("ein echtes Bild mit falscher Typangabe wird abgelehnt (Abweichung), mit richtiger oder fehlender angenommen", () => {
    assert.deepEqual(checkUpload(PNG, "image/png", BILDER), { ok: true, mime: "image/png" });
    assert.deepEqual(checkUpload(PNG, "", BILDER), { ok: true, mime: "image/png" });
    assert.deepEqual(checkUpload(PNG, "application/octet-stream", BILDER), { ok: true, mime: "image/png" });
    assert.deepEqual(checkUpload(JPEG, "image/jpg", BILDER), { ok: true, mime: "image/jpeg" });
    assert.deepEqual(checkUpload(PNG, "image/jpeg", BILDER), { ok: false, reason: "mismatch" });
    assert.deepEqual(checkUpload(PDF, "image/png", BELEGE), { ok: false, reason: "mismatch" });
  });

  it("ein erkannter, aber nicht erlaubter Typ wird abgelehnt (PDF als Doku-Bild, GIF als Beleg, SVG als Beleg)", () => {
    assert.deepEqual(checkUpload(PDF, "application/pdf", BILDER), { ok: false, reason: "type" });
    assert.deepEqual(checkUpload(GIF, "image/gif", BELEGE), { ok: false, reason: "type" });
    assert.deepEqual(checkUpload(bytes("<svg/>"), "image/svg+xml", BELEGE), { ok: false, reason: "type" });
  });

  it("XML-Beleg: text/xml und application/xml werden angenommen, gespeichert wird application/xml", () => {
    const xml = bytes('<?xml version="1.0"?><Invoice/>');
    assert.deepEqual(checkUpload(xml, "text/xml", BELEGE), { ok: true, mime: "application/xml" });
    assert.deepEqual(checkUpload(xml, "application/xml", BELEGE), { ok: true, mime: "application/xml" });
  });
});
